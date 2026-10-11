/**
 * Облако Mail.ru: a public link resolved into a stream of bytes.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all
 * ---------------------------------------------------------------------------
 * `cloud.mail.ru` refuses to be framed — it answers with `X-Frame-Options: SAMEORIGIN` and a
 * `Content-Security-Policy: frame-ancestors` list that does not include this site. Both
 * measured, and together they mean a pasted Mail.ru Cloud link shows an error inside an
 * article rather than a player. The video therefore has to be *moved*: fetched here and
 * uploaded to VK, whose player does embed.
 *
 * ---------------------------------------------------------------------------
 * The resolution, measured against a real public link
 * ---------------------------------------------------------------------------
 * A public file link is `cloud.mail.ru/public/<key>/<id>/<filename>` — **three** segments
 * after `/public`, not two — and the file is fetched from the dispatcher's base with the
 * whole of that tail appended:
 *
 *   GET https://cloud.mail.ru/api/v2/dispatcher
 *     → body.weblink_get[0].url = "https://cloclo59.cloud.mail.ru/public/<token>/g/no"
 *
 *   GET {base}/<key>/<id>/<filename>
 *     → 301 Location: https://cloclo63.datacloudmail.ru/public/get/<token>/no/<filename>
 *     → 200 (or 206 for a ranged request), Content-Length: 5303307
 *
 * Two details from that measurement are load-bearing and were both wrong in an earlier
 * version of this file, which had been written from a guess:
 *
 *  - `{base}/<key>` and `{base}/<key>/<id>` answer **404**. Only the complete tail reaches
 *    the file, so a resolver that stopped after the first segment never found anything.
 *  - The answer is a **redirect**, and to a *different* host — `datacloudmail.ru` rather
 *    than `cloud.mail.ru`. Following it is required, and re-checking where it landed is the
 *    only thing standing between this and an open proxy.
 *
 * `api/v2/tokens/download`, which the brief names, is not usable here: it answers
 * `403 {"body":"user"}` and wants an authenticated Mail.ru session, which a public link
 * does not provide.
 *
 * ---------------------------------------------------------------------------
 * The security property, which matters more than the feature
 * ---------------------------------------------------------------------------
 * This module fetches a URL that somebody typed. Left at that it is an SSRF hole: a
 * "cloud.mail.ru" link that redirects to `http://169.254.169.254/` would have the server
 * read its own metadata and hand it back. Three things close it, and all three are
 * asserted:
 *
 *   1. only `cloud.mail.ru/public/…` is accepted as input — a host equality test and a path
 *      shape, not a substring match, because `cloud.mail.ru.evil.example` contains the host
 *      name and is not the host;
 *   2. every URL actually fetched is checked against a host allowlist, *including the URL a
 *      response was redirected to* — `response.url` is re-validated, because a redirect is
 *      the whole trick;
 *   3. nothing the caller sends is ever fetched directly. The download address is built
 *      here from the dispatcher's answer, so the client cannot point us anywhere.
 */

/** The only host a public link may name. */
const PUBLIC_HOST = "cloud.mail.ru";

/**
 * Download hosts: where the dispatcher sends us and where it redirects.
 *
 * A suffix match rather than an exact list, because the dispatcher rotates through
 * `cloclo1…cloclo64` on both domains and names a different one every call. The leading dot
 * is what keeps `evilcloud.mail.ru` out — without it both of those end in the bare host and
 * would pass.
 */
const DOWNLOAD_HOST_SUFFIXES = [".cloud.mail.ru", ".datacloudmail.ru"] as const;

/**
 * What a path segment may be.
 *
 * Any printable character except a separator, because a public link's filename is whatever
 * the person called the file: `Мой фильм.mp4` with a space and a Cyrillic letter is an
 * ordinary name, and an earlier version of this module allowed only `[A-Za-z0-9._-]` and
 * refused such a link outright.
 *
 * What is excluded is what makes a segment stop being a segment: a slash or a backslash
 * (either would address something else), and control characters including NUL. `.` and `..`
 * are refused separately below rather than by the character class, because they are made of
 * allowed characters.
 */
const SEGMENT_PATTERN = /^[^\u0000-\u001f\u007f/\\]{1,128}$/;

/** One import: the path inside the share, and the filename it ends with. */
export type MailruPublicLink = {
  /** Every segment after `/public`, in order. The whole tail fetches the file. */
  segments: string[];
  /** The last segment — the name the video is given and the check that it is a video. */
  filename: string;
};

/**
 * Reads a public link, or returns null.
 *
 * Strict on purpose, and the strictness is the first line of defence rather than a
 * formality: `cloud.mail.ru.evil.example` ends with `.example`, not with the host, so an
 * `includes("cloud.mail.ru")` test would accept it — and that is the shape an attacker
 * sends.
 *
 * Two segments are accepted as well as three, because the file's tail is whatever the
 * share's address says it is and this module has only ever measured the three-segment form.
 * Refusing a two-segment link that happens to work would be trading a real feature for a
 * guess about a shape.
 */
export function parseMailruPublicLink(input: string): MailruPublicLink | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.hostname.toLowerCase() !== PUBLIC_HOST) return null;

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "public" || parts.length < 3) return null;

  const segments: string[] = [];
  for (const raw of parts.slice(1)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }

    // A segment that is not a plain token is not part of a share address. This is what
    // stops `..` and an encoded `/` from addressing something outside the share.
    if (!SEGMENT_PATTERN.test(decoded) || decoded === "." || decoded === "..") return null;
    segments.push(decoded);
  }

  const filename = segments[segments.length - 1]!;
  return { segments, filename };
}

/** True when a pasted string is an Облако Mail.ru public link. */
export function isMailruPublicLink(input: string): boolean {
  return parseMailruPublicLink(input) !== null;
}

/**
 * True when a host is one the dispatcher may send us to.
 *
 * The leading dot is load-bearing: without it `notcloud.mail.ru` and `evilcloud.mail.ru`
 * both end in `cloud.mail.ru` and would pass.
 */
export function isCloudDownloadHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === PUBLIC_HOST) return true;
  return DOWNLOAD_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** The address of the file, given the dispatcher's base and the share's tail. */
export function buildFilePathUrl(weblinkBase: string, segments: readonly string[]): string {
  const base = weblinkBase.replace(/\/+$/, "");
  const tail = segments.map((segment) => encodeURIComponent(segment)).join("/");
  return `${base}/${tail}`;
}

export const MAILRU_DISPATCHER_URL = "https://cloud.mail.ru/api/v2/dispatcher";

/** Fetch, as the caller injects it: the checks stub it, production passes `fetch`. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Why a resolution failed, so the route can answer with a sentence rather than a code. */
export type MailruFailure =
  | "not-a-link"
  | "dispatcher"
  | "not-found"
  | "too-large"
  | "unreachable";

export type MailruResolution =
  | { ok: true; url: string; filename: string; size: number }
  | { ok: false; reason: MailruFailure; detail?: string };

/** How long the dispatcher and the file probe may take. */
const METADATA_TIMEOUT_MS = 30_000;

/** The dispatcher's answer, or null when it is not the shape we measured. */
export function readDispatcherBase(payload: unknown): string | null {
  const body = (payload as { body?: unknown } | null)?.body;
  const weblinkGet = (body as { weblink_get?: unknown } | null)?.weblink_get;
  if (!Array.isArray(weblinkGet)) return null;

  const first = weblinkGet[0] as { url?: unknown } | undefined;
  if (!first || typeof first.url !== "string" || !first.url) return null;

  try {
    const parsed = new URL(first.url);
    // The base decides where we fetch from, so it is checked exactly like the rest.
    if (parsed.protocol !== "https:" || !isCloudDownloadHost(parsed.hostname)) return null;
  } catch {
    return null;
  }

  return first.url;
}

/**
 * Resolves a public link to a download address, without keeping the file.
 *
 * Two requests: the dispatcher, then the file itself — and the second is abandoned the
 * moment its headers have been read. Proving the file exists and how big it is does not
 * require downloading it, and on a metered VPS reading a 500 MB film to learn its length
 * would be the expensive way to find out it is too big.
 *
 * The address returned is `response.url` — where the redirect landed — rather than the
 * address asked for. It has already been checked against the host allowlist, and returning
 * it spares the download a second trip through Mail.ru's redirector.
 */
export async function resolveMailruDownload(
  fetchImpl: FetchLike,
  link: MailruPublicLink,
  maxBytes: number,
): Promise<MailruResolution> {
  let dispatcherPayload: unknown;
  try {
    const response = await fetchImpl(MAILRU_DISPATCHER_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, reason: "dispatcher", detail: `HTTP ${response.status}` };
    dispatcherPayload = await response.json();
  } catch (error) {
    return { ok: false, reason: "dispatcher", detail: messageOf(error) };
  }

  const base = readDispatcherBase(dispatcherPayload);
  if (!base) return { ok: false, reason: "dispatcher", detail: "неожиданный ответ" };

  const fileUrl = buildFilePathUrl(base, link.segments);

  let response: Response;
  try {
    response = await fetchImpl(fileUrl, {
      headers: { Accept: "*/*" },
      // The redirect to the CDN is part of the flow, so it is followed — and `response.url`
      // below is where it went.
      redirect: "follow",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, reason: "unreachable", detail: messageOf(error) };
  }

  // The headers are all that is needed; the body is abandoned so a large file is not
  // pulled down just to be measured. Called before every early return, or the socket stays
  // open until the collector notices.
  await response.body?.cancel().catch(() => {});

  if (response.status === 404) return { ok: false, reason: "not-found" };
  if (!response.ok) {
    return { ok: false, reason: "unreachable", detail: `HTTP ${response.status}` };
  }

  const landed = hostOf(response.url);
  if (!landed || !isCloudDownloadHost(landed)) {
    return { ok: false, reason: "unreachable", detail: `перенаправление на ${landed ?? "?"}` };
  }

  /*
    A folder link answers with a page rather than a file. Distinguished by the content type
    the CDN sends for a real file — `application/octet-stream`, measured — because the
    address alone cannot say.
  */
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("text/html") || contentType.includes("json")) {
    return { ok: false, reason: "not-found", detail: "по ссылке не файл" };
  }

  const size = Number(response.headers.get("content-length"));
  const known = Number.isFinite(size) && size > 0 ? size : 0;
  if (known > maxBytes) return { ok: false, reason: "too-large", detail: String(known) };

  return { ok: true, url: response.url || fileUrl, filename: link.filename, size: known };
}

/** The hostname of a URL, or null when it is not one. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "неизвестная ошибка";
}
