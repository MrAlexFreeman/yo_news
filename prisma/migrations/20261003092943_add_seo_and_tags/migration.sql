-- CreateTable
-- nameKey carries the uniqueness instead of a COLLATE NOCASE on `name`.
-- SQLite's built-in NOCASE folds ASCII only: it rejects "artificial
-- intelligence" as a duplicate of "Artificial Intelligence" but accepts both
-- "Искусственный интеллект" and "искусственный интеллект", and a lookup with
-- different case misses entirely. Every tag on this site is Russian, so the key
-- is computed in application code where toLowerCase() folds the whole alphabet.
CREATE TABLE "Tag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ArticleTag" (
    "articleId" TEXT NOT NULL,
    "tagId" INTEGER NOT NULL,

    PRIMARY KEY ("articleId", "tagId"),
    CONSTRAINT "ArticleTag_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "slug" TEXT NOT NULL,
    "lead" TEXT,
    "contentHtml" TEXT NOT NULL,
    "coverImage" TEXT,
    "photoAuthor" TEXT,
    "photoSource" TEXT,
    "categoryId" TEXT,
    "isDzen" BOOLEAN NOT NULL DEFAULT true,
    "isVk" BOOLEAN NOT NULL DEFAULT true,
    "isExclusive" BOOLEAN NOT NULL DEFAULT false,
    "is18plus" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "seoTitle" TEXT,
    "seoDescription" TEXT,
    "seoCanonicalUrl" TEXT,
    "noIndex" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    CONSTRAINT "Article_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Article" ("categoryId", "contentHtml", "coverImage", "createdAt", "id", "is18plus", "isDzen", "isExclusive", "isVk", "lead", "photoAuthor", "photoSource", "publishedAt", "slug", "status", "subtitle", "title", "updatedAt", "views") SELECT "categoryId", "contentHtml", "coverImage", "createdAt", "id", "is18plus", "isDzen", "isExclusive", "isVk", "lead", "photoAuthor", "photoSource", "publishedAt", "slug", "status", "subtitle", "title", "updatedAt", "views" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE INDEX "Article_status_publishedAt_idx" ON "Article"("status", "publishedAt");
CREATE INDEX "Article_categoryId_idx" ON "Article"("categoryId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Tag_nameKey_key" ON "Tag"("nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "ArticleTag_tagId_idx" ON "ArticleTag"("tagId");
