import {
  NEWS_SITEMAP_LIMIT,
  buildNewsSitemap,
  newsSitemapWhere,
} from "@/lib/news-sitemap";
import { prisma } from "@/lib/prisma";

/**
 * Google News sitemap: the stories published in the last 48 hours.
 *
 * Under `/news-sitemap.xml` rather than under `/api`, because that is the address Google's
 * documentation and its Search Console field expect, and it is the address `robots.txt`
 * advertises.
 *
 * **Load.** The brief asks for this without adding work to the box, and the shape of the
 * route is the answer: one indexed query (`@@index([status, publishedAt])` on `Article`) and
 * a ten-minute revalidation window instead of a request-time scan. A crawler polling every
 * few minutes gets the same cached document the whole time, and the database is read at most
 * six times an hour regardless of how often the file is fetched.
 *
 * The XML itself is built in `lib/news-sitemap.ts`, where the window and the escaping are
 * covered by `seo:check` — a sitemap that is merely *served* proves nothing about its
 * contents.
 */
export const revalidate = 600;

export async function GET() {
  const articles = await prisma.article.findMany({
    where: newsSitemapWhere(new Date()),
    orderBy: { publishedAt: "desc" },
    take: NEWS_SITEMAP_LIMIT,
    // `publishedAt` is nullable in the schema; the `gte` above already excludes nulls, and
    // the flatMap below keeps the type honest without a non-null assertion.
    select: { slug: true, title: true, publishedAt: true },
  });

  const entries = articles.flatMap((article) =>
    article.publishedAt
      ? [{ slug: article.slug, title: article.title, publishedAt: article.publishedAt }]
      : [],
  );

  return new Response(buildNewsSitemap(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Ten minutes, as the brief asks: news changes fast enough that an hour would hide a
      // story, and slow enough that crawlers cannot turn the sitemap into a database load.
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=300",
    },
  });
}
