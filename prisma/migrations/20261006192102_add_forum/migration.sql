-- CreateTable
CREATE TABLE "forum_categories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "forum_topics" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "category_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "views_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "forum_topics_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "forum_categories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forum_posts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "topic_id" INTEGER NOT NULL,
    "author_name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "forum_posts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "forum_topics" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "forum_categories_slug_key" ON "forum_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "forum_topics_slug_key" ON "forum_topics"("slug");

-- CreateIndex
CREATE INDEX "forum_topics_category_id_is_pinned_updated_at_idx" ON "forum_topics"("category_id", "is_pinned", "updated_at");

-- CreateIndex
CREATE INDEX "forum_posts_topic_id_created_at_idx" ON "forum_posts"("topic_id", "created_at");
