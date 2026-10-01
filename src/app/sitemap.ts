import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";
import { prisma } from "@/lib/prisma";

/**
 * Sitemap for the public site: home, rubrics and every published article.
 * Drafts are excluded by the same `status` filter the pages use.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, categories] = await Promise.all([
    prisma.article.findMany({
      where: { status: "published" },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      select: { slug: true, updatedAt: true, publishedAt: true, createdAt: true },
    }),
    prisma.category.findMany({
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
    ...categories.map((category) => ({
      url: absoluteUrl(`/category/${category.slug}`),
      changeFrequency: "hourly" as const,
      priority: 0.7,
    })),
    ...articles.map((article) => ({
      url: absoluteUrl(`/news/${article.slug}`),
      lastModified: article.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
