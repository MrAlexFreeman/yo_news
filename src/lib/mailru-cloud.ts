/**
 * Облако Mail.ru: a public link resolved into a stream of bytes.
 *
 * ---------------------------------------------------------------------------
 * Why this exists at all, and why it cannot be an embed
 * ---------------------------------------------------------------------------
 * `cloud.mail.ru` refuses to be framed — it answers with `X-Frame-Options: SAMEORIGIN` and
 * a `Content-Security-Policy: frame-ancestors` list that does not include this site. That
 * was measured, and it is why a pasted Mail.ru Cloud link shows an error inside an article
 * rather than a player. The video therefore has to be *moved*: fetched here and uploaded to
 * VK, whose player does embed.
 *
 * ---------------------------------------------------------------------------
 * What was measured against the live service
 * ---------------------------------------------------------------------------
 * `GET https://cloud.mail.ru/api/v2/dispatcher` answers with a per-session download base:
 *
 *   { "body": { "weblink_get": [ { "url": "https://cloclo63.cloud.mail.ru/public/<token>/g/no" } ] } }
 *
 * and `GET {base}/{key}` answers 404 with `{"error":"NOT/FOUND"}` for a key that is not
 * there. So the dispatcher is called per import — the token in that path is part of the
 * session and a cached base goes stale.
 *
 * **`api/v2/tokens/download`, which the brief names, is not usable here.** It answers
 * `403 {"body":"user"}`: it wants an authenticated Mail.ru session, and a public link gives
 * us none. The dispatcher route is the one that works without a login, which is what a
 * newsroom pasting a public link has.
 *
 * ---------------------------------------------------------------------------
 * The security property, which matters more than the feature
 * ---------------------------------------------------------------------------
 * This module fetches a URL that somebody typed. Left at that it is an SSRF hole: a
 * "cloud.mail.ru" link that redirects to `http://169.254.169.254/` would have the server
 * read its own metadata and hand it back. Three things close it, and all three are
 * asserted:
 *
 *   1. only `cloud.mail.ru/public/<key>/<name>` is accepted as input — a host allowlist and
 *      a path shape, not a substring match;
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
 * `cloclo1…cloclo64.cloud.mail.ru` and names a different one every call. The leading dot in
 * the check is what keeps `evil-cloud.mail.ru` out.
 */
const DOWNLOAD_HOST_SUFFIXES = [".cloud.mail.ru", ".datacloudmail.ru"] as const;

/** Keys in a public link: opaque, URL-safe, and not empty. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

/** One import, and the two parts of the public address it came from. */
export type MailruPublicLink = {
  /** The public folder hash — the first segment. */
  key1: string;
  /** The file name inside it — the second segment, percent-decoded. */
  key2: string;
};

/**
 * Reads a public link, or returns null.
 *
 * Strict on purpose, and the strictness is the first line of defence rather than a
 * formality: `cloud.mail.ru.evil.example` ends with `.example`, not with the host, so an
 * `includes("cloud.mail.ru")` test would accept it — and that is the shape an attacker
 * would send.
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

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] !== "public" || segments.length < 3) return null;

  const [key1, rawName] = [segments[1]!, segments[2]!];
  if (!KEY_PATTERN.test(key1)) return null;

  let key2: string;
  try {
    key2 = decodeURIComponent(rawName);
  } catch {
    return null;
  }

  // A name with a slash in it would address something other than the file that was linked.
  if (!key2 || key2.includes("/") || key2.includes("\0")) return null;

  return { key1, key2 };
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

/** The URL that lists a public folder, given the dispatcher's base. */
export function buildListingUrl(weblinkBase: string, key1: string): string {
  const base = weblinkBase.replace(/\/+$/, "") || "/";
  const separator = base.endsWith("/") ? "" : "/";
  return `${base}${separator}${encodeURIComponent(key1)}`;
}

/** A file found in a public folder listing. */
export type MailruFile = {
  name: string;
  size: number;
  /** The address to fetch it from, as the listing gave it. */
  url: string;
};

/**
 * Picks the wanted file out of a folder listing.
 *
 * The listing is third-party JSON, so nothing about it is trusted: the name is compared
 * after decoding, the size is only believed if it is a finite number, and the URL is
 * returned as a string for the caller to re-validate against the host allowlist rather than
 * being followed here.
 *
 * The wanted name is matched case-insensitively — the address bar's copy of a Cyrillic or
 * mixed-case filename is not guaranteed to come back with the same casing. When no entry
 * matches by name, the first video-ish file is taken, because a public link to a single
 * file is the common case and its listing holds exactly one.
 */
export function pickFileFromListing(listing: unknown, wantedName: string): MailruFile | null {
  const entries = extractEntries(listing);
  if (entries.length === 0) return null;

  const wanted = wantedName.toLowerCase();
  const byName = entries.find((entry) => entry.name.toLowerCase() === wanted);
  const chosen = byName ?? entries.find((entry) => isVideoName(entry.name)) ?? null;

  return chosen;
}

function extractEntries(listing: unknown): MailruFile[] {
  const body = (listing as { body?: unknown } | null)?.body;
  const list = (body as { list?: unknown } | null)?.list;
  if (!Array.isArray(list)) return [];

  const files: MailruFile[] = [];

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;

    // A folder is not a file: its `type` says so, and following it would fetch a page.
    if (entry.type === "folder") continue;
    if (typeof entry.name !== "string" || !entry.name || entry.name.includes("/")) continue;
    if (typeof entry.weblink !== "string" || !entry.weblink) continue;

    const size = typeof entry.size === "number" && Number.isFinite(entry.size) ? entry.size : 0;
    files.push({ name: entry.name, size, url: entry.weblink });
  }

  return files;
}

/** Video extensions this site is willing to move into VK. */
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".mkv", ".avi"] as const;

/** True for a filename that looks like a video. */
export function isVideoName(name: string): boolean {
  const lower = name.toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

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

export const MAILRU_DISPATCHER_URL = "https://cloud.mail.ru/api/v2/dispatcher";

/** Fetch, as the caller injects it: the checks stub it, production passes `fetch`. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Why a resolution failed, so the route can answer with a sentence rather than a code. */
export type MailruFailure =
  | "not-a-link"
  | "dispatcher"
  | "not-found"
  | "not-a-video"
  | "too-large"
  | "unreachable";

export type MailruResolution =
  | { ok: true; url: string; filename: string; size: number }
  | { ok: false; reason: MailruFailure; detail?: string };

/** How long the dispatcher and the listing may take. Short: both are small JSON answers. */
const METADATA_TIMEOUT_MS = 20_000;

/**
 * Resolves a public link to a download address, without downloading anything.
 *
 * Two requests at most: the dispatcher, then the folder listing. The file itself is
 * fetched by the caller, streamed, because a video is not something to hold in memory on
 * this box.
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

  /*
    One request to the public path. A file link answers with bytes; a folder link answers
    with JSON. Which of the two it is cannot be known in advance, so the content type
    decides — and in the folder case the body is a small listing that is fine to read into
    memory, unlike the file.
  */
  const listingUrl = buildListingUrl(base, link.key1);
  let response: Response;
  try {
    response = await fetchImpl(listingUrl, {
      headers: { Accept: "application/json, */*" },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch (error) {
    return { ok: false, reason: "unreachable", detail: messageOf(error) };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: response.status === 404 ? "not-found" : "unreachable",
      detail: `HTTP ${response.status}`,
    };
  }

  // A redirect that left the allowed hosts is refused before anything is downloaded.
  const finalHost = hostOf(response.url);
  if (!finalHost || !isCloudDownloadHost(finalHost)) {
    return { ok: false, reason: "unreachable", detail: `перенаправление на ${finalHost ?? "?"}` };
  }

  if (!isJsonResponse(response)) {
    // A single-file link: the listing URL *is* the file.
    return acceptFile(response.url || listingUrl, link.key2, sizeOf(response), maxBytes);
  }

  let listing: unknown;
  try {
    listing = await response.json();
  } catch (error) {
    return { ok: false, reason: "unreachable", detail: messageOf(error) };
  }

  const file = pickFileFromListing(listing, link.key2);
  if (!file) return { ok: false, reason: "not-found" };
  if (!isVideoName(file.name)) return { ok: false, reason: "not-a-video", detail: file.name };

  const fileHost = hostOf(file.url);
  if (!fileHost || !isCloudDownloadHost(fileHost)) {
    return { ok: false, reason: "unreachable", detail: `ссылка на ${fileHost ?? "?"}` };
  }

  return acceptFile(file.url, file.name, file.size, maxBytes);
}

function acceptFile(
  url: string,
  filename: string,
  size: number,
  maxBytes: number,
): MailruResolution {
  if (size > maxBytes) return { ok: false, reason: "too-large", detail: `${size}` };
  return { ok: true, url, filename, size };
}

function isJsonResponse(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("json");
}

function sizeOf(response: Response): number {
  const header = Number(response.headers.get("content-length"));
  return Number.isFinite(header) && header > 0 ? header : 0;
}

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
