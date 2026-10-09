/**
 * The «Прямой эфир» badge in the masthead and the compact bar.
 *
 * Pure, and free of `server-only` and of Prisma, so the header checks can assert on what
 * the badge renders and the security suite can assert on what may be stored — both without
 * a database and without standing up the whole cover-and-header pipeline.
 *
 * The badge is a link, which makes the URL the one editor-supplied value here that reaches
 * an `href` on every page of the site. That is treated as hostile input: the rules below
 * admit a site-relative path or an absolute https address and nothing else, because a
 * `javascript:` value stored here would run in the origin of the masthead for every reader.
 */

/** What the badge prints when no title is configured. */
export const LIVE_STREAM_DEFAULT_TITLE = "Прямой эфир";

/** Long enough for «Эфир: заседание гордумы», short enough to keep the header one line. */
const MAX_TITLE_LENGTH = 60;

/**
 * Where the badge leads when enabled with no URL configured.
 *
 * There is deliberately no default route: the project has no `/live` page, and inventing one
 * would put a 404 in the masthead of every page. An enabled badge with no URL renders as
 * plain text instead of a link, which is the honest outcome — the editor asked for a badge,
 * got a badge, and the absence of a destination is visible rather than a broken click.
 */
export const LIVE_STREAM_FALLBACK_HREF = "";

/** What the header needs in order to draw the badge, or to draw nothing. */
export type LiveStreamView = {
  enabled: boolean;
  /** A safe destination, or null when the badge should not be a link. */
  href: string | null;
  title: string;
};

/** The raw stored triple, as read from the settings table. */
export type LiveStreamRaw = {
  enabled: string;
  url: string;
  title: string;
};

/**
 * Control characters, including the zero-width ones.
 *
 * A title is printed in the masthead, so a zero-width joiner or a bidi override pasted from
 * another page would render as text that says one thing and reads as another. Stripping them
 * is cheaper than explaining why the header looks wrong.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * The badge label.
 *
 * Falls back to the default rather than to an empty string, so a title that was cleared in
 * the form leaves a readable badge instead of a bare pulsing dot with no words beside it.
 */
export function resolveLiveStreamTitle(raw: string): string {
  const cleaned = (raw ?? "").replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();

  if (!cleaned) return LIVE_STREAM_DEFAULT_TITLE;
  return cleaned.length > MAX_TITLE_LENGTH ? `${cleaned.slice(0, MAX_TITLE_LENGTH)}…` : cleaned;
}

/**
 * A stored URL as a destination, or null when there is nothing safe to link to.
 *
 * What is refused, and why each refusal matters:
 *
 *   - `javascript:`, `data:`, `vbscript:` — the reason this function exists. A `javascript:`
 *     href executes in the site's own origin, so the value is not a broken link but a
 *     script running for every reader who clicks the masthead.
 *   - `http://` — a live stream on plaintext http cannot be embedded or linked from an
 *     https page without the browser blocking the mixed content anyway.
 *   - `//host/path` and `/\host` — protocol-relative, so they leave for an attacker's host
 *     while still *looking* like a site-relative path. The leading slash is exactly what an
 *     editor's browser shows when they paste a link.
 *   - a scheme-relative or relative value with no scheme that is not a plain path — anything
 *     containing a colon before the first slash is a scheme, not a path.
 *
 * The site-relative form is the common one and stays the easiest to type: `/live`,
 * `/category/society`.
 */
export function resolveLiveStreamHref(raw: string): string | null {
  const value = (raw ?? "").replace(CONTROL_CHARS, "").trim();

  if (!value || value === LIVE_STREAM_FALLBACK_HREF) return null;

  // A path on this site. Rejected before the https branch so a `//` prefix is caught here
  // rather than being read as a host.
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.startsWith("/\\")) return null;
    return value;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  // Credentials in a stored URL would be printed in the page and in every error that echoes
  // it, and no stream host needs them.
  if (parsed.username || parsed.password) return null;

  return parsed.toString();
}

/**
 * Whether the badge is on.
 *
 * An absent or unrecognised value means off, unlike the messenger flags where Telegram
 * defaults to on. The difference is deliberate: this badge is a link a reader can click, and
 * a site that has not been told it has a live stream should not claim otherwise in the
 * masthead.
 */
export function parseLiveStreamEnabled(raw: string): boolean {
  const value = (raw ?? "").trim().toLowerCase();

  if (value === "true" || value === "1" || value === "on" || value === "да") return true;
  if (value === "false" || value === "0" || value === "off" || value === "нет") return false;

  return false;
}

/** The three stored values as the header consumes them. */
export function toLiveStreamView(raw: LiveStreamRaw): LiveStreamView {
  const enabled = parseLiveStreamEnabled(raw.enabled);
  const href = resolveLiveStreamHref(raw.url);

  return {
    enabled,
    /*
     * The href is resolved even when the badge is off, so a stored URL that turned out to be
     * unsafe is still visible to the admin form rather than being quietly dropped here. What
     * is not done is rendering a link for a disabled badge — see the components.
     */
    href,
    title: resolveLiveStreamTitle(raw.title),
  };
}

/** The empty view, for a caller that has no settings at all. */
export const LIVE_STREAM_OFF: LiveStreamView = {
  enabled: false,
  href: null,
  title: LIVE_STREAM_DEFAULT_TITLE,
};

/**
 * Validates the URL as an editor typed it, returning the message to show or null.
 *
 * Separate from `resolveLiveStreamHref` on purpose: that one answers "may this be linked",
 * which is a question about safety and must never be the only thing standing between a
 * crafted POST and the masthead. This one rejects the value at the door with a message the
 * editor can act on, so a bad link is caught while they are still looking at the field rather
 * than appearing later as a badge that does nothing.
 */
export function validateLiveStreamUrl(raw: string): string | null {
  const value = (raw ?? "").trim();

  // Empty is "no destination", which is legitimate: the badge then prints without a link.
  if (!value) return null;

  if (resolveLiveStreamHref(value)) return null;

  if (value.startsWith("//") || value.startsWith("/\\")) {
    return "Адрес вида //host — это внешний сайт. Для ссылки внутри сайта начните с одного «/», без второго.";
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https:/i.test(value)) {
    return "Разрешены только адреса https:// или пути внутри сайта, например /live.";
  }

  return "Проверьте адрес: нужен https://… или путь внутри сайта, например /live.";
}

/** Validates the label, returning the message to show or null. */
export function validateLiveStreamTitle(raw: string): string | null {
  const value = (raw ?? "").trim();

  if (!value) return null;
  if (value.length > MAX_TITLE_LENGTH) {
    return `Слишком длинная подпись — максимум ${MAX_TITLE_LENGTH} символов.`;
  }

  return null;
}