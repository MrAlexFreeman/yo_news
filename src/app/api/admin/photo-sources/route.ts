import { NextResponse } from "next/server";

import { mergePhotoSources } from "@/lib/photo-sources";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
/** Reads live rows; a cached list would not know about a source added since. */
export const dynamic = "force-dynamic";

/**
 * Photo credits already in use, for the datalist on the article form.
 *
 * Under /api/admin/, so Basic Auth applies. The list is not sensitive on its own —
 * every entry is printed on a public page — but it is a query over the editorial
 * table, so it stays behind the same gate as the rest of /admin.
 *
 * GET only and read-only: picking a source must never be able to write one, or the
 * list becomes a way to plant arbitrary strings in the credits column.
 */
export async function GET() {
  // `distinct` on a nullable column brings the NULLs along in some Prisma/SQLite
  // combinations, so filtering happens in the merge rather than in the query: one
  // place that knows the rule.
  const rows = await prisma.article.findMany({
    where: { photoSource: { not: null } },
    distinct: ["photoSource"],
    select: { photoSource: true },
  });

  const sources = mergePhotoSources(
    rows.map((row) => row.photoSource).filter((value): value is string => Boolean(value)),
  );

  return NextResponse.json(
    { sources },
    // A source list changes only when an article is saved, so a minute of caching
    // saves a query on every form open without anyone noticing a stale entry.
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}