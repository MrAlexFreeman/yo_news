import type { Prisma } from "@/generated/prisma/client";

import { parseMedia } from "@/lib/article-media";
import { buildDzenContent } from "@/lib/dzen-feed-html";
import { dzenPublicationMethod, dzenRating } from "@/lib/dzen-publication";
import { prisma } from "@/lib/prisma";
import { RSS_CHANNEL_DESCRIPTION, RSS_CHANNEL_TITLE } from "@/lib/site";

/**
 * How far back a story may sit in the feed.
 *
 * Dzen's own wording: «Включайте в ленту актуальные материалы за два-три последних дня».
 * Seventy-two hours is the top of that range, and the earlier revision had no limit at all —
 * the live feed carried fifty items across ten days, which is a backlog, not a feed.
 */
const FEED_WINDOW_HOURS = 72;

/**
 * How far the feed may reach for extra material when three days are not enough.
 *
 * Спецификация требует «минимум 10 материалов» в ленте. Замер по боевой базе на 13 октября:
 * за 72 часа — 13 публикаций, из них после отсева коротких остаётся 9. Ограничиться окном
 * означало бы отдать ленту из девяти материалов и рискнуть тем самым требованием, ради
 * которого всё затевалось, поэтому окно расширяется — но не до бесконечности, а до недели:
 * неделя — это предел, за которым материал перестаёт быть новостью.
 */
const FEED_LOOKBACK_DAYS = 7;

/** Dzen's own minimum for a submitted feed. */
const MIN_ITEMS = 10;

/**
 * The floor on an article's plain text.
 *
 * Спецификация рекомендует «не менее 300 знаков», но там же описана конвертация: материал
 * короче 800 символов и без картинок превращается в пост, где «поддерживается форматирование
 * только гиперссылок и списков». Пост вместо статьи для городской новости — это другой формат
 * и лишняя правка в Студии, поэтому короткое в фид не идёт.
 */
const MIN_TEXT_CHARS = 800;

/** Ceiling on what the feed may return, well under Dzen's own "не более 500 публикаций". */
const FEED_LIMIT = 50;

/**
 * Absolute base for item links. Falls back to localhost so a missing
 * NEXT_PUBLIC_SITE_URL yields a parseable feed instead of relative <link>s.
 */
function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const base = configured && configured.length > 0 ? configured : "http://localhost:3000";
  return base.replace(/\/+$/, "");
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Formats a date as RFC-822 in GMT: "Thu, 01 Oct 2026 08:11:21 GMT".
 *
 * Built by hand rather than via Intl: Intl's own layout is locale- and
 * engine-dependent (it emitted "Thu, Oct 01, 2026, 08:11:21", which is not
 * RFC-822), and RSS validators reject that.
 */
function toRfc822(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "GMT",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  // Some engines emit "24" for midnight; RFC-822 expects "00".
  const hour = get("hour") === "24" ? "00" : get("hour");

  return `${DAY_NAMES[date.getUTCDay()]}, ${get("day")} ${
    MONTH_NAMES[date.getUTCMonth()]
  } ${get("year")} ${hour}:${get("minute")}:${get("second")} GMT`;
}

/** Escapes the five XML predefined entities in text and attributes. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Wraps text in CDATA. Any literal "]]>" inside the payload has to be split,
 * otherwise it closes the section early and truncates the document.
 */
function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

type FeedArticle = Prisma.ArticleGetPayload<{
  select: {
    id: true;
    title: true;
    subtitle: true;
    slug: true;
    lead: true;
    contentHtml: true;
    coverImage: true;
    photoAuthor: true;
    photoSource: true;
    media: true;
    videoUrl: true;
    dzenExperiment: true;
    dzenDirect: true;
    noIndex: true;
    is18plus: true;
    publishedAt: true;
    createdAt: true;
    category: { select: { name: true } };
  };
}>;

/**
 * MIME type for the enclosure, derived from the stored URL.
 *
 * Hardcoding image/jpeg was fine while every cover was a picsum JPEG. The demo
 * covers are PNG and editors can upload WebP, and Dzen uses this attribute to
 * decide how to fetch the file, so it has to follow the actual format.
 */
function coverMimeType(url: string): string {
  const path = url.split("?")[0].split("#")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/**
 * How much readable text an article carries, in characters.
 *
 * Tags are stripped, entities decoded and whitespace collapsed, because the number has to mean
 * what a reader sees: 800 символов «текста» из двухсот пустых `<p>` — это не текст.
 */
function plainTextLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim().length;
}

/**
 * Is this row a demo, a fixture or a placeholder rather than an article?
 *
 * Замер по боевой базе на 13 октября: таких строк нет — поиск по слагам, заголовкам, адресам
 * обложек и подписям к фото не нашёл ни одной. Фильтр оставлен как страховка от того, что
 * такая строка появится: демо-статья в боевой ленте выглядит для модерации как мусор, и
 * обнаружить её можно только по таким меткам, а не по дате публикации.
 */
function looksLikePlaceholder(article: {
  title: string;
  slug: string;
  coverImage: string | null;
  photoSource: string | null;
  photoAuthor: string | null;
}): boolean {
  return /\bpicsum|placeholder|placehold|dummyimage|lorem ipsum|loremipsum/i.test(
    article.coverImage ?? "",
  ) || /\b(demo|demo-|test|test-|fixture|lorem|placeholder|sample)\b|^(тест|демо|пример|фикстура|заглушка)\b/iu.test(
    `${article.slug} ${article.title}`,
  );
}

function renderItem(article: FeedArticle, base: string): string {
  /*
    Канонический адрес материала: ЧПУ, без query-параметров и без слэша в конце.

    Требование спецификации дословно: «URL материалов должен быть ЧПУ (человеко-понятным),
    без UTM-меток и других параметров». Слаг из базы уже чистый, но он приходит строкой, и
    одна правка в редакторе с параметром уехала бы в ленту как отдельная публикация — поэтому
    адрес собирается здесь, из очищенного слага, а не копируется из поля.
  */
  const slug = article.slug.trim().split("?")[0].split("#")[0].replace(/\/+$/, "");
  const link = `${base}/news/${slug}`;
  const date = article.publishedAt ?? article.createdAt;

  const body = buildDzenContent({
    title: article.title,
    subtitle: article.subtitle,
    contentHtml: article.contentHtml,
    coverImage: article.coverImage,
    photoAuthor: article.photoAuthor,
    photoSource: article.photoSource,
    gallery: parseMedia(article.media),
    videoUrl: article.videoUrl,
    base,
  });

  const parts = [
    `      <title>${escapeXml(article.title)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    // Left as the row id: it is stable, unique and already published to Dzen.
    //
    // The docs say to keep «изначальный guid», and also allow a URL here — but switching an
    // already-submitted feed from ids to URLs makes every previously published story look
    // like a new one, which is exactly the duplicate the docs warn about. The <link> above
    // already carries the clean permalink the brief asks for.
    `      <guid isPermaLink="false">${escapeXml(article.id)}</guid>`,
    `      <pubDate>${toRfc822(date)}</pubDate>`,
    `      <description>${cdata(article.lead ?? "")}</description>`,
    `      <content:encoded>${cdata(body)}</content:encoded>`,
  ];

  // Dzen defines <category> as the *publication method* for a channel feed —
  // native-draft, format-article, format-post — and reads the value literally.
  // The rubric that used to go here was therefore never read as a rubric, and it
  // occupied the very slot the experiment flags need. It is dropped rather than
  // moved to an invented element: the spec has no place for it, and an
  // unrecognised tag is a needless risk on a feed that must stay strict.
  //
  // Exactly one <category>, ever. The same element also carries indexing
  // (index/noindex) and commenting in Dzen's docs, but only one value fits, and
  // the method is the one that controls where the piece actually lands — so the
  // method wins the slot and the other two are left out rather than guessed at.
  const method = dzenPublicationMethod(article);
  if (method) {
    parts.push(`      <category>${method}</category>`);
  }

  const rating = dzenRating(article.is18plus);
  if (rating) {
    parts.push(`      <media:rating scheme="urn:simple">${rating}</media:rating>`);
  }

  if (article.coverImage) {
    // coverImage may be stored as a site-relative path (/uploads/x.png) when the
    // editor used the upload endpoint, so it needs the same absolutising as the
    // item link. RSS requires an absolute URI here and Dzen refuses to fetch a
    // relative one.
    //
    // One enclosure per item, and only ever the cover: Dzen documents it as the
    // image for the article's cover and the news-slot medialock, «не
    // отображается внутри текста публикации». Gallery photos ride in
    // content:encoded as <figure> instead — see buildDzenContent.
    const enclosure = /^https?:\/\//i.test(article.coverImage)
      ? article.coverImage
      : `${base}${article.coverImage.startsWith("/") ? "" : "/"}${article.coverImage}`;

    parts.push(
      `      <enclosure url="${escapeXml(enclosure)}" type="${coverMimeType(article.coverImage)}" length="0" />`,
    );
  }

  return `    <item>\n${parts.join("\n")}\n    </item>`;
}

function renderFeed(items: FeedArticle[], base: string, builtAt: Date): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(RSS_CHANNEL_TITLE)}</title>
    <link>${escapeXml(base)}</link>
    <atom:link href="${escapeXml(`${base}/api/feed/dzen.xml`)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(RSS_CHANNEL_DESCRIPTION)}</description>
    <language>ru</language>
    <lastBuildDate>${toRfc822(builtAt)}</lastBuildDate>
${items.map((article) => renderItem(article, base)).join("\n")}
  </channel>
</rss>
`;
}

export async function GET() {
  const now = new Date();
  const windowStart = new Date(now.getTime() - FEED_WINDOW_HOURS * 60 * 60 * 1000);
  const lookbackStart = new Date(now.getTime() - FEED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.article.findMany({
    // `deletedAt: null` is not optional here. A trashed story still has its Dzen flag
    // on, and syndicating it would republish on the partner's side — where there is
    // no trash to take it back from.
    where: {
      status: "published",
      deletedAt: null,
      isDzen: true,
      publishedAt: { gte: lookbackStart },
    },
    orderBy: { publishedAt: "desc" },
    // A week's worth at most, and far more than the feed can return: the text floor below
    // removes roughly a third of what the desk publishes.
    take: 120,
    select: {
      id: true,
      title: true,
      subtitle: true,
      slug: true,
      lead: true,
      contentHtml: true,
      coverImage: true,
      photoAuthor: true,
      photoSource: true,
      media: true,
      videoUrl: true,
      dzenExperiment: true,
      dzenDirect: true,
      noIndex: true,
      is18plus: true,
      publishedAt: true,
      createdAt: true,
      category: { select: { name: true } },
    },
  });

  /*
    Отбор: сначала окно в трое суток, и только если его не хватает — добор из более старых.

    Порядок именно такой, а не «взять десять самых свежих»: требование про актуальность и
    требование про десять материалов тянут ленту в разные стороны в день, когда публикаций
    немного. Сначала соблюдаем свежесть, потом добираем количество, и оба правила объявлены
    константами выше, а не спрятаны в условии.
  */
  const usable = candidates.filter(
    (article) =>
      plainTextLength(article.contentHtml) >= MIN_TEXT_CHARS &&
      !looksLikePlaceholder(article),
  );

  const fresh = usable.filter(
    (article) => (article.publishedAt ?? article.createdAt ?? now) >= windowStart,
  );
  const articles = (fresh.length >= MIN_ITEMS ? fresh : [
    ...fresh,
    ...usable.filter((article) => !fresh.includes(article)),
  ]).slice(0, FEED_LIMIT);

  const xml = renderFeed(articles, siteUrl(), now);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Five minutes of shared caching, then serve stale while revalidating.
      "Cache-Control": "s-maxage=300, stale-while-revalidate",
    },
  });
}
