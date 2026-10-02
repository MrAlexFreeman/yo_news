/**
 * Fetches the Dzen feed and asserts it is well-formed RSS 2.0 with the expected
 * item shape. Run with: npm run feed:check
 */
import { JSDOM } from "jsdom";

const FEED_URL =
  process.env.DZEN_FEED_URL?.trim() || "http://localhost:3000/api/feed/dzen.xml";

const CONTENT_NS = "http://purl.org/rss/1.0/modules/content/";
const ATOM_NS = "http://www.w3.org/2005/Atom";

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
