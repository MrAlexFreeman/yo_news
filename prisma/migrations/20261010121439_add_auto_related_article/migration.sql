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
    "media" JSONB,
    "videoUrl" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    "dzenExperiment" BOOLEAN NOT NULL DEFAULT false,
    "dzenDirect" BOOLEAN NOT NULL DEFAULT false,
    "searchText" TEXT,
    "deleted_at" DATETIME,
    "isTelegram" BOOLEAN NOT NULL DEFAULT true,
    "isMax" BOOLEAN NOT NULL DEFAULT true,
    "stockPhotoId" TEXT,
    "stockAuthorName" TEXT,
    "stockAuthorUrl" TEXT,
    "stockPhotoUrl" TEXT,
    "vkPostId" TEXT,
    "autoRelatedArticle" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Article_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Article" ("categoryId", "contentHtml", "coverImage", "createdAt", "deleted_at", "dzenDirect", "dzenExperiment", "id", "is18plus", "isDzen", "isExclusive", "isMax", "isTelegram", "isVk", "lead", "media", "noIndex", "photoAuthor", "photoSource", "publishedAt", "searchText", "seoCanonicalUrl", "seoDescription", "seoTitle", "slug", "status", "stockAuthorName", "stockAuthorUrl", "stockPhotoId", "stockPhotoUrl", "subtitle", "title", "updatedAt", "videoUrl", "views", "vkPostId") SELECT "categoryId", "contentHtml", "coverImage", "createdAt", "deleted_at", "dzenDirect", "dzenExperiment", "id", "is18plus", "isDzen", "isExclusive", "isMax", "isTelegram", "isVk", "lead", "media", "noIndex", "photoAuthor", "photoSource", "publishedAt", "searchText", "seoCanonicalUrl", "seoDescription", "seoTitle", "slug", "status", "stockAuthorName", "stockAuthorUrl", "stockPhotoId", "stockPhotoUrl", "subtitle", "title", "updatedAt", "videoUrl", "views", "vkPostId" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE INDEX "Article_status_publishedAt_idx" ON "Article"("status", "publishedAt");
CREATE INDEX "Article_deleted_at_idx" ON "Article"("deleted_at");
CREATE INDEX "Article_categoryId_idx" ON "Article"("categoryId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
