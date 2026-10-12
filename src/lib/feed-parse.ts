/**
 * Reading another outlet's RSS into the wire desk.
 *
 * A narrow reader, not a general XML parser: it understands the shape an RSS 2.0 or
 * Atom feed has, which is a flat list of `<item>` or `<entry>` elements with a handful
 * of known children. It is deliberately not a dependency — five fields do not justify
 * a parser library, and the alternative available here (`jsdom`, reachable only through
 * a transitive dependency of the sanitiser) is a browser engine brought in to read a
 * list of strings.
 *
 * Pure: no network, no Prisma, no `server-only`. Everything that decides whether an
 * item is usable — the date, the identifier, the text — is therefore testable against
 * real feed bodies, which is where the interesting failures live: a publisher changes
 * its date format, or starts sending an id that collides with another outlet's.
 */

/** The outlets the desk watches. */
export type FeedSource = "E1" | "GOROD66";

export type FeedDefinition = {
  source: FeedSource;
  title: string;
  url: string;
  /**
   * Издание не публикует дат в ленте: материалы датируются временем первого опроса.
   *
   * Измерено, а не предположено: у 66.ru на десять элементов фида ни одного `<pubDate>`,
   * ни одного `dc:date`, ни одного `<date>`. Без этого флага лента даёт ноль материалов —
   * проверено на проде: «66.RU | +0 | отказов: 10 | из них политика: 0».
   */
  undated?: boolean;
};

/**
 * The feeds, in one place.
 *
 * **«Топ Дзен» не подключён, и это измеренный факт, а не недосмотр.** `dzen.ru/rss/news`
 * отвечает 302 на `sso.passport.yandex.ru/push` — публичного фида у Дзена нет, он требует
 * авторизацию Яндекса. Проверено и `zen.yandex.ru/rss/news`, и `dzen.ru/rss`, и
 * `/api/v3/rss/news`: первые два отдают ту же страницу входа (2899 байт HTML, ноль элементов),
 * третий — 44 байта JSON-ошибки. Скрапить это headless-браузером значило бы поставить браузер
 * на VPS с одним ядром, что правилами прямо запрещено.
 *
 * Второй источник поэтому — реальный фид екатеринбургского городского издания, ближайший по
 * характеру к тому, что просили: происшествия и общество без федеральной политики. Оба адреса
 * взяты из объявлений самих сайтов (`<link rel="alternate" type="application/rss+xml">`) и
 * проверены запросом: E1 отвечает 100 элементами, 66.ru — 10.
 */
export const FEED_SOURCES: readonly FeedDefinition[] = [
  { source: "E1", title: "Топ Е1", url: "https://www.e1.ru/rss-feeds/rss.xml" },
  {
    source: "GOROD66",
    title: "66.RU",
    url: "https://66.ru/rss/",
    undated: true,
  },
] as const;

/** Подпись источника для интерфейса: код в базе, человеческое имя на экране. */
export function feedSourceTitle(source: string): string {
  return FEED_SOURCES.find((feed) => feed.source === source)?.title ?? source;
}

export type ParsedFeedItem = {
  source: FeedSource;
  /** Namespaced by source — see `externalIdFor`. */
  externalId: string;
  originalUrl: string;
  title: string;
  rawText: string;
  publishedAt: Date;
};

/** Why an element of the feed could not become an item. */
export type SkipReason = "no-title" | "no-url" | "no-date" | "politics";

/**
 * Темы, которые редакция не берёт: политика, власть и всё, что вокруг них.
 *
 * Списки в двух видах намеренно, и это не украшение. Основы слова работают на русской
 * морфологии («депутат» ловит «депутаты», «депутатский»), но некоторые основы слишком коротки
 * и встречаются внутри обычных слов: «дума» сидит в «передумал», «сво» — в «свой», «мид» — в
 * «миди». Такие слова ищутся как отдельные слова по границам, а не подстрокой, иначе фильтр
 * выбросил бы городскую заметку за слово «передумали».
 *
 * Чего в списке нет — и это тоже решение: «суд», «прокуратура», «уголовное дело». Это
 * происшествия, которые предложке как раз и нужны; выбрасывать их значило бы вычистить из
 * ленты то, ради чего она существует. Политика для этой ленты — власть и её процедуры, а не
 * криминальная хроника.
 */
export const POLITICS_STEMS: readonly string[] = [
  "политик",
  "депутат",
  "выбор",
  "кремл",
  "законопроект",
  "парти",
  "президент",
  "губернатор",
  "правительств",
  "министр",
  "сенатор",
  "госдум",
  "совфед",
  "оппозици",
  "митинг",
  "протест",
  "санкци",
  "мобилизаци",
  "спецоперац",
  "чиновник",
  "коррупци",
  "отставк",
  "администраци",
  "заксобрани",
  "законодательн",
  "парламент",
  "референдум",
  "полпред",
  "путин",
  "единая россия",
];

/**
 * Слова, которые ищутся целиком: короткая основа здесь — часть обычных слов.
 *
 * Формы выписаны по отдельности, а не основой, и это то же измерение, что и выше: «глава»
 * целиком — это назначение или отставка, а «главная»/«главный» — обычные слова, и основа
 * «глав» выбросила бы половину ленты. Так же «мэр»: формы есть, а «мэрия» — нет, потому что
 * «в мэрии сообщили» стоит в доброй половине городских заметок, которые этой ленте как раз и
 * нужны. Политик — тот, кого назначили; пресс-служба, которую цитируют, — нет.
 */
export const POLITICS_WORDS: readonly string[] = [
  "сво",
  "мид",
  "цик",
  "дума",
  "думу",
  "думе",
  "думы",
  "думой",
  "глава",
  "главы",
  "главе",
  "главу",
  "главой",
  "мэр",
  "мэра",
  "мэру",
  "мэром",
  "мэре",
  "мэры",
  "мэров",
  "мэрам",
  "указ",
  "указа",
  "указом",
  "указе",
];

/**
 * Политическое ли это. Заголовок и описание вместе: тема обычно объявлена в одном из них.
 *
 * Чистая функция, и это важно: отбор происходит при импорте, до записи в базу, поэтому
 * материал с признаками политики не попадает в предложку вообще — а не прячется в
 * интерфейсе, где его однажды покажут снова.
 */
export function isPoliticalText(...parts: readonly string[]): boolean {
  const haystack = parts.join(" ").toLowerCase();
  if (!haystack.trim()) return false;

  const word = (candidate: string) =>
    new RegExp(`(^|[^а-яёa-z])${candidate}([^а-яёa-z]|$)`, "i").test(haystack);

  if (POLITICS_WORDS.some(word)) return true;
  return POLITICS_STEMS.some((stem) => haystack.includes(stem));
}

export type ParseResult = {
  items: ParsedFeedItem[];
  skipped: { reason: SkipReason; title: string }[];
};

/** How many items are taken from one feed by default. */
export const DEFAULT_FEED_LIMIT = 40;

/**
 * The identifier an item is deduplicated by.
 *
 * The outlet's own guid wins, because that is what the publisher promises is stable —
 * a story re-published under a new path keeps its guid and would otherwise arrive
 * twice. The link is the fallback, and a title hash the last resort.
 *
 * Namespaced by source on purpose. Two outlets can both number their items from one,
 * and a bare guid would then make the second one look like a duplicate of the first and
 * silently drop it — the kind of missing story nobody reports, because it is missing.
 */
export function externalIdFor(
  source: FeedSource,
  guid: string,
  url: string,
  title: string,
): string {
  const trimmed = guid.trim();
  if (trimmed) return `${source}:${trimmed}`;

  const link = url.trim();
  if (link) return `${source}:link:${link}`;

  return `${source}:title:${title.trim().toLowerCase()}`;
}

/**
 * The inner content of every `<tag>` in a document.
 *
 * Non-greedy and non-nesting: `<item>` never contains another `<item>`, which is the
 * only structural assumption this reader makes. Entries are taken as-is, including any
 * inner `<content>` that happens to contain markup.
 */
export function sliceElements(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? "");
}

/** The text of the first `<name>` inside a block, CDATA unwrapped. */
export function tagValue(block: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}\\s*>`, "i");
  const match = pattern.exec(block);
  return match ? unwrapCdata(match[1] ?? "") : null;
}

/** `<![CDATA[…]]>` is a wrapper, not content. */
export function unwrapCdata(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/^\s*<!\[CDATA\[/, "")
    .replace(/\]\]>\s*$/, "");
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  deg: "°",
};

/** Decodes the entities a feed actually contains, named and numeric. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED[name.toLowerCase()] ?? match)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)));
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 1 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

/**
 * Another outlet's HTML, as text with its paragraphs kept.
 *
 * Deliberately not `htmlToPlainText` from the messenger module, even though the two
 * look alike. The difference is the input: that one reads markup the newsroom's own
 * editor produced, this one reads whatever a third party sent — including `<script>`,
 * `<style>` and `<noscript>` blocks whose contents must not reach the rewriter as text.
 *
 * The order is decode-then-strip, which is the opposite of the messenger's, and it
 * matters for both feed dialects:
 *
 *  - Atom escapes the payload: `<content type="html">&lt;p&gt;…&lt;/p&gt;</content>`.
 *    Stripping tags first leaves the literal characters `<p>…</p>` in the text, and the
 *    rewriter would then be given markup dressed as prose. Measured on a real Atom body.
 *  - RSS wraps the payload in CDATA, so it arrives already literal and decoding is a
 *    no-op for it.
 *
 * The cost of decoding first is that a `<` which is genuinely prose ("5 &lt; 6") becomes
 * a character the stripper has to recognise as not-a-tag. That is what the tag pattern
 * below is for: a tag starts with a letter, `/`, `!` or `?`, so ` < 6 ` survives while
 * `</p>` does not.
 */
export function feedHtmlToText(html: string): string {
  if (!html.trim()) return "";

  const text = decodeEntities(html)
    .replace(/<(script|style|noscript|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(
      /<\/?(?:p|div|section|article|h[1-6]|blockquote|ul|ol|li|tr|figure|figcaption|table)\b[^>]*>/gi,
      "\n\n",
    )
    .replace(/<br\s*\/?>/gi, "\n")
    // Everything else that still looks like a tag. `[a-zA-Z!/?]` after the bracket is
    // what separates `</p>` from the prose " < 6 ".
    .replace(/<[a-zA-Z!/?][^>]*>/g, "");

  return text
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first date this reader can believe, or null. */
export function parseFeedDate(raw: string | null, now = new Date()): Date | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  // A date before this reader existed, or well in the future, is a broken field rather
  // than a story. The future case matters most: a feed that sends a wrong year would
  // otherwise pin one item to the top of the desk for ever.
  const floor = Date.UTC(2000, 0, 1);
  const ceiling = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() < floor || parsed.getTime() > ceiling) return null;

  return parsed;
}

/** Resolves the item's link, for both feed dialects. */
export function linkFor(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)];

  // Atom: `<link rel="alternate" href="…"/>`. Picked by rel because an entry can carry
  // several links and the one a reader should open is the alternate.
  const withHref =
    links.find(
      (match) => /rel\s*=\s*["']?alternate/i.test(match[1] ?? "") && /href\s*=/i.test(match[1] ?? ""),
    ) ?? links.find((match) => /href\s*=/i.test(match[1] ?? ""));

  if (withHref) {
    const href = /href\s*=\s*["']([^"']*)["']/i.exec(withHref[1] ?? "");
    if (href?.[1]) return decodeEntities(href[1].trim());
  }

  // RSS: `<link>https://…</link>`.
  return decodeEntities((tagValue(block, "link") ?? "").trim());
}

/**
 * One feed body into items.
 *
 * `limit` is a ceiling on what is taken, not on what is read: the desk shows the newest
 * items, and a feed that suddenly publishes a year of archive should not fill the table
 * on the first sync.
 *
 * `assumeUndated` — для издания, которое дат в ленте не публикует вовсе: материал получает
 * время опроса вместо отказа. Ставится по источнику, а не глобально, потому что правило
 * «без даты — отказ» верно для ленты, которая даты несёт и иногда теряет.
 */
export function parseFeed(
  xml: string,
  options: { source: FeedSource; limit?: number; now?: Date; assumeUndated?: boolean },
): ParseResult {
  const limit = options.limit ?? DEFAULT_FEED_LIMIT;
  const now = options.now ?? new Date();

  const rssItems = sliceElements(xml, "item");
  const atomEntries = sliceElements(xml, "entry");
  const blocks = rssItems.length > 0 ? rssItems : atomEntries;

  const items: ParsedFeedItem[] = [];
  const skipped: ParseResult["skipped"] = [];

  for (const block of blocks) {
    const rawTitle = tagValue(block, "title") ?? "";
    const title = feedHtmlToText(rawTitle);

    if (!title) {
      skipped.push({ reason: "no-title", title: "" });
      continue;
    }

    const url = linkFor(block);
    if (!url) {
      skipped.push({ reason: "no-url", title });
      continue;
    }

    // `content:encoded` is what feeds put the whole story in; `description` is often an
    // excerpt. Atom uses `content` and `summary`. First one present wins.
    const body =
      tagValue(block, "content:encoded") ??
      tagValue(block, "content") ??
      tagValue(block, "description") ??
      tagValue(block, "summary") ??
      "";

    const publishedAt =
      parseFeedDate(
        tagValue(block, "pubDate") ?? tagValue(block, "published") ?? tagValue(block, "updated"),
        now,
      ) ?? (options.assumeUndated ? now : null);

    /*
      Лента без дат.

      Обычно элемент без даты отбрасывается: рассказать, когда материал вышел, лента не
      смогла, а поставить ему время опроса значило бы выдать догадку за факт — наверху списка
      такой материал стоял бы вечно.

      Но это правило про ленту, которая даты носит и иногда теряет. `assumeUndated` — про
      издание, которое их не публикует вовсе (у 66.ru на десять элементов фида ни одного
      `<pubDate>` и ни одного `dc:date`). Такому источнику выбора нет: либо дата опроса, либо
      ни одного материала. Дата опроса при этом не «догадка о публикации» — это когда
      предложка впервые увидела материал, и для стола новостей это ровно то, что нужно:
      дедупликация по `externalId` не даёт элементу обновиться, поэтому время закрепляется за
      ним навсегда и порядок не переставляется.
    */
    if (!publishedAt) {
      skipped.push({ reason: "no-date", title });
      continue;
    }

    const rawText = feedHtmlToText(body);

    /*
      Политика отсекается здесь — до записи, а не при показе.

      Материал, попавший в таблицу, однажды всплывёт: предложка фильтруется по статусу, а не
      по теме, и «отложенный» политический сюжет вернётся в список при первом же изменении
      фильтра. Не записывать его вовсе — единственная форма, которая не даёт ему вернуться.
    */
    if (isPoliticalText(title, rawText)) {
      skipped.push({ reason: "politics", title });
      continue;
    }

    items.push({
      source: options.source,
      externalId: externalIdFor(
        options.source,
        tagValue(block, "guid") ?? tagValue(block, "id") ?? "",
        url,
        title,
      ),
      originalUrl: url,
      title,
      rawText,
      publishedAt,
    });

    if (items.length >= limit) break;
  }

  return { items, skipped };
}
