import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Read queries for the public site.
 *
 * Everything here is `server-only` and filters to `status: "published"` — a
 * draft must never reach a public page, the RSS feed or a search engine.
 */

const LIST_FIELDS = {
  id: true,
  title: true,
  subtitle: true,
  slug: true,
  lead: true,
  coverImage: true,
  isExclusive: true,
  is18plus: true,
  publishedAt: true,
  createdAt: true,
  category: { select: { name: true, slug: true } },
} satisfies Prisma.ArticleSelect;

export type ArticleListItem = Prisma.ArticleGetPayload<{
  select: typeof LIST_FIELDS;
}>;

/**
 * Newest first, using the publication date and falling back to creation time.
 *
 * The array form is deliberate: with the better-sqlite3 adapter, Prisma 7
 * rejects the multi-key object literal at runtime even though the type allows
 * it. SQLite sorts NULLs last on DESC, so unscheduled rows sink naturally.
 */
const BY_FRESHNESS = [
  { publishedAt: "desc" },
  { createdAt: "desc" },
] satisfies Prisma.ArticleOrderByWithRelationInput[];

export async function getPublishedArticles(
  take: number,
  options: { excludeId?: string; categorySlug?: string } = {},
): Promise<ArticleListItem[]> {
  return prisma.article.findMany({
    where: {
      status: "published",
      ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
      ...(options.categorySlug
        ? { category: { slug: options.categorySlug } }
        : {}),
    },
    orderBy: BY_FRESHNESS,
    take,
    select: LIST_FIELDS,
  });
}

/**
 * The lead story: an exclusive piece if there is one, otherwise the freshest
 * article overall. Matches the editorial rule described in the spec.
 */
export async function getHeroArticle(): Promise<ArticleListItem | null> {
  const exclusive = await prisma.article.findFirst({
    where: { status: "published", isExclusive: true },
    orderBy: BY_FRESHNESS,
    select: LIST_FIELDS,
  });

  if (exclusive) return exclusive;

  const [freshest] = await getPublishedArticles(1);
  return freshest ?? null;
}

export async function getCategories() {
  return prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
}

/**
 * Tag used by the public tag pages. Counts published articles only, so a tag
 * that has never had a live story does not get an indexable empty page.
 */
export async function getTagBySlug(slug: string) {
  return prisma.tag.findFirst({
    where: {
      slug,
      articles: { some: { article: { status: "published" } } },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { articles: true } },
    },
  });
}

/** Published stories carrying a tag, freshest first, paginated. */
export async function getArticlesByTag(
  slug: string,
  take: number,
  skip = 0,
): Promise<ArticleListItem[]> {
  return prisma.article.findMany({
    where: {
      status: "published",
      tags: { some: { tag: { slug } } },
    },
    orderBy: BY_FRESHNESS,
    take,
    skip,
    select: LIST_FIELDS,
  });
}

/** Every tag with at least one published story, for the tag index and sitemap. */
export async function getTagsWithPublishedArticles() {
  return prisma.tag.findMany({
    where: { articles: { some: { article: { status: "published" } } } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
}

/**
 * Sections for the front page grid. Only categories that actually have
 * published articles are returned, so the page never shows an empty block.
 */
export async function getSectionsWithArticles(
  perSection: number,
  limit = 6,
): Promise<{ category: { name: string; slug: string }; articles: ArticleListItem[] }[]> {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });

  const sections = await Promise.all(
    categories.map(async (category) => ({
      category: { name: category.name, slug: category.slug },
      articles: await prisma.article.findMany({
        where: { status: "published", categoryId: category.id },
        orderBy: BY_FRESHNESS,
        take: perSection,
        select: LIST_FIELDS,
      }),
    })),
  );

  return sections
    .filter((section) => section.articles.length > 0)
    .slice(0, limit);
}

export async function getPublishedArticleBySlug(slug: string) {
  return prisma.article.findFirst({
    where: { slug, status: "published" },
    select: {
      id: true,
      title: true,
      slug: true,
      subtitle: true,
      lead: true,
      contentHtml: true,
      coverImage: true,
      photoAuthor: true,
      photoSource: true,
      seoTitle: true,
      seoDescription: true,
      seoCanonicalUrl: true,
      noIndex: true,
      media: true,
      videoUrl: true,
      tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
      isExclusive: true,
      is18plus: true,
      views: true,
      publishedAt: true,
      updatedAt: true,
      createdAt: true,
      category: { select: { name: true, slug: true } },
    },
  });
}

/** Sibling stories for the "Читайте также" block. */
export async function getRelatedArticles(
  categorySlug: string | null,
  excludeId: string,
  take = 4,
): Promise<ArticleListItem[]> {
  const related = categorySlug
    ? await prisma.article.findMany({
        where: {
          status: "published",
          id: { not: excludeId },
          category: { slug: categorySlug },
        },
        orderBy: BY_FRESHNESS,
        take,
        select: LIST_FIELDS,
      })
    : [];

  if (related.length >= take) return related;

  // Fall back to any fresh material so the block is never half-empty.
  const filler = await prisma.article.findMany({
    where: {
      status: "published",
      id: { not: excludeId, notIn: related.map((article) => article.id) },
    },
    orderBy: BY_FRESHNESS,
    take: take - related.length,
    select: LIST_FIELDS,
  });

  return [...related, ...filler];
}

export async function getCategoryBySlug(slug: string) {
  return prisma.category.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
}

export async function getCategoryArticles(
  categoryId: string,
  take: number,
  skip: number,
): Promise<ArticleListItem[]> {
  return prisma.article.findMany({
    where: { status: "published", categoryId },
    orderBy: BY_FRESHNESS,
    take,
    skip,
    select: LIST_FIELDS,
  });
}

export async function countCategoryArticles(categoryId: string): Promise<number> {
  return prisma.article.count({
    where: { status: "published", categoryId },
  });
}
