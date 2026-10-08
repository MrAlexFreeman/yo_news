import { NextResponse } from "next/server";

import { syncFeeds } from "@/lib/feed-sync";

export const runtime = "nodejs";
/** Never cached: the whole point is to read the feeds as they are now. */
export const dynamic = "force-dynamic";

/**
 * Manual run of the wire sync, for the button on /admin/feed.
 *
 * Under /api/admin/, so Basic Auth applies. `POST` requires application/json for the
 * same reason as the other editorial endpoints: a cross-origin form can only send
 * urlencoded/multipart/text-plain, none of which is valid JSON, while a cross-origin
 * JSON fetch needs a preflight no CORS header here permits. Basic Auth is not a CSRF
 * token — a browser attaches its cached credentials to a cross-origin request — so
 * without the content-type check any page an editor visits could drive this.
 *
 * The work itself is in feed-sync.ts — a sync is a thing the cron does as well, and it
 * should not live in a route handler where only the button can reach it.
 */
export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json(
      { error: "Ожидается POST с Content-Type: application/json." },
      { status: 415 },
    );
  }

  try {
    const summary = await syncFeeds();
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    // syncFeeds reports per-source failures rather than throwing, so reaching this
    // means something outside a single feed — the database, most likely.
    console.error("[feed] синхронизация не выполнена", error);
    return NextResponse.json(
      { error: "Не удалось выполнить синхронизацию. Подробности в логе сервера." },
      { status: 500 },
    );
  }
}
