/**
 * Server startup hook.
 *
 * One job: optionally start the wire-feed sync on a timer. Everything else this app
 * needs at boot it already does from `deploy.sh`.
 *
 * Why here rather than in the sync route: `register` is called once when the server
 * starts, which is the only place a repeating task has a defined home in Next. A timer
 * started from a request handler would be started once per worker, or not at all on a
 * process that never received that request, and either way it would be invisible.
 *
 * Off by default, and that is deliberate. A background job that reaches two external
 * sites and writes rows is something an operator should switch on knowing about —
 * `FEED_SYNC_INTERVAL_MINUTES` in `.env`, then a restart. The button on /admin/feed
 * covers the case where nobody has.
 */

/** Refuse an interval so short it would be indistinguishable from a scraper. */
const MINUTES_FLOOR = 5;

export function register(): void {
  const raw = process.env.FEED_SYNC_INTERVAL_MINUTES?.trim();
  if (!raw) return;

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < MINUTES_FLOOR) {
    console.warn(
      `[feed] FEED_SYNC_INTERVAL_MINUTES=${raw} меньше ${MINUTES_FLOOR} минут — фоновая синхронизация не запущена.`,
    );
    return;
  }

  const intervalMs = minutes * 60 * 1000;

  // Imported inside the timer rather than at module scope: `register` runs in both the
  // Node and the Edge runtime, and feed-sync reaches Prisma and the filesystem.
  const run = async () => {
    try {
      const { syncFeeds } = await import("@/lib/feed-sync");
      const summary = await syncFeeds();
      console.log(
        `[feed] фоновая синхронизация: добавлено ${summary.inserted} (${summary.sources
          .map((source) => `${source.source}:${source.inserted}${source.error ? "!" : ""}`)
          .join(" ")})`,
      );
    } catch (error) {
      // A failed background run must not take the process down.
      console.warn("[feed] фоновая синхронизация не выполнена", error);
    }
  };

  // `unref` so the timer never keeps the process alive by itself — pm2 owns the
  // lifetime here, and a server that refuses to exit is worse than a missed run.
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();

  console.log(`[feed] фоновая синхронизация каждые ${minutes} мин.`);
}
