/**
 * Removes the throwaway records left behind by the earlier build steps so the
 * public front page only carries the demo dataset.
 *
 * Run with: npm run db:seed:clean
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  }),
});

/** Slugs created while verifying the CMS, the feed and the VK integration. */
const SCRATCH_SLUGS = [
  "testovyy-material-dlya-proverki-sohraneniya",
  "proverka-polnogo-tsikla-sohraneniya-materiala",
  "proverka-polnogo-tsikla-sohraneniya-obnovlenie",
  "proverka-polnogo-tsikla-sohraneniya-obnovlenie-2",
  "proverka-sohraneniya-s-redirektom",
  "repost-v-vk-proverka-integratsii",
  "integratsiya-vk-publikatsiya-bez-tokena",
];

async function main() {
  const removed = await prisma.article.deleteMany({
    where: { slug: { in: SCRATCH_SLUGS } },
  });

  console.log(`Удалено черновых записей: ${removed.count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
