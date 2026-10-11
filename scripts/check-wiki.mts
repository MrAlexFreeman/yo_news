/**
 * The wiki: public pages, the redirect from the old address, and the mentions block.
 *
 * A suite of its own rather than part of `check-security`, for the reason that file gives
 * for its own shape: it cannot import Prisma (`server-only`), so anything needing a row in
 * the database has to live in a suite that can. This one needs rows — a card and a story
 * that links it — because the parts worth checking are the ones no pure function can
 * answer: does `/wiki/<slug>` render the story that mentions the card, and does the address
 * this feature used before answer with a redirect instead of a 404.
 *
 * Run with: npx tsx --env-file=.env scripts/check-wiki.mts
 */

import { randomUUID } from "node:crypto";

const BASE = process.env.CHECK_BASE_URL?.trim() || "http://localhost:3000";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const { prisma } = await import("../src/lib/prisma");
const { ENTITY_LINK_CLASS, ENTITY_SLUG_ATTRIBUTE, entityHref } = await import(
  "../src/lib/entity-card"
);
const { sanitizeArticleHtml } = await import("../src/lib/sanitize");

const suffix = randomUUID().slice(0, 8);
const cardSlug = `proverka-wiki-${suffix}`;
const articleSlug = `proverka-wiki-material-${suffix}`;
/** A description long enough that the old 3000 limit would have refused it. */
const longDescription =
  "Проверка страницы объекта. ".repeat(120).trim() +
  "\n\nВторой абзац описания, который должен остаться отдельным абзацем.";

let articleId = "";

try {
  /* ---- the fixture ---- */
  await prisma.entityCard.create({
    data: {
      slug: cardSlug,
      title: `Проверка вики ${suffix}`,
      category: "Тестовый объект",
      summary: longDescription,
      location: "г. Екатеринбург",
      images: JSON.stringify(["/uploads/proverka-wiki.webp"]),
    },
  });

  const article = await prisma.article.create({
    data: {
      title: `Материал о проверке вики ${suffix}`,
      slug: articleSlug,
      lead: "Лид проверочного материала.",
      contentHtml: `<p>Текст со ссылкой на <a href="${entityHref(cardSlug)}">объект</a> внутри.</p>`,
      status: "published",
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  articleId = article.id;

  /*
    A second story linking the *old* address, which is what every article published before
    the rename carries. It has to count as a mention too, or a card would appear to have
    fewer references than it has.
  */
  const legacy = await prisma.article.create({
    data: {
      title: `Старый адрес в материале ${suffix}`,
      slug: `proverka-wiki-legacy-${suffix}`,
      contentHtml: `<p>Ссылка по старому адресу: <a href="/entities/${cardSlug}">объект</a>.</p>`,
      status: "published",
      publishedAt: new Date(Date.now() - 86_400_000),
    },
    select: { id: true },
  });

  /* ---- the model kept a page-long description ---- */
  const stored = await prisma.entityCard.findUnique({
    where: { slug: cardSlug },
    select: { summary: true },
  });
  check(
    "Вики: подробное описание хранится целиком",
    stored?.summary === longDescription && longDescription.length > 3000,
    `${stored?.summary.length ?? 0} символов сохранено, было ${longDescription.length}`,
  );

  /*
    The mentions are asserted through the page rather than through the query.

    `lib/entities.ts` is `server-only` and cannot be imported from a script — the same
    constraint `check-security` documents for its own shape. What matters anyway is what the
    reader gets, and the page shows both the entries and their count, so the HTTP result is
    the stronger assertion: it covers the query, the prefix handling and the render together.
  */

  /* ---- the public page ---- */
  const page = await fetch(`${BASE}${entityHref(cardSlug)}`);
  const html = await page.text();
  /*
    React writes `<!-- -->` between adjacent text nodes, so `({mentions})` in the markup
    arrives as `(<!-- -->2<!-- -->)` and a plain `includes("(2)")` would miss a heading that
    is perfectly correct. Stripping the markers reconstructs the text a reader sees; the raw
    HTML is still used for anything asserting on tags.
  */
  const text = html.replace(/<!--.*?-->/g, "");

  check(
    "Вики: страница объекта отдаётся",
    page.status === 200,
    `HTTP ${page.status}`,
  );
  check(
    "Вики: заголовок и категория на месте",
    html.includes(`Проверка вики ${suffix}`) && html.includes("Тестовый объект"),
    "заголовок и бейдж",
  );
  check(
    "Вики: описание напечатано целиком, а не обрезано",
    // The tail of a description longer than the old limit — the whole reason the limit moved.
    html.includes("Второй абзац описания, который должен остаться отдельным абзацем."),
    "хвост описания на странице",
  );
  check(
    "Вики: второй абзац описания остался отдельным абзацем",
    /<p[^>]*>Второй абзац описания/.test(html),
    "абзацы не слиты",
  );

  /*
    The block that makes the page a hub rather than a dead end.

    Both stories, including the one that links the old address: the redirect handles a
    reader who follows that link, and this handles the card's own page listing it.
  */
  check(
    "Вики: «Материалы по теме» ведут на упомянувшие материалы",
    text.includes("Материалы по теме") &&
      html.includes(`/news/${articleSlug}`) &&
      text.includes(`Материал о проверке вики ${suffix}`),
    "список упоминаний отрисован",
  );

  check(
    "Вики: счётчик упоминаний учитывает оба адреса",
    // Two stories link the card — one by the current address and one by the old one — and
    // the heading prints the count. A query that only knew `/wiki/` would print (1).
    text.includes("(2)"),
    "счётчик в заголовке блока",
  );

  check(
    "Вики: метатеги заполнены из карточки",
    /<meta[^>]*property="og:title"[^>]*Проверка вики/.test(html) &&
      /<meta[^>]*name="description"[^>]*/.test(html) &&
      /rel="canonical"[^>]*\/wiki\//.test(html),
    "og:title, description, canonical",
  );

  /* ---- the old address ---- */
  const legacyResponse = await fetch(`${BASE}/entities/${cardSlug}`, { redirect: "manual" });
  check(
    "Вики: старый адрес отвечает постоянным перенаправлением, а не 404",
    // 308 rather than 302: the move is not provisional, and the old address' ranking should
    // transfer rather than be duplicated across two live copies of the same entry.
    legacyResponse.status === 308 &&
      (legacyResponse.headers.get("location") ?? "").endsWith(entityHref(cardSlug)),
    `${legacyResponse.status} → ${legacyResponse.headers.get("location") ?? "нет location"}`,
  );

  /* ---- what reaches the reader from an article ---- */
  const rendered = sanitizeArticleHtml(
    `<p>Ссылка на <a href="${entityHref(cardSlug)}">объект</a>.</p>`,
  );
  check(
    "Вики: инлайн-ссылка в статье несёт класс и slug и открывается в этой вкладке",
    rendered.includes(`class="${ENTITY_LINK_CLASS}"`) &&
      rendered.includes(`${ENTITY_SLUG_ATTRIBUTE}="${cardSlug}"`) &&
      !rendered.includes("target="),
    rendered.slice(0, 160),
  );

  /* ---- a slug that does not exist ---- */
  const missing = await fetch(`${BASE}/wiki/etogo-obekta-net-${suffix}`);
  check(
    "Вики: несуществующий объект отдаёт 404, а не пустую страницу",
    missing.status === 404,
    `HTTP ${missing.status}`,
  );

  await prisma.article.deleteMany({ where: { id: { in: [article.id, legacy.id] } } });
} finally {
  await prisma.article.deleteMany({
    where: { slug: { startsWith: `proverka-wiki-` } },
  });
  await prisma.entityCard.deleteMany({ where: { slug: cardSlug } });
  if (articleId) {
    await prisma.article.deleteMany({ where: { id: articleId } });
  }
  await prisma.$disconnect();
}

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"} ${entry.name} — ${entry.detail}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exit(failed.length > 0 ? 1 : 0);
