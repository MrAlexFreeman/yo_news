/**
 * Anti-spam for the public forum forms: a per-IP cooldown.
 *
 * Storage is a module-level Map. That is the honest fit for this deployment — one
 * Node process behind one nginx on one VPS — and it is also the limitation worth
 * writing down: the table is lost on restart and is not shared if a second process
 * is ever added, so `pm2 reload` briefly reopens the window. A database-backed
 * limiter would survive both, at the cost of a write per rejected attempt, which is
 * the wrong trade when the alternative is a module that is never read.
 *
 * The rate is applied to *accepted and rejected attempts alike* — see `take`. A
 * limiter that only records successes is defeated by simply sending rubbish, which
 * is what a spammer sends.
 */

/** Cooldown between two accepted posts from one IP. */
export const FORUM_COOLDOWN_MS = 30_000;

/**
 * How long a rate-limit record is kept.
 *
 * Only needs to outlive the cooldown by enough to cover a visitor who posts, waits,
 * and posts again. Ten minutes is generous; a longer table is only memory.
 */
const RECORD_TTL_MS = 10 * 60_000;

/** A single IP's last attempt. */
type Record = { at: number; blocked: number };

/**
 * Last attempt per IP.
 *
 * `globalThis` so the table survives `next dev`'s module reloads, matching what
 * `src/lib/prisma.ts` does for the client. Without it, every edit in development
 * would hand a spammer a fresh allowance.
 */
const store: Map<string, Record> =
  (globalThis as { __forumRateLimit?: Map<string, Record> }).__forumRateLimit ??
  ((globalThis as { __forumRateLimit?: Map<string, Record> }).__forumRateLimit =
    new Map<string, Record>());

/** Drops entries past their TTL. Called on each attempt, so it needs no timer. */
function sweep(now: number) {
  for (const [ip, record] of store) {
    if (now - record.at > RECORD_TTL_MS) store.delete(ip);
  }
}

/**
 * Normalises an address from a header.
 *
 * Returns `null` rather than a guess when the value is not an address, so the caller
 * decides what to do about an unknown client rather than this module silently
 * lumping every such client into one bucket.
 */
function normaliseIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // An IPv6 address arrives from nginx bracketed only in a URL, but a forwarded
  // header can carry either form; both are accepted.
  const bare = trimmed.replace(/^\[|\]$/g, "");
  if (/^[0-9a-f:.]{3,45}$/i.test(bare)) return bare.toLowerCase();
  return null;
}

/**
 * The client address, from the headers this deployment actually sets.
 *
 * `x-real-ip` first: nginx assigns it from `$remote_addr`, which is the socket peer,
 * so it cannot be spoofed by anything the client sends.
 *
 * `x-forwarded-for` is read **last, rightmost entry only**, and that ordering is the
 * security-relevant decision here. nginx is configured with
 * `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`, which appends the
 * real peer to whatever the client already sent — so a request carrying
 * `X-Forwarded-For: 10.0.0.1` arrives as `10.0.0.1, <real client>`. The leftmost
 * value is attacker-controlled and using it would let anyone bypass the limit with a
 * single header, or exhaust the table by varying it. The rightmost value is the one
 * nginx added.
 *
 * `null` when neither header is usable, which happens if the app is ever exposed
 * without nginx in front of it.
 */
export function clientIp(headers: {
  get(name: string): string | null;
}): string | null {
  const direct = normaliseIp(headers.get("x-real-ip"));
  if (direct) return direct;

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const entries = forwarded.split(",");
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const parsed = normaliseIp(entries[index]);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Records an attempt and reports whether it is allowed.
 *
 * The timestamp is recorded either way, so an IP that keeps trying keeps losing: the
 * window restarts on each attempt rather than only on acceptance.
 *
 * With no identifiable client the attempt is allowed. Refusing instead would break
 * every visitor whose headers are unusable, which is a far worse failure than the
 * one this guards against — and the honeypot plus the admin's delete buttons are what
 * actually clean up afterwards.
 */
export function take(ip: string | null, now = Date.now()): boolean {
  if (!ip) return true;

  sweep(now);
  const previous = store.get(ip);
  if (previous && now - previous.at < FORUM_COOLDOWN_MS) {
    store.set(ip, { at: now, blocked: previous.blocked + 1 });
    return false;
  }

  store.set(ip, { at: now, blocked: 0 });
  return true;
}

/**
 * Seconds left before this IP may post again.
 *
 * Used for the `Retry-After` value on the rejection. Returns 0 when the address is
 * unknown or the window has passed.
 */
export function retryAfterSeconds(ip: string | null, now = Date.now()): number {
  if (!ip) return 0;
  const record = store.get(ip);
  if (!record) return 0;
  const left = FORUM_COOLDOWN_MS - (now - record.at);
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

/**
 * Clears the table.
 *
 * For the checks, which need a known starting state, and for the rare case of
 * needing to let a blocked visitor through.
 */
export function resetForumRateLimit(): void {
  store.clear();
}