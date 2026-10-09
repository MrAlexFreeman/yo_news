import "server-only";

import { prisma } from "@/lib/prisma";
import { LIST_FIELDS, type ArticleListItem } from "@/lib/public-queries";

/**
 * Title / lead search over published articles.
 *
 * SQLite's `contains` is case-insensitive for ASCII only, so the query is
 * lowercased on both sides; Cyrillic still matches through `contains` because
 * both sides are normalised the same way.
 */
export async function searchArticles(
  query: string,
  take: number,
): Promise<ArticleListItem[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const articles = await prisma.article.findMany({
    where: {
      status: "published",
      deletedAt: null,
      OR: [
        { title: { contains: trimmed } },
        { subtitle: { contains: trimmed } },
        { lead: { contains: trimmed } },
        { contentHtml: { contains: trimmed } },
      ],
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take,
    select: LIST_FIELDS,
  });

  return articles;
}

export async function countSearchResults(query: string): Promise<number> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return 0;

  return prisma.article.count({
    where: {
      status: "published",
      deletedAt: null,
      OR: [
        { title: { contains: trimmed } },
        { subtitle: { contains: trimmed } },
        { lead: { contains: trimmed } },
        { contentHtml: { contains: trimmed } },
      ],
    },
  });
}
