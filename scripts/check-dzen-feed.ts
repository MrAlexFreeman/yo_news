/**
 * Fetches the Dzen feed and asserts it is well-formed RSS 2.0 with the expected
 * item shape. Run with: npm run feed:check
 */
import { JSDOM } from "jsdom";

const FEED_URL =
  process.env.DZEN_FEED_URL?.trim() || "http://localhost:3000/api/feed/dzen.xml";

const CONTENT_NS = "http://purl.org/rss/1.0/modules/content/";
const ATOM_NS = "http://www.w3.org/2005/Atom";
const MEDIA_NS = "http://search.yahoo.com/mrss/";

// RFC-822 in GMT, e.g. "Thu, 01 Oct 2026 08:11:21 GMT".
const RFC_822 =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

async function main() {
  const response = await fetch(FEED_URL);

  check("HTTP 200", response.status === 200, `статус ${response.status}`);
  check(
    "Content-Type",
    response.headers.get("content-type") === "application/xml; charset=utf-8",
    response.headers.get("content-type") ?? "нет заголовка",
  );

  const cacheControl = response.headers.get("cache-control") ?? "";
  check(
    "Cache-Control",
    cacheControl.includes("s-maxage=300") &&
      cacheControl.includes("stale-while-revalidate"),
    cacheControl || "нет заголовка",
  );

  const xml = await response.text();
  const dom = new JSDOM(xml, { contentType: "application/xml" });
  const doc = dom.window.document;

  const parserError = doc.querySelector("parsererror");
  check(
    "Валидный XML",
    parserError === null,
    parserError?.textContent?.slice(0, 120) ?? "ошибок разбора нет",
  );

  const root = doc.documentElement;
  check("Корень rss", root.tagName === "rss", root.tagName);
  check(
    'Атрибут version="2.0"',
    root.getAttribute("version") === "2.0",
    root.getAttribute("version") ?? "нет",
  );
  check(
    "xmlns:content",
    root.getAttribute("xmlns:content") === CONTENT_NS,
    root.getAttribute("xmlns:content") ?? "нет",
  );
  check(
    "xmlns:atom",
    root.getAttribute("xmlns:atom") === ATOM_NS,
    root.getAttribute("xmlns:atom") ?? "нет",
  );
  check(
    "atom:link rel=self",
    Boolean(
      doc.getElementsByTagNameNS(ATOM_NS, "link")[0]?.getAttribute("rel") ===
        "self",
    ),
    doc.getElementsByTagNameNS(ATOM_NS, "link")[0]?.getAttribute("href") ?? "нет",
  );

  const items = [...doc.querySelectorAll("channel > item")];
  check("Есть items", items.length > 0, `найдено ${items.length}`);
  check("Лимит 50", items.length <= 50, `${items.length} <= 50`);

  const pubDates = items.map((item) =>
    item.querySelector("pubDate")?.textContent?.trim() ?? "",
  );
  check(
    "Формат pubDate",
    pubDates.length > 0 && pubDates.every((value) => RFC_822.test(value)),
    pubDates[0] ?? "нет дат",
  );

  // Compare parsed timestamps, not strings: lexicographic sorting of an
  // RFC-822 date orders by the weekday name ("Wed" > "Thu"), which has
  // nothing to do with chronology.
  const timestamps = pubDates.map((value) => Date.parse(value));
  const parsed = timestamps.every(Number.isFinite);
  const isDescending = timestamps.every(
    (value, index) => index === 0 || value <= timestamps[index - 1],
  );

  check(
    "Сортировка по убыванию даты",
    parsed && isDescending,
    parsed
      ? `${new Date(timestamps[0]).toISOString()} … ${new Date(
          timestamps[timestamps.length - 1],
        ).toISOString()}`
      : "не удалось разобрать даты",
  );

  for (const [index, item] of items.entries()) {
    const fields = ["title", "link", "guid", "pubDate", "description"];
    const missing = fields.filter((field) => !item.querySelector(field));
    check(
      `item[${index}] обязательные теги`,
      missing.length === 0,
      missing.length === 0 ? "все на месте" : `нет: ${missing.join(", ")}`,
    );

    // Resolved by namespace: a CSS selector for "content:encoded" is not
    // reliably supported, and the namespace is what actually matters here.
    const content = item.getElementsByTagNameNS(CONTENT_NS, "encoded")[0];
    check(
      `item[${index}] content:encoded не пуст`,
      Boolean(content && content.textContent?.trim()),
      `${content?.textContent?.length ?? 0} символов`,
    );
  }

  const guids = items.map((i) => i.querySelector("guid")?.textContent?.trim() ?? "");
  check(
    "guid заполнен",
    guids.every((guid) => guid.length > 0),
    guids[0]?.slice(0, 24) ?? "нет",
  );
  check(
    "Без дублей guid",
    new Set(guids).size === guids.length,
    `${new Set(guids).size} из ${guids.length}`,
  );

  const links = items.map((i) => i.querySelector("link")?.textContent?.trim() ?? "");
  check(
    "Абсолютные ссылки",
    links.length > 0 && links.every((link) => link.startsWith("http")),
    links[0] ?? "нет ссылок",
  );

  // The cover was the one URL in the feed that was never absolutised, so it
  // stayed valid only for as long as every cover happened to be a remote URL.
  const enclosures = items
    .map((i) => i.querySelector("enclosure"))
    .filter((e): e is Element => e !== null);
  const enclosureUrls = enclosures.map((e) => e.getAttribute("url") ?? "");
  check(
    "Enclosure: присутствует и абсолютный",
    enclosureUrls.length > 0 && enclosureUrls.every((u) => u.startsWith("http")),
    enclosureUrls[0] ?? "нет enclosure",
  );

  const enclosureTypes = enclosures.map((e) => e.getAttribute("type") ?? "");
  check(
    "Enclosure: type соответствует расширению",
    enclosureUrls.length > 0 &&
      enclosureUrls.every((url, i) => {
        const wanted = url.split("?")[0].toLowerCase().endsWith(".png")
          ? "image/png"
          : url.split("?")[0].toLowerCase().endsWith(".webp")
            ? "image/webp"
            : "image/jpeg";
        return enclosureTypes[i] === wanted;
      }),
    `${enclosureTypes[0] ?? "нет"} для ${enclosureUrls[0] ?? "нет enclosure"}`,
  );

  // --- Dzen's documented rules -------------------------------------------------
  // https://dzen.ru/help/ru/website/rss-modify.html and
  // https://dzen.ru/help/ru/export-content/export.html

  // A feed Dzen cannot finish fetching is not a partially-rendered feed, so the
  // documented 10 MB ceiling is worth asserting rather than assuming.
  const FEED_MAX_BYTES = 10 * 1024 * 1024;
  check(
    "Фид меньше 10 МБ",
    Buffer.byteLength(xml, "utf8") < FEED_MAX_BYTES,
    `${(Buffer.byteLength(xml, "utf8") / 1024 / 1024).toFixed(2)} МБ`,
  );

  /** Dzen renders this tag set inside content:encoded and ignores the rest. */
  const DZEN_SUPPORTED_TAGS = new Set([
    "p", "br", "h1", "h2", "h3", "h4",
    "b", "i", "u", "s",
    "blockquote",
    "ul", "ol", "li",
    "a", "figure", "img", "figcaption",
  ]);

  const itemsWithBody = items
    .map((item) => ({
      item,
      body:
        item.getElementsByTagNameNS(CONTENT_NS, "encoded")[0]?.textContent ?? "",
    }))
    .filter(({ body }) => body.trim().length > 0);

  // Stripped tags keep their text (KEEP_CONTENT), so text-level scraping is the
  // right check: anything outside the set that survived as an element would be
  // rendered by the site and silently dropped by Dzen.
  const foreignTags = new Set<string>();
  const relativeUrls: string[] = [];
  const imgUrls: string[] = [];
  let captionsOutsideFigure = 0;
  let iframeCount = 0;

  for (const { body } of itemsWithBody) {
    const htmlDom = new JSDOM(`<body>${body}</body>`);
    for (const element of htmlDom.window.document.body.querySelectorAll("*")) {
      const tag = element.tagName.toLowerCase();
      if (tag === "iframe") iframeCount += 1;
      if (!DZEN_SUPPORTED_TAGS.has(tag)) foreignTags.add(tag);

      for (const attribute of ["href", "src"]) {
        const value = element.getAttribute(attribute);
        if (value && !/^(https?:|mailto:|tel:|#)/i.test(value)) {
          relativeUrls.push(value);
        }
      }
      if (tag === "img") imgUrls.push(element.getAttribute("src") ?? "");
    }
    // Dzen takes a caption from <figcaption>, so a caption stranded outside a
    // <figure> would never be shown next to its photo.
    captionsOutsideFigure += htmlDom.window.document.body.querySelectorAll(
      "figcaption:not(figure > figcaption)",
    ).length;
  }

  check(
    "content:encoded: только поддерживаемые теги",
    foreignTags.size === 0,
    foreignTags.size === 0
      ? "посторонних тегов нет"
      : `найдены: ${[...foreignTags].join(", ")}`,
  );

  check(
    "content:encoded: нет iframe (Дзен ждёт ссылку на видео)",
    iframeCount === 0,
    `${iframeCount} iframe`,
  );

  check(
    "content:encoded: все ссылки и картинки абсолютные",
    relativeUrls.length === 0,
    relativeUrls.length === 0
      ? `${imgUrls.length} <img>, все абсолютные`
      : `относительные: ${relativeUrls.slice(0, 3).join(", ")}`,
  );

  check(
    "content:encoded: figcaption только внутри figure",
    captionsOutsideFigure === 0,
    `${captionsOutsideFigure} подписей вне figure`,
  );

  // «Этот тег обязателен, но игнорируется при конвертации материала в пост. Если
  // вы хотите, чтобы заголовок отображался в посте, продублируйте его внутри
  // элемента content:encoded.»
  const missingHeadline = itemsWithBody.filter(({ body }) => !/^\s*<h1[\s>]/i.test(body));
  check(
    "content:encoded начинается с <h1> (заголовок для поста)",
    missingHeadline.length === 0,
    missingHeadline.length === 0
      ? "у всех элементов есть заголовок"
      : `без <h1>: ${missingHeadline.length}`,
  );

  // «Первое изображение в статье появится на карточке» — so an item that has both
  // an enclosure and images must lead with a figure, not with the text.
  const figuresBeforeText = itemsWithBody.filter(
    ({ body }) => /^\s*<h1[\s>]/i.test(body) && /<figure/i.test(body.split("</h1>")[1] ?? ""),
  ).length;
  check(
    "Обложка figure идёт до текста",
    figuresBeforeText > 0,
    `${figuresBeforeText} элементов с figure до текста`,
  );

  // One enclosure per item is both the RSS 2.0 rule and Dzen's: the enclosure is
  // the cover / medialock image, which «не отображается внутри текста».
  const multiEnclosure = items.filter(
    (item) => item.querySelectorAll("enclosure").length > 1,
  );
  check(
    "Не больше одного enclosure на элемент",
    multiEnclosure.length === 0,
    `${enclosures.length} enclosure на ${items.length} элементов`,
  );

  // Gallery images belong in the body, not in enclosures.
  const enclosureCountMatchesCovers = items.every((item) => {
    const has = item.querySelector("enclosure") !== null;
    const body = item.getElementsByTagNameNS(CONTENT_NS, "encoded")[0]?.textContent ?? "";
    return has || !/<figure/i.test(body);
  });
  check(
    "Галерея попадает в content:encoded, а не в enclosure",
    enclosureCountMatchesCovers,
    enclosureCountMatchesCovers ? "соответствует" : "расхождение",
  );

  // --- Dzen experiment / publication method ---------------------------------
  // <category> is Dzen's publication-method selector and holds exactly one value.
  // A second one, or an invented element, is how a strict syndicator decides the
  // feed is malformed.
  check(
    "Объявлен xmlns:media (нужен для media:rating)",
    root.getAttribute("xmlns:media") === "http://search.yahoo.com/mrss/",
    root.getAttribute("xmlns:media") ?? "нет",
  );

  const categoriesPerItem = items.map((item) =>
    item.querySelectorAll("category").length,
  );
  check(
    "Не больше одного <category> на элемент",
    categoriesPerItem.every((count) => count <= 1),
    `максимум ${Math.max(0, ...categoriesPerItem)}`,
  );

  const METHODS = new Set(["native-draft", "format-article", "format-post", "index", "noindex"]);
  const methodValues = items
    .map((item) => item.querySelector("category")?.textContent?.trim() ?? "")
    .filter(Boolean);

  check(
    "Значения <category> — из документации Дзена",
    methodValues.every((value) => METHODS.has(value)),
    methodValues.length > 0
      ? [...new Set(methodValues)].join(", ")
      : "нет категорий (ожидаемо без флагов)",
  );

  check(
    "Нет недокументированного тега dzen:native",
    !/dzen:native/.test(xml),
    "отсутствует",
  );

  // media:rating only makes sense with its namespace, and Dzen spells the value
  // "adult" for 18+ material.
  const ratings = [...doc.getElementsByTagNameNS(MEDIA_NS, "rating")];
  check(
    "media:rating использует схему urn:simple",
    ratings.every((node) => node.getAttribute("scheme") === "urn:simple"),
    `${ratings.length} элементов`,
  );
  check(
    "media:rating содержит только adult/nonadult",
    ratings.every((node) => ["adult", "nonadult"].includes(node.textContent?.trim() ?? "")),
    ratings.map((n) => n.textContent?.trim()).join(", ") || "нет",
  );

  // The rubric used to be emitted here. It is no longer, because Dzen reads this
  // element as the publication method and the two cannot share it.
  check(
    "Рубрика больше не занимает <category>",
    !items.some((item) => {
      const value = item.querySelector("category")?.textContent?.trim() ?? "";
      return value.length > 0 && !METHODS.has(value);
    }),
    "только способы публикации",
  );

  console.log(`Лента: ${FEED_URL}\n`);
  for (const { name, ok, detail } of checks) {
    console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
