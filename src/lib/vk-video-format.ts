/**
 * Pure helpers for VK Video: URL validation, response parsing, and the text that
 * ends up on the video record.
 *
 * Free of `server-only`, credentials and `fetch` so the security suite can import
 * it. Everything here is a decision about *what* to send or accept; the decisions
 * about *with which token* live in vk-video.ts.
 */

/** Which part of the flow failed, so the editor sees an actionable message. */
export type VkVideoStage = "prepare" | "upload" | "save" | "edit";

export class VkVideoError extends Error {
  constructor(
    message: string,
    readonly stage: VkVideoStage,
  ) {
    super(message);
    this.name = "VkVideoError";
  }
}

/**
 * Hosts VK hands back for a binary upload, and nothing else.
 *
 * This is the guard that matters most in the whole feature. `video.save` returns
 * an `upload_url`, and the next step is POSTing the editor's file to whatever that
 * URL says. Without this check, anyone able to influence the API response — or
 * anyone who pointed the app at a mock — could make the server stream an uploaded
 * video to an arbitrary address, including one inside the network this box sits in.
 *
 * The list is measured, not copied from documentation, and `ovu.mycdn.me` is the entry
 * that proves why. It was missing, and `video.save` for community video answers with an
 * upload address on exactly that host — Mail.ru's CDN, which serves VK's uploads. So the
 * guard refused every real upload: the browser route failed with «Адрес загрузки указывает
 * не на ВК: ovu.mycdn.me» and had been failing since the day it shipped, because nothing
 * exercised it against the live API.
 */
const UPLOAD_HOST_ALLOWED = new Set([
  "vk.com",
  "www.vk.com",
  "m.vk.com",
  "vk.ru",
  "www.vk.ru",
  "vkvideo.ru",
  "www.vkvideo.ru",
  "api.vk.com",
  // Where VK actually sends community video bytes. Measured against the live API.
  "ovu.mycdn.me",
  "sun9.com",
  "sun-1.com",
  "sun-2.com",
  "sun-3.com",
  "sun-4.com",
  "sun-5.com",
  "sun-6.com",
  "sun-7.com",
  "sun-8.com",
  "sun-9.com",
  "userapi.com",
  "www.userapi.com",
]);

/**
 * Returns the parsed URL if it is an https address on a VK-owned host, and throws
 * otherwise. Returning the URL means the caller cannot re-parse a different string.
 */
export function assertVkUploadUrl(candidate: unknown): URL {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new VkVideoError("ВК не вернул адрес для загрузки видео.", "prepare");
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new VkVideoError("ВК вернул некорректный адрес загрузки.", "prepare");
  }

  if (parsed.protocol !== "https:") {
    throw new VkVideoError("Адрес загрузки должен быть https.", "prepare");
  }

  if (!UPLOAD_HOST_ALLOWED.has(parsed.hostname.toLowerCase())) {
    // The hostname is in the message on purpose: an operator reading the log needs
    // to see where the file was about to be sent, and it is a public service name.
    throw new VkVideoError(
      `Адрес загрузки указывает не на ВК: ${parsed.hostname}`,
      "prepare",
    );
  }

  return parsed;
}

/**
 * Reads the upload URL out of a `video.save` response.
 *
 * VK has returned this payload in more than one shape across versions — a bare
 * `upload_url`, and one nested under `video`. Only those two are recoverable; a
 * response carrying neither is reported rather than guessed at.
 */
export function extractUploadUrl(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const body = response as Record<string, unknown>;

  const direct = body.upload_url;
  if (typeof direct === "string" && direct.length > 0) return direct;

  const video = body.video;
  if (video && typeof video === "object") {
    const nested = (video as Record<string, unknown>).upload_url;
    if (typeof nested === "string" && nested.length > 0) return nested;
  }

  return null;
}

/** Reads the ids out of a `video.save` response. */
export function extractVideoIds(
  response: unknown,
): { videoId: string; ownerId: string } | null {
  if (!response || typeof response !== "object") return null;
  const body = response as Record<string, unknown>;
  const video =
    body.video && typeof body.video === "object"
      ? (body.video as Record<string, unknown>)
      : body;

  const videoId = video.video_id;
  const ownerId = video.owner_id;
  if (videoId === undefined && ownerId === undefined) return null;

  return {
    videoId: String(videoId ?? ""),
    ownerId: String(ownerId ?? ""),
  };
}

/**
 * Canonicalises a video attachment id coming back from the editor's form.
 *
 * The hidden field that carries it is a form field like every other, so the server does not
 * take its word for the shape. That is not paranoia about editors: `wall.post` given a
 * malformed attachment does not post text without a video, it answers error 100 and publishes
 * nothing — the same trap `buildAttachments` documents for link attachments. A value that is
 * not `video{owner}_{id}` therefore becomes "no video", not a broken post.
 */
export function normaliseVkVideoId(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!/^video-?\d+_\d+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Anything a browser plausibly calls a video.
 *
 * Lives here, in the module about VK's expectations, because the upload endpoint validates
 * the extension of the multipart part: a name it does not recognise is refused with HTTP 415.
 * The browser-side validator in `multipart-stream` reads the same set, so a file one accepts
 * is a file the other can hand over.
 */
export const VIDEO_FILE_EXTENSIONS = new Set([
  ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv", ".flv", ".mpg", ".mpeg", ".3gp",
]);

/**
 * The filename VK's upload endpoint must see on the multipart part.
 *
 * Measured on the live service: identical bytes under `filename="…<uuid>.upload"` answer
 * **HTTP 415 — Unsupported Media Type** (a Tomcat error page), and under
 * `filename="…<uuid>.mp4"` answer **HTTP 200** with a `video_hash`. So the extension on this
 * parameter is load-bearing, and it is the one thing the temporary copy on disk cannot
 * supply: it is deliberately named `vk-video-<uuid>.upload`, because the client's filename is
 * attacker-controlled and gets joined onto a directory.
 *
 * A name without a recognised video extension becomes `video.mp4`. Nothing else about the
 * name matters to VK here — `video.save` carries the real title — so a fallback costs
 * nothing and keeps a forgotten `filename` argument from turning into a refused upload.
 */
export function videoPartFilename(name: string | null | undefined): string {
  const cleaned = (name ?? "").trim().replace(/["\\\r\n]/g, "_");
  // A full path is tolerated: only VK's extension check reads this, and a path separator in
  // the parameter would be an odd thing to forward.
  const base = cleaned.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  const extension = dot === -1 ? "" : base.slice(dot).toLowerCase();
  return VIDEO_FILE_EXTENSIONS.has(extension) ? base.slice(0, 180) : "video.mp4";
}

/**
 * The attachment id VK expects in `attachments`: `video{owner}_{id}`.
 *
 * The owner id carries the minus for a community video — `video-241944021_678901` — and
 * this is the one place that decides it. `publicVideoUrl` is built from it, so the address
 * an editor sees and the id the wall post is given cannot disagree about the sign.
 */
export function videoAttachmentId(ownerId: string, videoId: string): string {
  const owner = ownerId.startsWith("-") ? ownerId : `-${ownerId}`;
  return `video${owner}_${videoId}`;
}

/**
 * The public address of an uploaded video, as an editor would paste it.
 *
 * VK addresses community videos with a negative owner id and a hyphen:
 * `vk.com/video-241944021_678901`.
 */
export function publicVideoUrl(ownerId: string, videoId: string): string {
  return `https://vk.com/${videoAttachmentId(ownerId, videoId)}`;
}

/** Parses `video-241944021_678901` or `clip-241944021_678901` out of a video URL. */
export function parseVideoIdsFromUrl(
  url: string,
): { ownerId: string; videoId: string } | null {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, "");
    if (!/^(vk|vkvideo)\.(com|ru)$/.test(host)) return null;

    const match = parsed.pathname.match(/(?:video|clip)(-?\d+)_(\d+)/);
    if (!match) return null;

    return { ownerId: match[1], videoId: match[2] };
  } catch {
    return null;
  }
}

/** VK's own cap on a video name. */
const NAME_LIMIT = 128;

/**
 * The name given to a freshly uploaded video.
 *
 * Timestamped rather than named after the article: at upload time the headline is
 * often still being edited, and `video.edit` on publish replaces this anyway. The
 * timestamp also makes an unnamed video identifiable in the VK interface.
 */
export function buildUploadName(now: number = Date.now()): string {
  return `Видео к новости ${now}`;
}

/**
 * The name and description applied when the article goes live.
 *
 * The description is the lead plus the article link, so the video carries the same
 * context as a VK wall post. Both are trimmed rather than truncated: a cut-off
 * sentence in a description reads worse than a shorter complete one.
 */
export function buildEditFields(input: {
  title: string;
  lead?: string | null;
  articleUrl: string;
}) {
  const name = input.title.trim().slice(0, NAME_LIMIT);
  const lead = input.lead?.trim();
  const articleUrl = input.articleUrl.trim();

  return { name, desc: lead ? `${lead}\n\n${articleUrl}` : articleUrl };
}