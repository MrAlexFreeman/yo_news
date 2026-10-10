-- CreateTable
CREATE TABLE "EntityCard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "summary" TEXT NOT NULL,
    "location" TEXT,
    "foundedYear" TEXT,
    "websiteUrl" TEXT,
    "images" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "EntityCard_slug_key" ON "EntityCard"("slug");

-- CreateIndex
CREATE INDEX "EntityCard_title_idx" ON "EntityCard"("title");
