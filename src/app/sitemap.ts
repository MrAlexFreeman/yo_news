import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";
import { prisma } from "@/lib/prisma";

/**
 * Sitemap for the public site: home, rubrics, tag listings and every published
 * article. Drafts are excluded by the same `status` filter the pages use.
 *
 * An article flagged noIndex is left out here too. A sitemap entry asks a
 * crawler to index the URL; listing a page that then says noindex in its robots
 * meta is a contradiction, and the meta is the more specific instruction.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, categories, tags] = await Promise.all([
    prisma.article.findMany({
      where: { status: "published" },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      select: {
        slug: true,
        updatedAt: true,
        publishedAt: true,
        createdAt: true,
        noIndex: true,
      },
    }),
    prisma.category.findMany({
      select: { slug: true },
    }),
    // Only tags that already have a live story, so the sitemap never advertises
    // an empty listing page.
    prisma.tag.findMany({
      where: { articles: { some: { article: { status: "published" } } } },
      select: { slug: true },
    }),
  ]);

  return [
    {
      url: absoluteUrl("/"),
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      // The full archive, which the homepage's "Вся лента новостей" link points at.
      // Its deeper pages are noindex by design and so are left out here too.
      url: absoluteUrl("/news"),
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.8,
    },
    ...categories.map((category) => ({
      url: absoluteUrl(`/category/${category.slug}`),
      changeFrequency: "hourly" as const,
      priority: 0.7,
    })),
    {
      url: absoluteUrl("/tags"),
      changeFrequency: "daily" as const,
      priority: 0.4,
    },
    ...tags.map((tag) => ({
      url: absoluteUrl(`/tags/${tag.slug}`),
      changeFrequency: "daily" as const,
      priority: 0.5,
    })),
    ...articles
      .filter((article) => !article.noIndex)
      .map((article) => ({
        url: absoluteUrl(`/news/${article.slug}`),
        lastModified: article.updatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      })),
  ];
}
