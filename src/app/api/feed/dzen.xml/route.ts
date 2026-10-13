import type { Prisma } from "@/generated/prisma/client";

import { parseMedia } from "@/lib/article-media";
import { dzenBodyImageUrl, dzenCoverUrl } from "@/lib/dzen-cover";
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

/**
 * Переписывает адреса картинок в теле материала на форматы, которые Дзен берёт.
 *
 * Картинки из текста — это то, что редактор вставил в материал, и туда попадает всё, включая
 * сгенерированные обложки в WebP. Замер на боевой базе 13 октября: после правки обложки в
 * ленте оставались две картинки WebP именно из тела.
 *
 * Адреса заменяются по строке, а не разбором HTML: к моменту вызова разметка ещё не
 * очищена санитайзером, и разбирать её здесь — значит держать в этом файле второе правило
 * разбора. Подстановка безопасна тем, что меняется только значение `src` уже существующего
 * тега, а санитайзер всё равно приведёт результат к своему подмножеству.
 */
async function rewriteBodyImages(html: string, base: string): Promise<string> {
  const matches = [...html.matchAll(/<img[^>]+src="([^"]*)"/gi)];
  if (matches.length === 0) return html;

  const replacements = new Map<string, string>();
  await Promise.all(
    matches.map(async (match) => {
      const source = match[1]?.replace(/&amp;/g, "&");
      if (!source || replacements.has(source)) return;
      const converted = await dzenBodyImageUrl(source, base);
      if (converted) replacements.set(source, converted);
    }),
  );

  let result = html;
  for (const [from, to] of replacements) {
    if (from !== to) result = result.split(from).join(to);
  }
  return result;
}

function renderItem(
  article: FeedArticle,
  base: string,
  enclosure: { url: string; type: "image/jpeg" | "image/png" } | null,
  rewrittenHtml: string,
): string {
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
    contentHtml: rewrittenHtml,
    /*
      Обложка и в `<enclosure>`, и в `<figure>` внутри текста — одна и та же картинка, и
      формат должен быть один.

      Раньше `<figure>` собирался прямо из пути статьи, и картинка в тексте оставалась WebP
      там, где обложка уже стала JPEG. Замер на боевой базе 13 октября: в ленте было 12 JPEG,
      1 PNG и 6 WebP — все шесть из тела материалов, где обложка продублирована в текст.
    */
    coverImage: enclosure?.url ?? article.coverImage,
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

  if (enclosure) {
    /*
      `<enclosure>` — это обложка карточки, и площадка читает её по указанному типу.

      Тип здесь всегда JPEG или PNG: `dzenCoverUrl` отдаёт формат из списка документации, а
      обложку в WebP перекодирует один раз и кладёт рядом с оригиналом. Замер по боевой базе
      показал, что без этого две трети свежих карточек выходили бы вовсе без изображения:
      WebP хранится у половины материалов, потому что загрузка перекодирует всё в него.
    */
    parts.push(
      `      <enclosure url="${escapeXml(enclosure.url)}" type="${enclosure.type}" length="0" />`,
    );
  }

  return `    <item>\n${parts.join("\n")}\n    </item>`;
}

function renderFeed(
  items: FeedArticle[],
  base: string,
  builtAt: Date,
  enclosures: Map<string, { url: string; type: "image/jpeg" | "image/png" }>,
  bodies: Map<string, string>,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(RSS_CHANNEL_TITLE)}</title>
    <link>${escapeXml(base)}</link>
    <atom:link href="${escapeXml(`${base}/api/feed/dzen.xml`)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(RSS_CHANNEL_DESCRIPTION)}</description>
    <language>ru</language>
    <lastBuildDate>${toRfc822(builtAt)}</lastBuildDate>
${items
    .map((article) =>
      renderItem(
        article,
        base,
        enclosures.get(article.id) ?? null,
        bodies.get(article.id) ?? article.contentHtml,
      ),
    )
    .join("\n")}
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

  /*
    Обложки — до отрисовки, потому что перекодирование асинхронное.

    Раньше enclosure собирался из пути статьи, и формат брался из расширения: JPEG, PNG и
    WebP одинаково считались годными. Формально проверка проходила, а по факту карточка
    выходила без изображения — формата в списке Дзена нет. Теперь годность определяет сам
    файл, а не его имя.
  */
  const base = siteUrl();
  const enclosures = new Map<string, { url: string; type: "image/jpeg" | "image/png" }>();

  /*
    Тело материала переписывается здесь же, а не внутри `renderItem`.

    Отрисовка синхронная, а перекодирование асинхронное — колбэк в строковую сборку не
    положить. Заодно это единственное место, где живут обе карты: обложка и текст
    перекодируются одним проходом по материалам, и стоимость на VPS складывается из одной
    выборки вместо двух.
  */
  const bodies = new Map<string, string>();

  await Promise.all(
    articles.map(async (article) => {
      const [url, body] = await Promise.all([
        dzenCoverUrl(article.coverImage, base),
        rewriteBodyImages(article.contentHtml ?? "", base),
      ]);
      bodies.set(article.id, body);
      if (!url) return;
      enclosures.set(article.id, {
        url,
        type: /\.png$/i.test(url.split("?")[0]) ? "image/png" : "image/jpeg",
      });
    }),
  );

  if (articles.length < MIN_ITEMS) {
    console.warn(
      `[dzen] в ленте ${articles.length} материалов из ${candidates.length} отобранных, ` +
        `а требование — не меньше ${MIN_ITEMS}. Причины отсева: короче ${MIN_TEXT_CHARS} символов, ` +
        `окно ${FEED_WINDOW_HOURS} часов, заглушки.`,
    );
  }

  const xml = renderFeed(articles, base, now, enclosures, bodies);

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Five minutes of shared caching, then serve stale while revalidating.
      "Cache-Control": "s-maxage=300, stale-while-revalidate",
    },
  });
}
