import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slugify";

/**
 * Data access for the forum.
 *
 * Aggregates are assembled with Prisma's own API rather than a hand-written GROUP BY.
 * That is not squeamishness about SQL: Prisma stores SQLite DateTime as an ISO-8601
 * string, so `MAX(created_at)` would be a lexicographic comparison between values
 * that need not share an offset or even a separator, and a column whose DEFAULT is
 * `CURRENT_TIMESTAMP` stores SQLite's own `YYYY-MM-DD HH:MM:SS` format alongside them.
 * Comparing those two shapes in SQL is exactly the kind of bug that sorts a board by
 * the wrong date. Prisma decodes both to `Date`, and the arithmetic happens here.
 */

/** The sections every installation starts with. */
export const FORUM_SEED_CATEGORIES = [
  {
    title: "Новости и события",
    slug: "novosti-i-sobytiya",
    description: "Обсуждение материалов издания и того, что происходит в городе.",
  },
  {
    title: "Городские проблемы и ЖКХ",
    slug: "gorodskie-problemy-i-zhkh",
    description: "Дороги, дворы, счета, отопление — и всё, что можно решить вместе.",
  },
  {
    title: "Авто и дороги",
    slug: "avto-i-dorogi",
    description: "Пробки, парковки, общественный транспорт и состояние улиц.",
  },
  {
    title: "Свободное общение",
    slug: "svobodnoe-obshchenie",
    description: "Всё остальное: новости, погода, спорт и просто разговоры.",
  },
] as const;

/**
 * Creates the starter categories if the board is empty.
 *
 * Called from the public pages rather than a seed script so a fresh deployment gets
 * a working board without an extra manual step, and so the categories are restored
 * if someone empties the table.
 *
 * Written as count-then-insert rather than an unconditional upsert: on every request
 * a `count()` of a four-row table is nothing, whereas an upsert would issue a write
 * per page view. The unique-violation catch covers two visitors arriving together on
 * an empty board — one insert wins, the other re-reads and moves on.
 */
export async function ensureForumCategories(): Promise<void> {
  const existing = await prisma.forumCategory.count();
  if (existing > 0) return;

  for (const [index, category] of FORUM_SEED_CATEGORIES.entries()) {
    try {
      await prisma.forumCategory.create({
        data: {
          title: category.title,
          slug: category.slug,
          description: category.description,
          orderIndex: index,
        },
      });
    } catch {
      // Another request created it between the count and this insert.
    }
  }
}

/** One section, as shown on /forum. */
export type ForumCategorySummary = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  topics: number;
  posts: number;
  lastActivityAt: Date | null;
};

/**
 * Every section with its counters and the date of the last reply.
 *
 * Three queries, then joined in memory. The alternative is one query with a join and
 * two correlated counts, which is the faster shape on a large board — but this one is
 * correct without depending on how SQLite compares two DateTime encodings, and a
 * forum with tens of thousands of rows in `forum_topics` is not the case this project
 * is in. Three indexed reads is not a bottleneck.
 */
export async function getForumCategories(): Promise<ForumCategorySummary[]> {
  await ensureForumCategories();

  const categories = await prisma.forumCategory.findMany({
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
  });
  if (categories.length === 0) return [];

  const [topicTotals, topicRows, replyTotals] = await Promise.all([
    prisma.forumTopic.groupBy({
      by: ["categoryId"],
      _count: { _all: true },
      _max: { updatedAt: true },
    }),
    prisma.forumTopic.findMany({
      select: { id: true, categoryId: true },
    }),
    prisma.forumPost.groupBy({
      by: ["topicId"],
      _count: { _all: true },
    }),
  ]);

  const categoryOfTopic = new Map(topicRows.map((row) => [row.id, row.categoryId]));
  const repliesByCategory = new Map<number, number>();
  for (const row of replyTotals) {
    const categoryId = categoryOfTopic.get(row.topicId);
    if (categoryId === undefined) continue;
    repliesByCategory.set(
      categoryId,
      (repliesByCategory.get(categoryId) ?? 0) + row._count._all,
    );
  }

  const topicsByCategory = new Map(topicTotals.map((row) => [row.categoryId, row]));

  return categories.map((category) => {
    const totals = topicsByCategory.get(category.id);
    return {
      id: category.id,
      title: category.title,
      slug: category.slug,
      description: category.description,
      topics: totals?._count._all ?? 0,
      posts: repliesByCategory.get(category.id) ?? 0,
      lastActivityAt: totals?._max.updatedAt ?? null,
    };
  });
}

export async function getForumCategoryBySlug(slug: string) {
  await ensureForumCategories();
  return prisma.forumCategory.findUnique({ where: { slug } });
}

/** A topic as shown in a section's list, with its reply count attached. */
export type ForumTopicSummary = {
  id: number;
  title: string;
  slug: string;
  authorName: string;
  isPinned: boolean;
  isClosed: boolean;
  viewsCount: number;
  createdAt: Date;
  updatedAt: Date;
  replies: number;
};

/** Replies per topic id, for the ids given. */
async function replyCounts(topicIds: number[]): Promise<Map<number, number>> {
  if (topicIds.length === 0) return new Map();
  const rows = await prisma.forumPost.groupBy({
    by: ["topicId"],
    where: { topicId: { in: topicIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.topicId, row._count._all]));
}

/**
 * Topics in one section, newest activity first, pinned on top.
 *
 * A topic's `updatedAt` is bumped whenever a reply lands (see `createForumPost`), so
 * this ordering is "what people are talking about now" rather than "what was opened
 * first". Pinned topics sort above all of it, oldest-first among themselves, so a
 * pinned announcement does not drift.
 */
export async function getForumTopics(
  categoryId: number,
  limit: number,
  skip: number,
): Promise<ForumTopicSummary[]> {
  const topics = await prisma.forumTopic.findMany({
    where: { categoryId },
    orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
    take: limit,
    skip,
    select: {
      id: true,
      title: true,
      slug: true,
      authorName: true,
      isPinned: true,
      isClosed: true,
      viewsCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const countsByTopic = await replyCounts(topics.map((topic) => topic.id));

  return topics.map((topic) => ({
    ...topic,
    replies: countsByTopic.get(topic.id) ?? 0,
  }));
}

export async function countForumTopics(categoryId: number): Promise<number> {
  return prisma.forumTopic.count({ where: { categoryId } });
}

/** A topic with its section and every post, oldest first. */
export type ForumTopicDetail = NonNullable<
  Awaited<ReturnType<typeof getForumTopic>>
>;

/**
 * One topic, addressed by its section slug and its own.
 *
 * Both slugs are required because a topic slug is unique on its own but a reader
 * arrives at `/forum/<section>/<topic>`, and the pair is what the URL says. Looking
 * it up by topic id alone would serve a 200 for a URL whose section is wrong, which
 * is a duplicate-content problem rather than a 404.
 */
export async function getForumTopic(categorySlug: string, topicSlug: string) {
  const topic = await prisma.forumTopic.findUnique({
    where: { slug: topicSlug },
    include: {
      category: true,
      posts: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!topic || topic.category.slug !== categorySlug) return null;
  return topic;
}

/**
 * A slug unique among topics.
 *
 * `slugify` falls back to the string "material" when transliteration leaves nothing —
 * a title of pure emoji or punctuation would take it, and a forum full of threads
 * called "material" would be indistinguishable. Probed rather than generated from a
 * counter so the URL still reads like the title.
 */
export async function uniqueForumTopicSlug(title: string): Promise<string> {
  const base = slugify(title);
  const safeBase = base === "material" ? "tema" : base;

  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const candidate = attempt === 1 ? safeBase : `${safeBase}-${attempt}`;
    const taken = await prisma.forumTopic.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  // Fifty collisions on one title means something is generating topics in a loop.
  // A timestamp keeps the thread reachable instead of failing the post.
  return `${safeBase}-${Date.now().toString(36)}`;
}

/** Creates a topic and its first post. */
export async function createForumTopic(input: {
  categoryId: number;
  title: string;
  authorName: string;
  contentHtml: string;
}): Promise<{ id: number; slug: string }> {
  const slug = await uniqueForumTopicSlug(input.title);

  return prisma.forumTopic.create({
    data: {
      categoryId: input.categoryId,
      title: input.title,
      slug,
      authorName: input.authorName,
      posts: {
        create: {
          authorName: input.authorName,
          content: input.contentHtml,
        },
      },
    },
    select: { id: true, slug: true },
  });
}

/**
 * Adds a reply, and marks the topic as active again.
 *
 * The topic's `updatedAt` is set explicitly rather than left to `@updatedAt`.
 * Prisma only touches that column when the topic row itself is written, and a reply
 * writes `forum_posts` — so without this a board would keep listing a thread with
 * fifty new answers as if it had been quiet since the day it was opened.
 *
 * Both writes go in one transaction: a reply with no timestamp, or a bumped topic
 * with no reply, would both be visible and wrong.
 */
export async function createForumPost(input: {
  topicId: number;
  authorName: string;
  contentHtml: string;
}): Promise<{ id: number }> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const post = await tx.forumPost.create({
      data: {
        topicId: input.topicId,
        authorName: input.authorName,
        content: input.contentHtml,
        createdAt: now,
      },
      select: { id: true },
    });
    await tx.forumTopic.update({
      where: { id: input.topicId },
      data: { updatedAt: now },
    });
    return post;
  });
}

/**
 * Counts one view of a topic.
 *
 * Called from the page rather than a beacon endpoint, so it counts reads that were
 * actually rendered. `increment` keeps the write to a single statement instead of a
 * read-modify-write, which would race two simultaneous readers into a lost update.
 */
export async function incrementForumTopicViews(id: number): Promise<void> {
  await prisma.forumTopic.update({
    where: { id },
    data: { viewsCount: { increment: 1 } },
  });
}

// --- moderation --------------------------------------------------------------

/** Recent activity for the admin board: newest topics, newest posts. */
export async function getRecentForumTopics(limit = 40) {
  return prisma.forumTopic.findMany({
    orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
    take: limit,
    include: { category: true, _count: { select: { posts: true } } },
  });
}

export async function getRecentForumPosts(limit = 40) {
  return prisma.forumPost.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { topic: { include: { category: true } } },
  });
}

export async function setForumTopicPinned(id: number, isPinned: boolean) {
  await prisma.forumTopic.update({ where: { id }, data: { isPinned } });
}

export async function setForumTopicClosed(id: number, isClosed: boolean) {
  await prisma.forumTopic.update({ where: { id }, data: { isClosed } });
}

/**
 * Deletes one post.
 *
 * `deleteMany` rather than `delete`: a post that has already been removed by the
 * time the moderator's second click arrives should count as success, not throw. The
 * returned count is what the admin page reports.
 */
export async function deleteForumPost(id: number): Promise<number> {
  const { count } = await prisma.forumPost.deleteMany({ where: { id } });
  return count;
}

/** Deletes a topic. Its posts cascade in the schema. */
export async function deleteForumTopic(id: number): Promise<void> {
  await prisma.forumTopic.delete({ where: { id } });
}

/**
 * The public path of the thread a post belongs to.
 *
 * Needed *before* a delete: once the row is gone the slug is unrecoverable, and the
 * admin then revalidates the wrong paths and a moderator sees the post still on /forum.
 */
export async function getForumPostLocation(
  id: number,
): Promise<{ topicSlug: string; categorySlug: string } | null> {
  const post = await prisma.forumPost.findUnique({
    where: { id },
    select: { topic: { select: { slug: true, category: { select: { slug: true } } } } },
  });
  if (!post) return null;
  return {
    topicSlug: post.topic.slug,
    categorySlug: post.topic.category.slug,
  };
}

/** The public path of a thread, for the same reason as {@link getForumPostLocation}. */
export async function getForumTopicLocation(
  id: number,
): Promise<{ topicSlug: string; categorySlug: string } | null> {
  const topic = await prisma.forumTopic.findUnique({
    where: { id },
    select: { slug: true, category: { select: { slug: true } } },
  });
  if (!topic) return null;
  return { topicSlug: topic.slug, categorySlug: topic.category.slug };
}