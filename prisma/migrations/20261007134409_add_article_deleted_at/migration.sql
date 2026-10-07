-- AlterTable
ALTER TABLE "Article" ADD COLUMN "deleted_at" DATETIME;

-- CreateIndex
CREATE INDEX "Article_deleted_at_idx" ON "Article"("deleted_at");
