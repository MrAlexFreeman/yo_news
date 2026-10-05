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
 * The public address of an uploaded video, as an editor would paste it.
 *
 * VK addresses community videos with a negative owner id and a hyphen:
 * `vk.com/video-241944021_678901`.
 */
export function publicVideoUrl(ownerId: string, videoId: string): string {
  const owner = ownerId.startsWith("-") ? ownerId : `-${ownerId}`;
  return `https://vk.com/video${owner}_${videoId}`;
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