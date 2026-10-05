/**
 * Fills Article.searchText for rows written before the column existed.
 *
 * Idempotent: it recomputes every row rather than only the empty ones, so running
 * it after a data fix corrects the index instead of preserving the mistake. Cheap
 * enough at this size to prefer correct over clever.
 *
 * Run with: npm run db:seed:search
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { buildSearchText } from "../src/lib/article-search";
import { PrismaClient } from "../src/generated/prisma/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

async function main() {
  const articles = await prisma.article.findMany({
    select: { id: true, title: true, lead: true, searchText: true },
  });

  let updated = 0;

  for (const article of articles) {
    const next = buildSearchText(article.title, article.lead);
    if (article.searchText === next) continue;

    await prisma.article.update({ where: { id: article.id }, data: { searchText: next } });
    updated += 1;
  }

  console.log(`Обработано статей: ${articles.length}, обновлено: ${updated}`);

  // Proof the column works for the case it exists for: a Russian query typed in
  // lower case has to find a title stored with a capital first letter.
  const sample = articles.find((article) => /[а-яА-Я]/.test(article.title));
  if (sample) {
    const needle = sample.title.slice(1, 8).toLowerCase();
    const found = await prisma.article.count({
      where: { searchText: { contains: needle } },
    });
    console.log(`Проба «${needle}» по «${sample.title}»: ${found > 0 ? "найдено" : "НЕ НАЙДЕНО"}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());