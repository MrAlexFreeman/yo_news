import { prisma } from "@/lib/prisma";

/**
 * A smoke test for the database.
 *
 * Reads one row from every model the app depends on, so a deployment that skipped a
 * migration fails here with "no such table" instead of on the first visitor. The
 * forum tables are in for exactly that reason: they arrived with their own migration,
 * and nothing else in this file would have noticed it missing.
 */
async function main() {
  const [categories, articles, forumCategories, forumTopics, forumPosts] =
    await Promise.all([
      prisma.category.findMany(),
      prisma.article.findMany({ select: { id: true, slug: true, status: true } }),
      prisma.forumCategory.count(),
      prisma.forumTopic.count(),
      prisma.forumPost.count(),
    ]);

  console.log("categories:", categories);
  console.log("articles:", articles);
  console.log(
    `forum: разделов ${forumCategories}, тем ${forumTopics}, сообщений ${forumPosts}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());