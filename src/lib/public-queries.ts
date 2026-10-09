import "server-only";

import type { Prisma } from "@/generated/prisma/client";

import { categoryRank, LOOP_HIGHLIGHT_RUBRICS } from "@/lib/categories";
import { prisma } from "@/lib/prisma";

/**
 * Read queries for the public site.
 *
 * Everything here is `server-only` and filters to `status: "published"` — a
 * draft must never reach a public page, the RSS feed or a search engine.
 *
 * Every query here also filters `deletedAt: null`. Soft delete only works if the
 * exclusion is written down at each call site rather than remembered once: there are
 * thirteen of them, they read in six different shapes, and a trashed story that leaks
 * into one listing is worse than one that is missing from all of them, because it
 * looks deliberate. `trash:check` asserts the exclusion against a real trashed row on
 * the storefront, the feeds, the archive, search and the sitemap, so a query added
 * later without it fails the suite instead of shipping.
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

/**
 * Most-read first, freshest breaking ties.
 *
 * The tie-break is not decoration: `views` is 0 for every story published in the last
 * hour, so without it "the day's most read" would be whichever of them SQLite happened
 * to return, and a row that reorders itself every revalidation looks broken.
 */
const BY_POPULARITY = [
  { views: "desc" },
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
      deletedAt: null,
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
 *
 * Returns a `LoopArticle` rather than an `ArticleListItem` because the front page prints
 * a reading time under the headline, and the only honest source for that number is the
 * text. One article's body is a few kilobytes and it is the single largest thing on the
 * page, so the cost is bounded — unlike the listing queries, which is why `LIST_FIELDS`
 * stays without it.
 */
export async function getHeroArticle(): Promise<LoopArticle | null> {
  const exclusive = await prisma.article.findFirst({
    where: { status: "published", deletedAt: null, isExclusive: true },
    orderBy: BY_FRESHNESS,
    select: LOOP_FIELDS,
  });

  if (exclusive) return exclusive;

  const freshest = await prisma.article.findFirst({
    where: { status: "published", deletedAt: null },
    orderBy: BY_FRESHNESS,
    select: LOOP_FIELDS,
  });

  return freshest ?? null;
}

export async function getCategories() {
  const categories = await prisma.category.findMany({
    select: { id: true, name: true, slug: true },
  });

  // The editorial grid, not alphabetical: the navigation leads with «Расследования».
  // A rubric added straight to the database still appears, after the known ones.
  return categories.sort((a, b) => categoryRank(a.slug) - categoryRank(b.slug));
}

/**
 * Tag used by the public tag pages. Counts published articles only, so a tag
 * that has never had a live story does not get an indexable empty page.
 */
export async function getTagBySlug(slug: string) {
  return prisma.tag.findFirst({
    where: {
      slug,
      articles: { some: { article: { status: "published", deletedAt: null } } },
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
      deletedAt: null,
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
    where: {
      articles: { some: { article: { status: "published", deletedAt: null } } },
    },
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
  const categories = (
    await prisma.category.findMany({ select: { id: true, name: true, slug: true } })
  ).sort((a, b) => categoryRank(a.slug) - categoryRank(b.slug));

  const sections = await Promise.all(
    categories.map(async (category) => ({
      category: { name: category.name, slug: category.slug },
      articles: await prisma.article.findMany({
        where: { status: "published", deletedAt: null, categoryId: category.id },
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
    where: { slug, status: "published", deletedAt: null },
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

/**
 * A list row that also carries the body, so the reader can be told how long it takes.
 *
 * The loop's cards show a reading time, and the only honest source for that number is
 * the text itself. It is added to `LIST_FIELDS` for these queries alone: a general
 * listing page renders twenty of these rows at a time, and pulling twenty article bodies
 * into a list query to compute six badges is the kind of cost that shows up as a slow
 * page rather than as an error.
 */
const LOOP_FIELDS = { ...LIST_FIELDS, contentHtml: true } satisfies Prisma.ArticleSelect;

export type LoopArticle = Prisma.ArticleGetPayload<{ select: typeof LOOP_FIELDS }>;

/**
 * Stories the plate inside the article may point at: the freshest ones from the same
 * rubric. Four, because the plate picks one of them by hash and a single candidate would
 * make that choice the database's rather than the page's.
 *
 * A story with no rubric has no "same rubric" to draw from, so the query falls back to
 * the freshest material overall. That is the same fallback the retired block used, and
 * for the same reason: a plate that says "read this instead" and then has nothing to say
 * is the dead end the loop exists to remove.
 */
export async function getLoopReadAlso(
  categorySlug: string | null,
  excludeId: string,
  take = 4,
): Promise<LoopArticle[]> {
  const where = {
    status: "published",
    deletedAt: null,
    id: { not: excludeId },
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
  };

  const candidates = await prisma.article.findMany({
    where,
    orderBy: BY_FRESHNESS,
    take,
    select: LOOP_FIELDS,
  });

  if (candidates.length > 0 || categorySlug) return candidates;

  return prisma.article.findMany({
    where: { status: "published", deletedAt: null, id: { not: excludeId } },
    orderBy: BY_FRESHNESS,
    take,
    select: LOOP_FIELDS,
  });
}

/**
 * What the rubric's own readers have read most — the first row of the closing grid.
 *
 * The same rubric, so the row answers "more from the desk this came from", and ordered by
 * reads rather than by date so a morning reader and an evening reader are offered the
 * same thing.
 */
export async function getLoopRubricPopular(
  categorySlug: string | null,
  excludeId: string,
  take = 4,
): Promise<LoopArticle[]> {
  const popular = categorySlug
    ? await prisma.article.findMany({
        where: {
          status: "published",
          deletedAt: null,
          id: { not: excludeId },
          category: { slug: categorySlug },
        },
        orderBy: BY_POPULARITY,
        take,
        select: LOOP_FIELDS,
      })
    : [];

  if (popular.length > 0 || categorySlug) return popular;

  return prisma.article.findMany({
    where: { status: "published", deletedAt: null, id: { not: excludeId } },
    orderBy: BY_POPULARITY,
    take,
    select: LOOP_FIELDS,
  });
}

/**
 * The day's other stories, from the rubrics that actually produce news — the second row.
 *
 * Ordered by reads, and widened to every rubric when the short list cannot fill the row:
 * a two-row grid with a hole in it reads as a failed request, so it is better to offer a
 * story from a quiet rubric than no story at all.
 */
export async function getLoopHighlights(
  excludeIds: string[],
  take = 4,
): Promise<LoopArticle[]> {
  const where = {
    status: "published",
    deletedAt: null,
    id: { notIn: excludeIds },
  };

  const highlights = await prisma.article.findMany({
    where: { ...where, category: { slug: { in: [...LOOP_HIGHLIGHT_RUBRICS] } } },
    orderBy: BY_POPULARITY,
    take,
    select: LOOP_FIELDS,
  });

  if (highlights.length >= take) return highlights;

  return prisma.article.findMany({
    where,
    orderBy: BY_POPULARITY,
    take,
    select: LOOP_FIELDS,
  });
}

/**
 * The sidebar's "most read right now": the most-read stories of the last few hours.
 *
 * `now` is a parameter rather than a hidden `new Date()` so the window is testable and so
 * a caller that has already frozen a timestamp for the page renders against the same one.
 */
export async function getTrendingArticles(
  take: number,
  options: { excludeId?: string; hours?: number; now?: Date } = {},
): Promise<ArticleListItem[]> {
  const { excludeId, hours = 48, now = new Date() } = options;

  return prisma.article.findMany({
    where: {
      status: "published",
      deletedAt: null,
      publishedAt: { gte: new Date(now.getTime() - hours * 60 * 60 * 1000) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: BY_POPULARITY,
    take,
    select: LIST_FIELDS,
  });
}

/**
 * The all-time most-read, for topping the trending list up.
 *
 * Separate from {@link getTrendingArticles} rather than a flag on it: "for the last two
 * days" and "ever" are different questions, and a window widened until it returned five
 * rows would quietly stop answering the first one. The caller combines the two with
 * `fillRanked`, which keeps the window's stories in front.
 *
 * `excludeId` is honoured here as well, so the story being read cannot come back as its
 * own filler even though the window already excluded it.
 */
export async function getMostReadArticles(
  take: number,
  options: { excludeId?: string } = {},
): Promise<ArticleListItem[]> {
  return prisma.article.findMany({
    where: {
      status: "published",
      deletedAt: null,
      ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
    },
    orderBy: BY_POPULARITY,
    take,
    select: LIST_FIELDS,
  });
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
    where: { status: "published", deletedAt: null, categoryId },
    orderBy: BY_FRESHNESS,
    take,
    skip,
    select: LIST_FIELDS,
  });
}

export async function countCategoryArticles(categoryId: string): Promise<number> {
  return prisma.article.count({
    where: { status: "published", deletedAt: null, categoryId },
  });
}

/**
 * One page of every published story, for the /news archive.
 *
 * Separate from {@link getPublishedArticles} rather than a `skip` option on it: that
 * one is called from the homepage for "the newest N", where an offset would be a
 * silently wrong argument, and every existing call site passes a bare count. The pair
 * mirrors `getCategoryArticles`/`countCategoryArticles` so the archive reads like the
 * rubric pages rather than like a special case.
 */
export async function getPublishedArticlesPage(
  take: number,
  skip: number,
): Promise<ArticleListItem[]> {
  return prisma.article.findMany({
    where: { status: "published", deletedAt: null },
    orderBy: BY_FRESHNESS,
    take,
    skip,
    select: LIST_FIELDS,
  });
}

/** How many stories the /news archive has to paginate through. */
export async function countPublishedArticles(): Promise<number> {
  return prisma.article.count({
    where: { status: "published", deletedAt: null },
  });
}
