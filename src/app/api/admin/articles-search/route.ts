import { NextResponse } from "next/server";

import {
  SEARCH_TAKE,
  isSearchable,
  normaliseQuery,
  buildSearchWhere,
} from "@/lib/article-search";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
/** Reads a live query parameter; a cached answer would be a stale result set. */
export const dynamic = "force-dynamic";

/**
 * Type-ahead search over published stories, for the editor's link dialog.
 *
 * Under /api/admin/, so the matcher in src/proxy.ts requires Basic Auth before this
 * handler runs. That matters more here than for most routes: the response carries
 * headline and slug of everything the newsroom has published, including material
 * that is deliberately kept off the public site by its date.
 *
 * Only four fields cross the wire, and no body text.
 */
export async function GET(request: Request) {
  const query = normaliseQuery(new URL(request.url).searchParams.get("q"));

  if (!isSearchable(query)) {
    return NextResponse.json({ results: [] });
  }

  const articles = await prisma.article.findMany({
    where: buildSearchWhere(query),
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: SEARCH_TAKE,
    select: { id: true, title: true, slug: true, publishedAt: true },
  });

  // publishedAt goes out as an ISO string rather than a Date: JSON.stringify
  // would do that anyway, and being explicit keeps the client from having to
  // guess whether it received a string or epoch millis.
  const results = articles.map((article) => ({
    id: article.id,
    title: article.title,
    slug: article.slug,
    publishedAt: article.publishedAt?.toISOString() ?? null,
  }));

  return NextResponse.json(
    { results },
    // Type-ahead is typed repeatedly; a short shared cache keeps a burst of
    // keystrokes from turning into a burst of full-table scans.
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
}