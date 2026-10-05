/**
 * Verifies storefront link styling against a real production page.
 *
 * No published article happens to contain a link in its body, so there is nothing
 * to assert against in the wild. Rather than publish new content, this borrows the
 * existing probe article, appends one link of each kind, waits for ISR to pick the
 * change up, checks the rendered page, and puts the original content back.
 *
 * Run with: npx tsx --env-file=.env scripts/yn-links-live.ts
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../src/generated/prisma/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

/**
 * The article borrowed for the check.
 *
 * Taken from the database rather than hard-coded: the slug of an earlier probe
 * article no longer exists on production, and pinning a name here would make the
 * check fail for a reason that has nothing to do with links. Any published article
 * will do, since its text is restored byte for byte afterwards.
 */
async function pickArticle(): Promise<{ slug: string; contentHtml: string }> {
  const candidate = await prisma.article.findFirst({
    where: { status: "published" },
    orderBy: { publishedAt: "desc" },
    select: { slug: true, contentHtml: true },
  });
  if (!candidate) throw new Error("no published article to borrow");
  return candidate;
}
/** The page is ISR with a 5-minute window, so a direct DB write needs no revalidate. */
const POLL_ATTEMPTS = 45;
const POLL_MS = 15_000;

let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
};

function anchorsInBody(html: string): string[] {
  const start = html.indexOf('class="article-body');
  if (start === -1) return [];
  const open = html.indexOf(">", start);
  const end = html.indexOf("</div>", open);
  return [...html.slice(open + 1, end).matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
}

async function main() {
  const borrowed = await pickArticle();
  const SLUG = borrowed.slug;
  const original = { contentHtml: borrowed.contentHtml };
  console.log(`проверяем на статье: ${SLUG}`);

  const probe =
    `${original.contentHtml}\n` +
    '<p>Проверка ссылки: <a href="/news/transportnyy-reform-goroda" target="_blank" rel="noopener noreferrer">внешняя цель</a>.</p>\n' +
    '<p>Проверка своей вкладки: <a href="/news/transportnyy-reform-goroda" target="_self">та же вкладка</a>.</p>\n' +
    '<p>Проверка умолчания: <a href="/news/transportnyy-reform-goroda">без target</a>.</p>';

  await prisma.article.update({
    where: { slug: SLUG },
    data: { contentHtml: probe },
  });

  try {
    let anchors: string[] = [];
    for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
      const html = await (await fetch(`https://eartnews.ru/news/${SLUG}`)).text();
      anchors = anchorsInBody(html);
      if (anchors.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }

    check("Ссылки появились на странице", anchors.length > 0, `${anchors.length} шт.`);

    for (const anchor of anchors) {
      check(
        "Стиль ссылки — янтарный, с подчёркиванием и hover",
        anchor.includes('class="text-amber-600 hover:text-amber-700 underline"'),
        anchor.slice(0, 130),
      );
    }

    const blank = anchors.find((a) => a.includes('target="_blank"'));
    const self = anchors.find((a) => a.includes('target="_self"'));
    const bare = anchors.find((a) => !a.includes("target="));

    check(
      "Явная новая вкладка сохранена вместе с rel",
      Boolean(blank?.includes("rel=")),
      blank?.slice(0, 130) ?? "не найдена",
    );
    check(
      "Выбор «та же вкладка» уважен и не перебит умолчанием",
      Boolean(self?.includes('target="_self"')) && !self?.includes('target="_blank"'),
      self?.slice(0, 130) ?? "не найдена",
    );
    check(
      "Ссылка без target получила умолчание _blank",
      Boolean(bare?.includes('target="_blank"')),
      bare?.slice(0, 130) ?? "не найдена",
    );
  } finally {
    await prisma.article.update({
      where: { slug: SLUG },
      data: { contentHtml: original.contentHtml },
    });
    const restored = await prisma.article.findUnique({
      where: { slug: SLUG },
      select: { contentHtml: true },
    });
    check("Текст статьи возвращён", restored?.contentHtml === original.contentHtml, "на месте");
    await prisma.$disconnect();
  }

  console.log(failed === 0 ? "\nВсе проверки прошли" : `\n${failed} проверок провалено`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
