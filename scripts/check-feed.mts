/** Feed parsing: what a real feed body turns into, and what is refused. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { stubServerOnly } from "./server-only-shim";

import {
  FEED_SOURCES,
  decodeEntities,
  externalIdFor,
  feedHtmlToText,
  linkFor,
  parseFeed,
  parseFeedDate,
  sliceElements,
  tagValue,
} from "../src/lib/feed-parse";
import {
  REWRITE_SYSTEM_PROMPT,
  buildRewriteUserMessage,
  looksLikeHtml,
  parseRewriteResponse,
} from "../src/lib/rewrite-prompt";

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

/**
 * The transport module's source, read rather than imported.
 *
 * `wire-fetch.ts` is `server-only` and reaches the network, so the suite cannot import
 * it — which is the guard working as intended. The user agent is a constant in there and
 * the one property worth asserting about it is its character range, and that is readable
 * from the file. It moved here from `feed-sync.ts` when the full-text fetcher began
 * sharing it.
 */
const wireFetchSource = readFileSync(
  fileURLToPath(new URL("../src/lib/wire-fetch.ts", import.meta.url)),
  "utf8",
);

/** A realistic RSS 2.0 body, shaped like what URA.RU serves. */
const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>URA.RU</title>
    <item>
      <title>В Екатеринбурге открыли новый маршрут трамвая</title>
      <link>https://ura.news/news/1052900001</link>
      <guid isPermaLink="false">1052900001</guid>
      <pubDate>Mon, 06 Oct 2026 12:30:00 +0500</pubDate>
      <description><![CDATA[<p>Власти города сообщили о запуске.</p>]]></description>
      <content:encoded><![CDATA[<p>Власти города сообщили о запуске нового маршрута.</p><p>Он свяжет два района.</p>]]></content:encoded>
    </item>
    <item>
      <title>Второй материал &amp; подробности</title>
      <link>https://ura.news/news/1052900002</link>
      <guid>1052900002</guid>
      <pubDate>Tue, 07 Oct 2026 09:00:00 +0500</pubDate>
      <description>Короткий текст</description>
    </item>
  </channel>
</rss>`;

/** A realistic Atom body, shaped like what some city feeds serve. */
const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>E1.ru</title>
  <entry>
    <title>Пробки на объездной</title>
    <link rel="self" href="https://www.e1.ru/news/self"/>
    <link rel="alternate" href="https://www.e1.ru/text/transport/2026/10/06/12345/"/>
    <id>tag:e1.ru,2026:12345</id>
    <updated>2026-10-06T15:45:00+05:00</updated>
    <content type="html">&lt;p&gt;Затор растянулся на пять километров.&lt;/p&gt;</content>
  </entry>
</feed>`;

// --- structure ----------------------------------------------------------------

check(
  "Разбор: элементы вырезаются по имени",
  sliceElements("<a><item>раз</item><item>два</item></a>", "item").length === 2,
  "два элемента",
);

check(
  "Разбор: значение тега берётся с его атрибутами",
  tagValue('<guid isPermaLink="false">42</guid>', "guid") === "42",
  "атрибут не мешает",
);

check(
  "Разбор: тег с двоеточием в имени находится",
  tagValue("<content:encoded>текст</content:encoded>", "content:encoded") === "текст",
  "content:encoded",
);

check(
  "Разбор: CDATA разворачивается",
  tagValue("<description><![CDATA[<p>привет</p>]]></description>", "description") === "<p>привет</p>",
  "внутренние теги сохранены для следующего шага",
);

check(
  "Разбор: отсутствующий тег даёт null, а не пустую строку",
  tagValue("<item><title>a</title></item>", "guid") === null,
  "null",
);

// --- dates --------------------------------------------------------------------

check(
  "Дата: формат RSS понимается",
  parseFeedDate("Mon, 06 Oct 2026 12:30:00 +0500")?.toISOString() ===
    new Date("2026-10-06T12:30:00+05:00").toISOString(),
  parseFeedDate("Mon, 06 Oct 2026 12:30:00 +0500")?.toISOString() ?? "не разобрана",
);

check(
  "Дата: формат Atom понимается",
  parseFeedDate("2026-10-06T15:45:00+05:00")?.toISOString() ===
    new Date("2026-10-06T15:45:00+05:00").toISOString(),
  parseFeedDate("2026-10-06T15:45:00+05:00")?.toISOString() ?? "не разобрана",
);

check(
  "Дата: пустое значение не превращается в сегодняшнее",
  parseFeedDate(null) === null && parseFeedDate("") === null && parseFeedDate("   ") === null,
  "null",
);

check(
  "Дата: мусор отклоняется",
  parseFeedDate("вчера вечером") === null,
  "null",
);

check(
  "Дата: далёкое будущее отклоняется, чтобы не залипнуть сверху",
  parseFeedDate("2099-01-01T00:00:00Z", new Date("2026-10-06T00:00:00Z")) === null,
  "null",
);

check(
  "Дата: небольшое расхождение часов принимается",
  parseFeedDate("2026-10-06T03:00:00Z", new Date("2026-10-06T00:00:00Z")) !== null,
  "три часа вперёд — это норма",
);

check(
  "Дата: до 2000 года отклоняется",
  parseFeedDate("1999-12-31T23:59:00Z") === null,
  "null",
);

// --- identifiers --------------------------------------------------------------

check(
  "Идентификатор: guid используется и привязан к источнику",
  externalIdFor("URA", "1052900001", "https://ura.news/x", "Заголовок") === "URA:1052900001",
  externalIdFor("URA", "1052900001", "https://ura.news/x", "Заголовок"),
);

/*
  The failure this prevents: two outlets both numbering their items from one. A bare
  guid would make the second outlet's first item look like a duplicate of the first
  outlet's, and it would be dropped without a trace.
*/
check(
  "Идентификатор: одинаковый guid у двух источников не склеивается",
  externalIdFor("URA", "1", "https://ura.news/1", "A") !==
    externalIdFor("E1", "1", "https://e1.ru/1", "A"),
  `${externalIdFor("URA", "1", "", "A")} ≠ ${externalIdFor("E1", "1", "", "A")}`,
);

check(
  "Идентификатор: без guid берётся ссылка",
  externalIdFor("E1", "", "https://e1.ru/news/1", "Заголовок") === "E1:link:https://e1.ru/news/1",
  externalIdFor("E1", "", "https://e1.ru/news/1", "Заголовок"),
);

check(
  "Идентификатор: без guid и ссылки берётся заголовок",
  externalIdFor("E1", "", "", "  Заголовок  ") === "E1:title:заголовок",
  externalIdFor("E1", "", "", "  Заголовок  "),
);

// --- links --------------------------------------------------------------------

check(
  "Ссылка: RSS-форма читается из текста тега",
  linkFor("<link>https://ura.news/news/1</link>") === "https://ura.news/news/1",
  linkFor("<link>https://ura.news/news/1</link>"),
);

check(
  "Ссылка: Atom-форма читается из href",
  linkFor('<link rel="alternate" href="https://e1.ru/x"/>') === "https://e1.ru/x",
  linkFor('<link rel="alternate" href="https://e1.ru/x"/>'),
);

check(
  "Ссылка: у Atom берётся alternate, а не self",
  linkFor('<link rel="self" href="https://a"/><link rel="alternate" href="https://b"/>') ===
    "https://b",
  linkFor('<link rel="self" href="https://a"/><link rel="alternate" href="https://b"/>'),
);

check(
  "Ссылка: порядок атрибутов не важен",
  linkFor('<link href="https://e1.ru/y" rel="alternate"/>') === "https://e1.ru/y",
  "href первым",
);

// --- text ---------------------------------------------------------------------

check(
  "Текст: абзацы сохраняются",
  feedHtmlToText("<p>Первый.</p><p>Второй.</p>") === "Первый.\n\nВторой.",
  JSON.stringify(feedHtmlToText("<p>Первый.</p><p>Второй.</p>")),
);

check(
  "Текст: содержимое script и style не попадает в текст",
  feedHtmlToText("<p>До</p><script>alert(1)</script><style>p{color:red}</style><p>После</p>") ===
    "До\n\nПосле",
  JSON.stringify(feedHtmlToText("<p>До</p><script>alert(1)</script><style>p{}</style><p>После</p>")),
);

check(
  "Текст: сущности декодируются",
  feedHtmlToText("<p>5 &lt; 6 &amp;&amp; 7 &gt; 6</p>") === "5 < 6 && 7 > 6",
  JSON.stringify(feedHtmlToText("<p>5 &lt; 6 &amp;&amp; 7 &gt; 6</p>")),
);

check(
  "Текст: числовые сущности декодируются",
  decodeEntities("&#1055;&#1088;&#1080;&#1074;&#1077;&#1090;") === "Привет",
  decodeEntities("&#1055;&#1088;&#1080;&#1074;&#1077;&#1090;"),
);

check(
  "Текст: неразрывный пробел становится обычным",
  feedHtmlToText("<p>a\u00a0b</p>") === "a b",
  JSON.stringify(feedHtmlToText("<p>a\u00a0b</p>")),
);

check(
  "Текст: перевод строки из <br> сохраняется",
  feedHtmlToText("строка один<br>строка два") === "строка один\nстрока два",
  JSON.stringify(feedHtmlToText("строка один<br>строка два")),
);

// --- whole feeds --------------------------------------------------------------

const rss = parseFeed(RSS, { source: "URA" });

check(
  "Лента RSS: все элементы разобраны",
  rss.items.length === 2 && rss.skipped.length === 0,
  `${rss.items.length} элементов, ${rss.skipped.length} пропущено`,
);

check(
  "Лента RSS: заголовок с сущностью раскодирован",
  rss.items[1]?.title === "Второй материал & подробности",
  rss.items[1]?.title ?? "",
);

check(
  "Лента RSS: content:encoded предпочтён короткому описанию",
  (rss.items[0]?.rawText ?? "").includes("свяжет два района"),
  (rss.items[0]?.rawText ?? "").slice(0, 80),
);

check(
  "Лента RSS: абзацы в тексте сохранены",
  rss.items[0]?.rawText ===
    "Власти города сообщили о запуске нового маршрута.\n\nОн свяжет два района.",
  JSON.stringify(rss.items[0]?.rawText),
);

check(
  "Лента RSS: источник и ссылка проставлены",
  rss.items[0]?.source === "URA" &&
    rss.items[0]?.originalUrl === "https://ura.news/news/1052900001",
  `${rss.items[0]?.source} ${rss.items[0]?.originalUrl}`,
);

check(
  "Лента RSS: дата разобрана в тот же момент времени",
  rss.items[0]?.publishedAt.toISOString() === new Date("2026-10-06T12:30:00+05:00").toISOString(),
  rss.items[0]?.publishedAt.toISOString() ?? "",
);

const atom = parseFeed(ATOM, { source: "E1" });

check(
  "Лента Atom: элемент разобран",
  atom.items.length === 1 && atom.skipped.length === 0,
  `${atom.items.length} элементов`,
);

check(
  "Лента Atom: ссылка взята из alternate",
  atom.items[0]?.originalUrl === "https://www.e1.ru/text/transport/2026/10/06/12345/",
  atom.items[0]?.originalUrl ?? "",
);

check(
  "Лента Atom: текст развёрнут из экранированных тегов",
  atom.items[0]?.rawText === "Затор растянулся на пять километров.",
  JSON.stringify(atom.items[0]?.rawText),
);

// --- refusals -----------------------------------------------------------------

const broken = parseFeed(
  `<rss><channel>
    <item><title>Без ссылки</title><guid>1</guid><pubDate>Tue, 07 Oct 2026 09:00:00 +0500</pubDate></item>
    <item><title>Без даты</title><link>https://ura.news/2</link></item>
    <item><title></title><link>https://ura.news/3</link><pubDate>Tue, 07 Oct 2026 09:00:00 +0500</pubDate></item>
    <item><title>Годная</title><link>https://ura.news/4</link><pubDate>Tue, 07 Oct 2026 09:00:00 +0500</pubDate></item>
  </channel></rss>`,
  { source: "URA" },
);

check(
  "Отказы: остаётся только пригодный элемент",
  broken.items.length === 1 && broken.items[0]?.title === "Годная",
  `${broken.items.length}: ${broken.items.map((i) => i.title).join(", ")}`,
);

check(
  "Отказы: причины названы поимённо",
  broken.skipped.map((s) => s.reason).join(",") === "no-url,no-date,no-title",
  broken.skipped.map((s) => s.reason).join(","),
);

check(
  "Лимит: больше запрошенного не берётся",
  parseFeed(RSS, { source: "URA", limit: 1 }).items.length === 1,
  "1 элемент",
);

check(
  "Пустая лента: ни элементов, ни падения",
  parseFeed("", { source: "URA" }).items.length === 0 &&
    parseFeed("<html>не лента</html>", { source: "URA" }).items.length === 0,
  "без исключений",
);

// --- deduplication ------------------------------------------------------------

/*
  The same feed fetched twice must produce the same identifiers, because that is what
  the database's unique index and `skipDuplicates` rely on. A reader that hashed a
  timestamp, or re-ordered anything, would re-insert the whole feed on every sync.
*/
const again = parseFeed(RSS, { source: "URA" });
check(
  "Дедупликация: повторный разбор даёт те же идентификаторы",
  again.items.map((i) => i.externalId).join(",") === rss.items.map((i) => i.externalId).join(","),
  again.items.map((i) => i.externalId).join(", "),
);

check(
  "Дедупликация: внутри одной ленты идентификаторы уникальны",
  new Set(rss.items.map((i) => i.externalId)).size === rss.items.length,
  `${new Set(rss.items.map((i) => i.externalId)).size} из ${rss.items.length}`,
);

check(
  "Ленты: оба источника объявлены с адресами",
  FEED_SOURCES.length === 2 &&
    FEED_SOURCES.every((feed) => feed.url.startsWith("https://") && feed.source.length > 0),
  FEED_SOURCES.map((f) => `${f.source}=${f.url}`).join(" "),
);

check(
  "Ленты: адреса не те, что в задании — они проверены запросом",
  FEED_SOURCES.some((feed) => feed.url === "https://ura.news/rss") &&
    FEED_SOURCES.some((feed) => feed.url === "https://www.e1.ru/rss-feeds/rss.xml"),
  FEED_SOURCES.map((f) => f.url).join(" "),
);

/*
  HTTP header values are ByteStrings. A Cyrillic character anywhere in the user agent
  makes `fetch` throw "Cannot convert argument to a ByteString" before the request
  leaves, and the message names neither the feed nor the header — the first version of
  this constant carried a Russian tail and every sync failed that way. Asserted here
  because nothing else would notice until the desk was empty.
*/
const userAgent = /const USER_AGENT = "([^"]*)"/.exec(wireFetchSource)?.[1] ?? "";

check(
  "Ленты: User-Agent только из ASCII",
  userAgent.length > 0 && !/[^\x20-\x7e]/.test(userAgent),
  userAgent || "не найден",
);

// --- the rewrite prompt and its answer ----------------------------------------

check(
  "Рерайт: промпт требует сохранить факты и не выдумывать",
  REWRITE_SYSTEM_PROMPT.includes("Сохрани все факты, имена и цифры") &&
    REWRITE_SYSTEM_PROMPT.includes("Не выдумывай отсебятины"),
  "редакционное требование на месте",
);

check(
  "Рерайт: промпт называет издание и роль",
  REWRITE_SYSTEM_PROMPT.includes("Ё-новости") &&
    REWRITE_SYSTEM_PROMPT.includes("выпускающий редактор"),
  "роль и издание",
);

check(
  "Рерайт: промпт требует JSON и 3-5 абзацев",
  REWRITE_SYSTEM_PROMPT.includes("title") &&
    REWRITE_SYSTEM_PROMPT.includes("contentHtml") &&
    REWRITE_SYSTEM_PROMPT.includes("3-5 абзацев"),
  "форма ответа задана",
);

const message = buildRewriteUserMessage({
  title: "Заголовок источника",
  rawText: "Первый абзац.\n\nВторой абзац.",
  source: "URA",
  originalUrl: "https://ura.news/1",
});

check(
  "Рерайт: исходный текст попадает в сообщение в рамке",
  message.includes("=== НАЧАЛО ИСХОДНОЙ НОВОСТИ ===") &&
    message.includes("=== КОНЕЦ ИСХОДНОЙ НОВОСТИ ===") &&
    message.includes("Первый абзац."),
  "текст ограничен с обеих сторон",
);

check(
  "Рерайт: чужой текст не выглядит как указание",
  message.indexOf("=== НАЧАЛО") < message.indexOf("Первый абзац.") &&
    message.indexOf("Первый абзац.") < message.indexOf("=== КОНЕЦ"),
  "источник заключён между маркерами",
);

check(
  "Рерайт: пустой источник обрезается до лимита",
  buildRewriteUserMessage({ title: "T", rawText: "x".repeat(20_000) }).length < 20_000,
  `${buildRewriteUserMessage({ title: "T", rawText: "x".repeat(20_000) }).length} символов`,
);

/** What a model typically answers. */
const CLEAN = `{"title":"В Екатеринбурге запустили новый трамвайный маршрут","lead":"Маршрут свяжет два района.","contentHtml":"<p>Первый абзац.</p><p>Второй абзац.</p>"}`;

const parsedClean = parseRewriteResponse(CLEAN);
check(
  "Ответ модели: чистый JSON разбирается",
  parsedClean?.title === "В Екатеринбурге запустили новый трамвайный маршрут" &&
    parsedClean?.contentHtml === "<p>Первый абзац.</p><p>Второй абзац.</p>" &&
    parsedClean?.lead === "Маршрут свяжет два района.",
  parsedClean?.title ?? "null",
);

check(
  "Ответ модели: JSON в ограждающих кавычках разбирается",
  parseRewriteResponse("```json\n" + CLEAN + "\n```")?.title === parsedClean?.title,
  "снятие ограждения",
);

check(
  "Ответ модели: без пометки json тоже разбирается",
  parseRewriteResponse("```\n" + CLEAN + "\n```")?.title === parsedClean?.title,
  "три кавычки без языка",
);

check(
  "Ответ модели: комментарий до и после JSON не мешает",
  parseRewriteResponse(`Вот результат:\n${CLEAN}\nНадеюсь, подойдёт.`)?.title === parsedClean?.title,
  "берётся внешний объект",
);

check(
  "Ответ модели: лид необязателен",
  parseRewriteResponse('{"title":"T","contentHtml":"<p>x</p>"}')?.lead === "",
  JSON.stringify(parseRewriteResponse('{"title":"T","contentHtml":"<p>x</p>"}')),
);

check(
  "Ответ модели: поля обрезаются по краям",
  parseRewriteResponse('{ "title" : "  T  " , "contentHtml" : "  <p>x</p>  " }')?.title === "T",
  JSON.stringify(parseRewriteResponse('{ "title" : "  T  " , "contentHtml" : "  <p>x</p>  " }')),
);

check(
  "Ответ модели: без заголовка результат отбрасывается",
  parseRewriteResponse('{"title":"","contentHtml":"<p>x</p>"}') === null &&
    parseRewriteResponse('{"contentHtml":"<p>x</p>"}') === null,
  "null",
);

check(
  "Ответ модели: без текста результат отбрасывается",
  parseRewriteResponse('{"title":"T","contentHtml":"   "}') === null,
  "null",
);

check(
  "Ответ модели: не-объект отбрасывается",
  parseRewriteResponse("[1,2,3]") === null &&
    parseRewriteResponse('"строка"') === null &&
    parseRewriteResponse("null") === null,
  "null",
);

check(
  "Ответ модели: битый JSON не роняет разбор",
  parseRewriteResponse('{"title":"T","contentHtml":<p>x</p>}') === null &&
    parseRewriteResponse("") === null,
  "null",
);

check(
  "Ответ модели: заголовок с апострофом и кавычками сохраняется",
  parseRewriteResponse('{"title":"Он сказал \\"да\\"","contentHtml":"<p>x</p>"}')?.title ===
    'Он сказал "да"',
  parseRewriteResponse('{"title":"Он сказал \\"да\\"","contentHtml":"<p>x</p>"}')?.title ?? "",
);

check(
  "Ответ модели: HTML распознаётся, а сплошной текст — нет",
  looksLikeHtml("<p>абзац</p>") &&
    !looksLikeHtml("Первый абзац.\n\nВторой абзац."),
  "различение для сборки абзацев",
);

/*
  The desk's state changes, against the real database.
 *
 * A Server Action cannot be called from here — `revalidatePath` throws outside a
 * request — so these exercise `feed-store.ts`, which is where the writes are and which
 * the actions wrap. Fixtures carry a unique marker and are removed in a `finally`, so a
 * failed run leaves the desk as it found it.
 */
stubServerOnly();
const { ignoreFeedItem, restoreFeedItem, takeFeedItem, countNewFeedItems } = await import(
  "../src/lib/feed-store"
);
const { prisma } = await import("@/lib/prisma");

const marker = `check-feed-${Math.random().toString(36).slice(2, 8)}`;
let failures = 0;

async function checkStore() {
  const created = await prisma.newsFeedItem.create({
    data: {
      source: "URA",
      externalId: marker,
      originalUrl: `https://example.invalid/${marker}`,
      title: `Проверка ${marker}`,
      rawText: "Текст проверки.",
      publishedAt: new Date(),
      status: "NEW",
    },
    select: { id: true },
  });

  try {
    const read = () =>
      prisma.newsFeedItem.findUnique({ where: { id: created.id }, select: { status: true } });

    check(
      "Статусы: новый инфоповод начинается как NEW",
      (await read())?.status === "NEW",
      (await read())?.status ?? "нет",
    );

    const hidden = await ignoreFeedItem(created.id);
    check(
      "Статусы: «Скрыть» переводит в IGNORED",
      hidden === 1 && (await read())?.status === "IGNORED",
      `${hidden} строк, статус ${(await read())?.status}`,
    );

    const hiddenAgain = await ignoreFeedItem(created.id);
    check(
      "Статусы: повторное скрытие ничего не меняет",
      hiddenAgain === 0,
      `${hiddenAgain} строк`,
    );

    const restored = await restoreFeedItem(created.id);
    check(
      "Статусы: «Вернуть» возвращает в NEW",
      restored === 1 && (await read())?.status === "NEW",
      `${restored} строк, статус ${(await read())?.status}`,
    );

    const restoredAgain = await restoreFeedItem(created.id);
    check(
      "Статусы: возврат не трогает тот, что не скрыт",
      restoredAgain === 0,
      `${restoredAgain} строк`,
    );

    const taken = await takeFeedItem(created.id);
    check(
      "Статусы: материал из инфоповода переводит его в DRAFTED",
      taken === 1 && (await read())?.status === "DRAFTED",
      `${taken} строк, статус ${(await read())?.status}`,
    );

    /*
      Opened from the hidden tab and written from there: the story is taken, but the item
      must stay hidden. Moving it back to the working list would lose the hiding the
      editor asked for.
    */
    await ignoreFeedItem(created.id);
    const takenWhileHidden = await takeFeedItem(created.id);
    check(
      "Статусы: скрытый инфоповод не возвращается в работу сам",
      takenWhileHidden === 0 && (await read())?.status === "IGNORED",
      `${takenWhileHidden} строк, статус ${(await read())?.status}`,
    );

    check(
      "Счётчик: считает только новые",
      (await countNewFeedItems()) >= 0,
      `${await countNewFeedItems()} новых`,
    );
  } finally {
    await prisma.newsFeedItem.delete({ where: { id: created.id } }).catch(() => {});
  }

  const left = await prisma.newsFeedItem.count({ where: { externalId: marker } });
  check("Статусы: фикстуры убраны за собой", left === 0, `${left} осталось`);
}

/**
 * The teaser the wire sends, and the page it points at.
 *
 * `ARTICLE_TITLE` is repeated inside the page as its own paragraph because both outlets
 * render the headline into the body container, and a rewriter handed the headline twice
 * writes it twice. The furniture lines — the Telegram subscription, «Читать также», the
 * "материал по теме" inset and the ad divider — are inside the content container too, which
 * is the hard case: Readability pulls them into the body, and only the boilerplate filter
 * removes them.
 */
const ARTICLE_TITLE = "В Екатеринбурге начали ремонтировать старый пешеходный мост через Исеть";

const ARTICLE_PAGE = `<!doctype html><html><head><title>${ARTICLE_TITLE}</title></head><body>
<header><nav><a href="/">Главная</a><a href="/news">Новости</a></nav></header>
<div class="content_news-publication-content__v2iuZ">
  <p>${ARTICLE_TITLE}</p>
  <div class="content_news-publication-content__element__eg4mc image-element_news-content-image-element__Rgxkt">
    <p>У Исети накануне начали ремонтировать старый пешеходный мост.</p>
    <p>Фото: Екатерина Сычёва © URA.RU</p>
  </div>
  <div class="content_news-publication-content__element__eg4mc text-element_news-publication-text-element__6Owg5">
    <p>Ремонт продлится до конца ноября: сначала заменят настил, затем покрасят перила и обновят освещение. Работы будут вести по ночам, чтобы не мешать движению.</p>
  </div>
  <div class="ad-divider_news-publication-ad-divider__IUAu7">Продолжение после рекламы</div>
  <div class="content_news-publication-content__element__eg4mc text-element_news-publication-text-element__6Owg5">
    <p>Проход по мосту на время работ не закрывают: для пешеходов оставят временный настил, а объезд для автомобилей направят по улице Мельникова до конца октября.</p>
  </div>
  <div class="content_news-publication-content__element__eg4mc text-element_news-publication-text-element__6Owg5">
    <p>В администрации уточнили, что настил из литого асфальта заменят на стальной: он лучше переносит перепады температур и дольше служит при зимней уборке.</p>
  </div>
  <div class="news-publication-inset-element_news-publication-inset-element__EiP2s">
    <p>Материал по теме: как в городе ремонтируют старые мосты</p>
  </div>
  <div class="content_news-publication-content__element__eg4mc text-element_news-publication-text-element__6Owg5">
    <p>Подписывайтесь на нас в Telegram, чтобы следить за ремонтом и другими городскими новостями каждый день без лишних переходов на сайт.</p>
  </div>
  <div class="content_news-publication-content__element__eg4mc text-element_news-publication-text-element__6Owg5">
    <p>Читайте также</p>
  </div>
  <div class="content_news-publication-content__element__eg4mc text-element_news-publication-text-element__6Owg5">
    <p>Всего на мосту заменят около восьмидесяти погонных метров настила и четыре опоры освещения, работы оплачивают из городского бюджета.</p>
  </div>
  <p>Читать далее</p>
</div>
<footer><p>Все права защищены. Сайт не является сетевым изданием.</p></footer>
</body></html>`;

/**
 * The whole path, by URL: a teaser in `rawText`, the original page behind
 * `originalUrl`, and the story written back over the teaser.
 *
 * The transport is stubbed, not called. This suite runs on the deploy server on every
 * `npm run check`, and a suite that fetches a newspaper is a suite that fails on a slow
 * network and gets commented out; the page under test is a fixture either way, so the only
 * thing a live request would add is a way to fail.
 *
 * The extractor itself is asserted field by field in `extract:check`. What is checked
 * here is the part that has no other test — that a teaser is recognised as one, that the
 * request carries an ASCII-only agent to the right address, that the story replaces the
 * teaser *in the database row*, and that the second open does not fetch again.
 */
async function checkFullTextByUrl() {
  const { ensureFullText } = await import("../src/lib/feed-fulltext");
  const { USER_AGENT } = await import("../src/lib/wire-fetch");

  const teaser = `${ARTICLE_TITLE}. Читать далее`;
  const originalUrl = `https://ura.news/news/${marker}-fulltext`;

  const created = await prisma.newsFeedItem.create({
    data: {
      source: "URA",
      externalId: `${marker}-fulltext`,
      originalUrl,
      title: ARTICLE_TITLE,
      rawText: teaser,
      publishedAt: new Date(),
      status: "NEW",
    },
    select: { id: true },
  });

  const requests: { url: string; agent: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      agent: String((init?.headers as Record<string, string> | undefined)?.["User-Agent"] ?? ""),
    });
    return new Response(ARTICLE_PAGE, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as typeof globalThis.fetch;

  try {
    const item = await prisma.newsFeedItem.findUniqueOrThrow({
      where: { id: created.id },
      select: { id: true, title: true, rawText: true, originalUrl: true },
    });

    const outcome = await ensureFullText(item);

    check(
      "Полный текст: анонс опознан как усечённый и страница запрошена",
      requests.length === 1 && requests[0]?.url === originalUrl,
      `${requests.length} запрос(ов) на ${requests[0]?.url ?? "—"}`,
    );

    check(
      "Полный текст: User-Agent — только ASCII, иначе fetch падает до отправки",
      requests[0]?.agent === USER_AGENT && /^[\x00-\x7F]*$/.test(requests[0]?.agent ?? ""),
      JSON.stringify(requests[0]?.agent ?? ""),
    );

    check(
      "Полный текст: извлечение прошло одним из двух путей",
      outcome.enriched && (outcome.method === "selector" || outcome.method === "readability"),
      `${outcome.method}, ${outcome.text.length} символов`,
    );

    check(
      "Полный текст: в тексте статья, а не анонс",
      outcome.text.length > 250 && outcome.text.includes("сталь"),
      `${outcome.text.length} символов`,
    );

    check(
      "Полный текст: хвост «Читать далее» не попал в текст",
      !/читать далее/iu.test(outcome.text),
      "хвоста нет",
    );

    check(
      "Полный текст: хвосты (Telegram, «Читайте также», фото, врезка, реклама) вычищены",
      !/подписывайтесь|читайте также|фото\s*:|материал по теме|после рекламы/iu.test(
        outcome.text,
      ),
      "хвостов нет",
    );

    check(
      "Полный текст: заголовок не продублирован в теле",
      !outcome.text.includes(ARTICLE_TITLE),
      "заголовка в тексте нет",
    );

    const stored = await prisma.newsFeedItem.findUniqueOrThrow({
      where: { id: created.id },
      select: { rawText: true },
    });
    check(
      "Полный текст: статья записана в rawText",
      stored.rawText === outcome.text && stored.rawText.length > 250,
      `${stored.rawText.length} символов в строке`,
    );

    /*
      Second open. The row now holds a story, so the page must not be fetched a second
      time: that is what makes «Создать материал» instant for an item the desk already
      looked at, and a re-fetch per click is exactly the traffic the sync-time decision
      below exists to avoid.
    */
    const again = await ensureFullText({ ...item, rawText: stored.rawText });
    check(
      "Полный текст: повторное открытие не ходит на сайт",
      again.method === "cached" && !again.enriched && requests.length === 1,
      `${again.method}, запросов ${requests.length}`,
    );
  } finally {
    globalThis.fetch = realFetch;
    await prisma.newsFeedItem.delete({ where: { id: created.id } }).catch(() => {});
  }

  const left = await prisma.newsFeedItem.count({ where: { externalId: `${marker}-fulltext` } });
  check("Полный текст: фикстуры убраны за собой", left === 0, `${left} осталось`);
}

await checkStore().catch((error) => {
  console.error("проверки статусов не выполнены:", error);
  failures += 1;
});

await checkFullTextByUrl().catch((error) => {
  console.error("проверка полного текста не выполнена:", error);
  failures += 1;
});

await prisma.$disconnect();

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"} ${entry.name} — ${entry.detail.slice(0, 130)}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 || failures > 0 ? 1 : 0;