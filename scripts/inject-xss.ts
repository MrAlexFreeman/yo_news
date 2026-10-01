/**
 * Restores the article that scripts/inject-xss.ts used for the XSS check.
 * Run with: npx tsx --env-file=.env scripts/inject-xss.ts --restore
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  }),
});

const PAYLOAD = `
<p>Обычный абзац.</p>
<script>window.__xssExecuted = true;</script>
<img src="x" onerror="window.__xssExecuted = true">
<a href="javascript:window.__xssExecuted = true">ссылка</a>
<iframe src="https://evil.test"></iframe>
<p onclick="window.__xssExecuted = true">Текст с обработчиком</p>
<blockquote>Цитата для проверки вёрстки</blockquote>
<table><tbody><tr><td>Ячейка</td></tr></tbody></table>
`.trim();

const CLEAN = `
<p>Короткий текст без дополнительных полей.</p>
<p>Второй абзац для проверки вёрстки.</p>
`.trim();

async function main() {
  const slug = "material-bez-oblozhki";

  if (process.argv.includes("--restore")) {
    const restored = await prisma.article.update({
      where: { slug },
      data: { contentHtml: CLEAN, views: 0 },
      select: { slug: true, views: true },
    });
    console.log(`Восстановлено: ${restored.slug}, views=${restored.views}`);
    return;
  }

  const article = await prisma.article.update({
    where: { slug },
    data: { contentHtml: PAYLOAD },
    select: { id: true },
  });
  console.log(`Payload записан в ${article.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
