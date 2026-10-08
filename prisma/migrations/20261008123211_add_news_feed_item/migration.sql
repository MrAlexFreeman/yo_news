-- CreateTable
CREATE TABLE "NewsFeedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsFeedItem_externalId_key" ON "NewsFeedItem"("externalId");

-- CreateIndex
CREATE INDEX "NewsFeedItem_status_publishedAt_idx" ON "NewsFeedItem"("status", "publishedAt");

-- CreateIndex
CREATE INDEX "NewsFeedItem_source_idx" ON "NewsFeedItem"("source");
