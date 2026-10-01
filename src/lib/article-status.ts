/**
 * Valid `Article.status` values.
 *
 * SQLite has no enum type, so the column is a plain String in the Prisma
 * schema. This union plus `isArticleStatus` is the runtime guard that keeps the
 * column honest wherever articles are written or rendered.
 */
export const ARTICLE_STATUSES = ["draft", "published"] as const;

export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export function isArticleStatus(value: unknown): value is ArticleStatus {
  return (
    typeof value === "string" &&
    (ARTICLE_STATUSES as readonly string[]).includes(value)
  );
}
