import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/**
 * View counter. Kept off the page render path on purpose: the article pages are
 * ISR-cached static HTML, so incrementing during render would write to SQLite on
 * every request and defeat the cache. The client calls this once per open.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Article ids are cuid() strings; anything else is a probe.
  if (!/^[a-z0-9]{20,32}$/i.test(id)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const existing = await prisma.article.findFirst({
    where: { id, status: "published" },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  await prisma.article.update({
    where: { id },
    data: { views: { increment: 1 } },
  });

  // No body worth reading, and nothing that should be cached.
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
