import "server-only";

import { prisma } from "@/lib/prisma";
import {
  LIVE_STREAM_OFF,
  toLiveStreamView,
  type LiveStreamView,
} from "@/lib/live-stream";

/**
 * The «Прямой эфир» badge as the header needs it, read from the settings table.
 *
 * Its own function rather than one more export of `lib/settings.ts` for a single reason: this
 * runs on every public page render, and the layout that calls it is inside the ISR window. One
 * query per render of the badge — and one that cannot be a build-time constant, because the
 * whole point of the setting is that an editor changes it without a redeploy.
 *
 * `server-only`, so the header components cannot call it by accident and pull a Prisma client
 * into a client bundle. The shape they receive is the pure `LiveStreamView` instead.
 */

/** The three setting keys this reads, stated so the query and the module agree. */
const KEYS = ["LIVE_STREAM_ENABLED", "LIVE_STREAM_URL", "LIVE_STREAM_TITLE"] as const;

export async function getLiveStreamView(): Promise<LiveStreamView> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: [...KEYS] } },
    select: { key: true, value: true },
  });

  const stored = new Map(rows.map((row) => [row.key, row.value]));

  /*
   * An absent row and an empty row are the same answer here, unlike a secret setting where an
   * empty row has to fall through to `.env`. Nothing reads these from the environment: the
   * badge is site behaviour, not deployment configuration, and honouring a `.env` value would
   * mean a badge no editor in the admin could explain seeing.
   *
   * A single query rather than three `resolveSetting` calls: this is on the render path of
   * every public page, and three round trips to read three adjacent rows is the kind of cost
   * that gets added by accident and never removed.
   */
  if (!rows.length) return LIVE_STREAM_OFF;

  return toLiveStreamView({
    enabled: stored.get("LIVE_STREAM_ENABLED") ?? "",
    url: stored.get("LIVE_STREAM_URL") ?? "",
    title: stored.get("LIVE_STREAM_TITLE") ?? "",
  });
}