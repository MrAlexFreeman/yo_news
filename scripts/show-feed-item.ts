/**
 * Prints one feed item's content:encoded so the Dzen markup can be read by eye.
 *
 * Verification tool, not a suite — `npm run feed:check` is the assertion pass.
 */
import { JSDOM } from "jsdom";

const FEED_URL =
  process.env.DZEN_FEED_URL?.trim() || "http://localhost:3000/api/feed/dzen.xml";
const SLUG = process.env.SLUG?.trim() || "transportnyy-reform-goroda";

const CONTENT_NS = "http://purl.org/rss/1.0/modules/content/";

async function main() {
  const xml = await (await fetch(FEED_URL)).text();
  const doc = new JSDOM(xml, { contentType: "application/xml" }).window.document;

  const item = [...doc.querySelectorAll("channel > item")].find(
    (node) => node.querySelector("link")?.textContent?.includes(SLUG) ?? false,
  );

  if (!item) {
    console.log(`Статья ${SLUG} не найдена в фиде`);
    process.exitCode = 1;
    return;
  }

  console.log(`--- ${SLUG} ---`);
  console.log(`title:      ${item.querySelector("title")?.textContent}`);
  console.log(`description: ${item.querySelector("description")?.textContent?.trim()}`);
  console.log(`enclosure:  ${item.querySelector("enclosure")?.outerHTML}`);
  console.log(`\ncontent:encoded:\n`);

  const encoded =
    item.getElementsByTagNameNS(CONTENT_NS, "encoded")[0]?.textContent ?? "";

  const htmlDom = new JSDOM(`<body>${encoded}</body>`);
  console.log(htmlDom.window.document.body.innerHTML.replace(/></g, ">\n<"));

  const images = [...htmlDom.window.document.body.querySelectorAll("img")].map(
    (img) => img.getAttribute("src") ?? "",
  );
  console.log(`\nизображений в теле: ${images.length}`);
  for (const url of images) console.log(`  ${url}`);
  console.log(
    `мелкое фото ${encoded.includes("Мелкий файл") ? "ПРОПУЩЕНО НЕВЕРНО" : "отброшено верно"}`,
  );
  console.log(
    `ссылка на видео: ${encoded.includes("youtu.be") ? "есть" : "НЕТ"}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});