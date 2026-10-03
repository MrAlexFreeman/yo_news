import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { tagKey } from "@/lib/tags";

/**
 * Tag autocomplete for the editor.
 *
 * Lives under /api/admin, so the existing Basic Auth matcher covers it: an
 * unauthenticated request gets 401 and learns nothing about the taxonomy.
 */

export const dynamic = "force-dynamic";

const LIMIT = 10;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const key = tagKey(query);

  const tags = await prisma.tag.findMany({
    where: key ? { nameKey: { contains: key } } : undefined,
    // SQLite orders case-sensitively by default, so this sorts by the lowercased
    // key and puts the closest match first rather than relying on collation.
    orderBy: { nameKey: "asc" },
    take: LIMIT,
    select: { id: true, name: true, slug: true },
  });

  return NextResponse.json(
    { tags },
    { headers: { "Cache-Control": "no-store" } },
  );
}