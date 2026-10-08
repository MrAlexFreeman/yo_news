/**
 * An article with a photo in the middle and a quotation, seen through the storefront.
 *
 * Written because the two halves of this feature are verified in different places and
 * neither of them is the thing a reader gets. `ui:check` proves the editor keeps the
 * markup and inserts at the caret; the sanitiser and the round trip are pure. None of
 * that says the published page renders a figure with a caption and a quotation with an
 * attribution, and none of it says the stylesheet the reader downloads carries the rules
 * those classes need.
 *
 * So this puts a real row in the database, fetches the real page over HTTP, and reads
 * the real CSS bundle. Cleaned up in a `finally`; the fixture carries a marker so a
 * stale cache entry from an earlier run cannot pass for a live answer.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../src/generated/prisma/client";

const BASE = (process.env.CHECK_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail.slice(0, 150)}`);
};

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }),
});

const RUN = Math.random().toString(36).slice(2, 8);
const SLUG = `proverka-foto-citaty-${RUN}`;
const { UPLOAD_DIR } = await import("../src/lib/upload-dir");

const COVER_NAME = `check-figure-${RUN}.png`;
const COVER_URL = `/uploads/${COVER_NAME}`;

// A real 8x8 PNG: the page has to be able to serve it, and an unparseable file would
// make a broken-image assertion meaningless.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=",
  "base64",
);

const BODY = [
  "<p>Первый абзац проверочного материала.</p>",
  `<figure class="article-figure"><img src="${COVER_URL}" alt="Проверочное фото"><figcaption class="article-figure__caption">Подпись к фото посреди текста</figcaption></figure>`,
  "<p>Абзац сразу под фотографией.</p>",
  '<blockquote><p>Это проверочная цитата, достаточно длинная, чтобы перенестись на вторую строку.</p><p><cite class="article-quote__source">— Иван Петров, источник</cite></p></blockquote>',
  "<p>Заключительный абзац.</p>",
].join("");

async function main() {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, COVER_NAME), PNG);

  let id: string | null = null;

  try {
    const article = await prisma.article.create({
      data: {
        title: `Проверка фото и цитаты ${RUN}`,
        slug: SLUG,
        contentHtml: BODY,
        coverImage: COVER_URL,
        status: "published",
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    id = article.id;

    const response = await fetch(`${BASE}/news/${SLUG}`);
    const html = await response.text();

    /*
      The flight payload is a serialised copy of the same tree, so a bare `indexOf` over
      the whole response finds the payload's copy of a paragraph before the rendered one
      and the order check below would compare the wrong things. Everything is asserted
      against the visible markup instead.
    */
    const visible = html.replace(/<script[\s\S]*?<\/script>/g, "");

    check("Статья: страница отдаётся", response.status === 200, `статус ${response.status}`);

    check(
      "Статья: фото — это <figure class=\"article-figure\">",
      /<figure class="article-figure">/.test(visible),
      (visible.match(/<figure[^>]*>/) ?? ["нет figure"])[0],
    );

    check(
      "Статья: подпись — <figcaption> с классом и текстом",
      /<figcaption class="article-figure__caption">Подпись к фото посреди текста<\/figcaption>/.test(
        visible,
      ),
      (visible.match(/<figcaption[^>]*>[^<]*/) ?? ["нет figcaption"])[0],
    );

    check(
      "Статья: картинка ведёт на загруженный файл",
      visible.includes(`src="${COVER_URL}"`),
      COVER_URL,
    );

    check(
      "Статья: у картинки сохранён alt",
      /<img[^>]*alt="Проверочное фото"/.test(visible),
      (visible.match(/<img[^>]*>/) ?? ["нет img"])[0],
    );

    /*
      The order of the blocks is checked *inside the body*, and the search starts at the
      body element rather than at the top of the document.

      Measured: the same opening words appear near the top of the page too — the page
      meta description is built from the body — so a plain `indexOf` finds the description
      first and reports the photo as being after the paragraph that follows it. Scoping
      the search to the body is what makes the assertion about the article rather than
      about the head.
    */
    const bodyStart = visible.indexOf('class="article-body');
    const firstParagraph = visible.indexOf("Первый абзац", bodyStart);
    const figureAt = visible.indexOf("article-figure", bodyStart);
    const underPhoto = visible.indexOf("Абзац сразу под фотографией", bodyStart);

    check(
      "Статья: тело статьи найдено на странице",
      bodyStart > 0,
      `article-body на позиции ${bodyStart}`,
    );

    check(
      "Статья: фото стоит между абзацами, а не в конце",
      firstParagraph > 0 && figureAt > firstParagraph && underPhoto > figureAt,
      `абзац ${firstParagraph} < фото ${figureAt} < следующий абзац ${underPhoto}`,
    );

    check(
      "Статья: цитата осталась <blockquote>",
      /<blockquote>/.test(visible),
      (visible.match(/<blockquote[^>]*>/) ?? ["нет blockquote"])[0],
    );

    check(
      "Статья: источник цитаты — <cite> с классом",
      /<cite class="article-quote__source">— Иван Петров, источник<\/cite>/.test(visible),
      (visible.match(/<cite[^>]*>[^<]*/) ?? ["нет cite"])[0],
    );

    check(
      "Статья: просмотры не сломались",
      response.headers.get("content-type")?.includes("text/html") ?? false,
      response.headers.get("content-type") ?? "нет content-type",
    );

    // The file the reader downloads, not the one the server rendered: a rule in
    // globals.css that never made it into the bundle would still pass a source check.
    const hrefs = [
      ...new Set(
        [...html.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((match) => match[1]),
      ),
    ];
    let css = "";
    for (const href of hrefs) {
      const stylesheet = await fetch(`${BASE}${href}`);
      if (stylesheet.ok) css += await stylesheet.text();
    }

    check(
      "Стили: bundle со стилями найден и не пуст",
      hrefs.length > 0 && css.length > 1000,
      `${hrefs.length} файл(ов), ${css.length} символов`,
    );

    check(
      "Стили: правило фигуры попало в bundle",
      css.includes("figure.article-figure"),
      "селектор .article-body figure.article-figure",
    );

    check(
      "Стили: подпись стилизуется по классу из разметки",
      /\.article-body \.article-figure__caption/.test(css.replace(/\s+/g, " ")) &&
        /text-align:\s*center/.test(css),
      "класс подписи использован в селекторе, текст центрирован",
    );

    check(
      "Стили: фото не выходит за колонку",
      /figure\.article-figure img\s*\{[^}]*width:\s*100%/.test(css.replace(/\s+/g, " ")),
      "width: 100%",
    );

    check(
      "Стили: у цитаты увеличенный интерлиньяж",
      /\.article-body blockquote\s*\{[^}]*line-height:\s*1\.9/.test(css.replace(/\s+/g, " ")),
      "line-height: 1.9",
    );

    /*
      The opening mark, in whichever form the minifier left it. Measured: the built
      stylesheet carries the literal character, not the `\\201E` escape the source is
      written with — so a check for the escape alone fails on a stylesheet that is
      perfectly correct.
    */
    check(
      "Стили: цитата открывается кавычкой",
      css.includes("\u201E") || /\\201e/i.test(css),
      css.includes("\u201E") ? "literal „" : "escape",
    );

    check(
      "Стили: кавычка не приклеена к первому слову",
      // `\201E ` would lose the space to the escape terminator; the rule uses `\00a0`.
      /content:\s*"[^"]*\u201E[\s\u00a0]/.test(css) ||
        /content:\s*"[^"]*\\201e\\0*0?a0/i.test(css),
      (css.match(/content:\s*"[^"]*\u201E[^"]*"/) ?? ["не найдено"])[0],
    );

    check(
      "Стили: источник цитаты оформлен отдельной строкой",
      /article-quote__source\s*\{[^}]*display:\s*block/.test(css.replace(/\s+/g, " ")),
      "display: block",
    );
  } finally {
    if (id) await prisma.article.delete({ where: { id } }).catch(() => {});
    await rm(path.join(UPLOAD_DIR, COVER_NAME), { force: true }).catch(() => {});
    await prisma.$disconnect();
  }

  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("сбой:", error);
  process.exitCode = 1;
});
