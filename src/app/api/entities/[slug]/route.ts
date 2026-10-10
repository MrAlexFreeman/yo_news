import { NextResponse } from "next/server";

import { isValidEntitySlug } from "@/lib/entity-card";
import { getEntityCard } from "@/lib/entities";

export const runtime = "nodejs";

/**
 * `GET /api/entities/[slug]` — one card, for the popover.
 *
 * Public and cacheable, because it holds nothing an editor typed privately: a card is
 * published copy about a public place, and the reader is going to see all of it. The
 * response is explicitly immutable — the address carries the slug, and a slug is the
 * identity, so a card edited under the same slug is a correction rather than a change,
 * and revalidating it on every hover would put a database read behind every mouse move.
 */

/** Editors use this to save a card, not to read it; there is no reason for it to be cached. */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;

  // Checked before the lookup rather than trusted from the URL: an unvalidated slug is a
  // free string on its way to a database query, and the popover builds a request path out
  // of whatever it finds in the page.
  if (!isValidEntitySlug(slug)) {
    return NextResponse.json({ error: "Неизвестный адрес карточки." }, { status: 404 });
  }

  const card = await getEntityCard(slug);
  if (!card) {
    return NextResponse.json({ error: "Карточка не найдена." }, { status: 404 });
  }

  return NextResponse.json(
    { card },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}