-- AlterTable
-- Messenger syndication flags, appended to the end of Article.
--
-- Appended rather than grouped with the other distribution flags near the top
-- because SQLite can only ADD COLUMN at the end of a table: Prisma rebuilds the
-- whole table when a column has to be inserted in the middle, which for a news
-- database is a table rewrite rather than two boolean columns.
ALTER TABLE "Article" ADD COLUMN "isTelegram" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Article" ADD COLUMN "isMax" BOOLEAN NOT NULL DEFAULT true;