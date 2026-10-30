/**
 * Проверки технической интеграции с Google News и Discover.
 *
 * Три вещи, которые нельзя проверить глазами на странице:
 *   1. окно новостного sitemap — ровно 48 часов, и что в выборку не попадают черновики,
 *      удалённые и noIndex-материалы;
 *   2. XML — экранирование и разбор настоящим парсером, а не поиском подстроки (файл с
 *      неэкранированным `&` Google не читает вовсе, и теряется не одна ссылка, а все);
 *   3. JSON-LD NewsArticle — абсолютные адреса картинки и логотипа, даты в ISO, автор и
 *      издатель.
 *
 * Базы данных и сети здесь нет намеренно: правила живут в `lib/news-sitemap.ts` и
 * `lib/article-jsonld.ts`, маршрут — тонкая обёртка над ними. Живая выдача проверяется
 * отдельно, запросом к боевому сайту.
 */
import { readFileSync } from "node:fs";

import { JSDOM } from "jsdom";

import { buildArticleJsonLd, serializeJsonLd } from "../src/lib/article-jsonld";
import {
  NEWS_SITEMAP_LIMIT,
  NEWS_WINDOW_HOURS,
  buildNewsSitemap,
  escapeXml,
  newsSitemapWhere,
  newsWindowStart,
} from "../src/lib/news-sitemap";
import { ROBOTS_INDEXABLE, ROBOTS_NOINDEX, SITEMAP_PATHS } from "../src/lib/seo";
import { absoluteUrl, siteUrl } from "../src/lib/site";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const NOW = new Date("2026-10-30T12:00:00.000Z");
const ORIGIN = "https://eartnews.ru";

// --- окно и фильтры ---------------------------------------------------------

check(
  "Окно: 48 часов от текущего момента",
  NEWS_WINDOW_HOURS === 48 &&
    newsWindowStart(NOW).toISOString() === "2026-10-28T12:00:00.000Z",
  newsWindowStart(NOW).toISOString(),
);

const where = newsSitemapWhere(NOW);
const publishedAtFilter = where.publishedAt as { gte: Date };

check(
  "Выборка: только опубликованные, живые и не noIndex",
  where.status === "published" &&
    where.deletedAt === null &&
    where.noIndex === false &&
    publishedAtFilter.gte.toISOString() === "2026-10-28T12:00:00.000Z",
  JSON.stringify({ ...where, publishedAt: publishedAtFilter.gte.toISOString() }),
);

check(
  "Выборка: потолок Google News — 1000 ссылок",
  NEWS_SITEMAP_LIMIT === 1000,
  String(NEWS_SITEMAP_LIMIT),
);

// --- XML --------------------------------------------------------------------

const entries = [
  {
    slug: "za-belenkoy-ochered-vystroilas",
    title: 'За беленькой очередь & «дефицит» <икра>',
    publishedAt: new Date("2026-10-30T10:00:00.000Z"),
  },
  {
    slug: "vtoroy-material",
    title: "Второй материал",
    publishedAt: new Date("2026-10-29T10:00:00.000Z"),
  },
];

const xml = buildNewsSitemap(entries, ORIGIN);

check(
  "XML: объявление, пространства имён sitemap и news",
  xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') &&
    xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"') &&
    xml.includes('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"'),
  xml.slice(0, 120),
);

check(
  "XML: абсолютный адрес и по одной ссылке на материал",
  xml.includes(`<loc>${ORIGIN}/news/za-belenkoy-ochered-vystroilas</loc>`) &&
    (xml.match(/<url>/g) ?? []).length === entries.length,
  `${(xml.match(/<url>/g) ?? []).length} из ${entries.length}`,
);

check(
  "XML: дата публикации в W3C/ISO 8601",
  xml.includes("<news:publication_date>2026-10-30T10:00:00.000Z</news:publication_date>"),
  /<news:publication_date>[^<]+<\/news:publication_date>/.exec(xml)?.[0] ?? "нет даты",
);

check(
  "XML: заголовок экранирован, а не вставлен как разметка",
  xml.includes("<news:title>За беленькой очередь &amp; «дефицит» &lt;икра&gt;</news:title>") &&
    !xml.includes("& «дефицит» <"),
  /<news:title>[^<]+/.exec(xml)?.[0] ?? "нет заголовка",
);

const dom = new JSDOM();
const parseXml = (text: string) =>
  new dom.window.DOMParser().parseFromString(text, "application/xml");

const parsed = parseXml(xml);
const parseError = parsed.querySelector("parsererror");

check(
  "XML: разбирается парсером как корректный документ",
  parseError === null && parsed.documentElement.tagName === "urlset",
  parseError ? parseError.textContent?.slice(0, 120) ?? "parsererror" : "urlset",
);

check(
  "XML: имена издателя и язык на месте",
  parsed.getElementsByTagName("news:name")[0]?.textContent === "Ё-новости" &&
    parsed.getElementsByTagName("news:language")[0]?.textContent === "ru",
  `${parsed.getElementsByTagName("news:name")[0]?.textContent} / ${parsed.getElementsByTagName("news:language")[0]?.textContent}`,
);

check(
  "XML: пустая лента даёт корректный пустой urlset",
  (() => {
    const empty = buildNewsSitemap([], ORIGIN);
    const doc = parseXml(empty);
    return (
      doc.querySelector("parsererror") === null &&
      doc.getElementsByTagName("url").length === 0 &&
      empty.includes("</urlset>")
    );
  })(),
  "0 ссылок, документ закрыт",
);

check(
  "XML: управляющие символы вырезаны, амперсанд экранирован один раз",
  escapeXml("a\u0001b & c") === "ab &amp; c" && escapeXml("&amp;") === "&amp;amp;",
  JSON.stringify(escapeXml("a\u0001b & c")),
);

// --- robots.txt -------------------------------------------------------------

const sitemapUrls = SITEMAP_PATHS.map((path) => new URL(path, ORIGIN).toString());

check(
  "robots.txt: обе карты — общая и новостная",
  sitemapUrls.includes(`${ORIGIN}/sitemap.xml`) &&
    sitemapUrls.includes(`${ORIGIN}/news-sitemap.xml`) &&
    // robots.ts must read the list rather than spell it out, or adding a map here would
    // leave robots.txt behind.
    readFileSync(new URL("../src/app/robots.ts", import.meta.url), "utf8").includes(
      "SITEMAP_PATHS",
    ),
  sitemapUrls.join(", "),
);

check(
  "robots: Discover получает large-превью, а не обрезанное",
  ROBOTS_INDEXABLE.googleBot?.["max-image-preview"] === "large" &&
    ROBOTS_INDEXABLE.googleBot?.["max-video-preview"] === -1 &&
    ROBOTS_INDEXABLE.googleBot?.["max-snippet"] === -1 &&
    ROBOTS_NOINDEX.index === false,
  JSON.stringify(ROBOTS_INDEXABLE),
);

// --- JSON-LD ----------------------------------------------------------------

const ld = buildArticleJsonLd({
  title: "За беленькой очередь выстроилась",
  slug: "za-belenkoy-ochered-vystroilas",
  lead: "Пока красная икра дорожает, покупатели выбирают белую.",
  coverImage: "/uploads/stock-bb23b9f7.webp",
  publishedAt: new Date("2026-10-29T14:40:00.000Z"),
  createdAt: new Date("2026-10-29T14:30:00.000Z"),
  updatedAt: new Date("2026-10-29T14:56:46.990Z"),
});

/*
  Адреса в разметке проверяются через `absoluteUrl`, а не через захардкоженный домен:
  значение берётся из того же `site.ts`, что и на странице. Проверка от этого не слабее —
  рядом стоит требование, чтобы адрес был абсолютным, — зато не падает в окружении без
  `NEXT_PUBLIC_SITE_URL`.
*/
check(
  "JSON-LD: NewsArticle с заголовком, лидом и каноническим адресом",
  ld["@type"] === "NewsArticle" &&
    ld.headline === "За беленькой очередь выстроилась" &&
    ld.description === "Пока красная икра дорожает, покупатели выбирают белую." &&
    ld.mainEntityOfPage["@id"] ===
      absoluteUrl("/news/za-belenkoy-ochered-vystroilas") &&
    /^https?:\/\//.test(ld.mainEntityOfPage["@id"]),
  JSON.stringify({ type: ld["@type"], id: ld.mainEntityOfPage["@id"] }),
);

check(
  "JSON-LD: картинка абсолютная",
  Array.isArray(ld.image) &&
    ld.image[0] === absoluteUrl("/uploads/stock-bb23b9f7.webp") &&
    /^https?:\/\//.test(ld.image[0]),
  JSON.stringify(ld.image),
);

check(
  "JSON-LD: даты публикации и изменения в ISO",
  ld.datePublished === "2026-10-29T14:40:00.000Z" &&
    ld.dateModified === "2026-10-29T14:56:46.990Z",
  `${ld.datePublished} / ${ld.dateModified}`,
);

check(
  "JSON-LD: автор и издатель с логотипом",
  ld.author[0]?.name === "Редакция Ё-новости" &&
    ld.publisher.name === "Ё-новости" &&
    ld.publisher.url === siteUrl &&
    ld.publisher.logo.url === absoluteUrl("/icons/icon-512.png"),
  `${ld.author[0]?.name} / ${ld.publisher.logo.url}`,
);

check(
  "JSON-LD: без обложки поле image не появляется пустым",
  !("image" in
    buildArticleJsonLd({
      title: "Без картинки",
      slug: "bez-kartinki",
      createdAt: new Date("2026-10-30T08:00:00.000Z"),
      updatedAt: new Date("2026-10-30T08:00:00.000Z"),
    })),
  "ключ отсутствует",
);

check(
  "JSON-LD: закрывающий тег в заголовке не ломает script",
  !serializeJsonLd({ headline: "ломаем </script><b>x</b>" }).includes("</script>"),
  serializeJsonLd({ headline: "ломаем </script><b>x</b>" }).slice(0, 80),
);

// --- итог -------------------------------------------------------------------

for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"} ${entry.name} — ${entry.detail}`);
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exit(failed.length === 0 ? 0 : 1);
