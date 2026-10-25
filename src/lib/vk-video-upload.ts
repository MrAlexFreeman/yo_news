import { getSetting } from "@/lib/settings";
import { VkVideoError, assertVkUploadUrl, callVkApi } from "@/lib/vk-video";
import {
  buildUploadName,
  extractUploadUrl,
  extractVideoIds,
  publicVideoUrl,
  videoAttachmentId,
} from "@/lib/vk-video-format";
import { videoUploadBody } from "@/lib/multipart-stream";
import { vkCommunityId, vkOwnerId } from "@/lib/vk-publisher";

/**
 * Handing a file on disk to VK Video.
 *
 * Extracted from the upload route when a second caller appeared: the route that imports a
 * video from Облако Mail.ru needs the same three steps, and the guard that matters — the
 * upload address VK returns is arbitrary and must be checked before a stream is piped at it
 * — would otherwise exist twice and be fixed once.
 *
 * The file is not read into memory here either: `videoUploadBody` streams it off disk inside
 * a hand-built multipart body. The multipart wrapper is not decoration — see the measured
 * 412 in that function's comment; this call sent the raw bytes for a long time and VK
 * refused every one of them.
 */

const VK_API_VERSION = "5.199";

/** Long enough for a large video over a home connection, still bounded. */
const UPLOAD_TIMEOUT_MS = 30 * 60_000;

export type VkUploadResult = {
  videoUrl: string;
  videoId: string;
  ownerId: string;
  /** The id VK wants in `attachments`: `video{owner}_{video}`. */
  vkVideoId: string;
};

/** The token, or a throw the caller turns into a configuration message. */
export async function requireVkVideoConfig(): Promise<{ token: string; community: string }> {
  const token = await getSetting("VK_ACCESS_TOKEN");
  if (!token) {
    throw new VkVideoError(
      "Не задан токен ВК. Укажите его в разделе «Настройки» (/admin/settings) или в .env.",
      "prepare",
    );
  }

  const community = vkCommunityId();
  if (!community) {
    throw new VkVideoError("Не задан VK_COMMUNITY_ID в .env — некуда загружать видео.", "prepare");
  }

  return { token, community };
}

/**
 * Reserves a video, sends the bytes, and returns the public address.
 *
 * `name` is the caller's: an editor's own file gets a timestamped placeholder because the
 * headline is usually still being written, while an imported video may already know what it
 * is called.
 */
export async function uploadVideoFileToVk(input: {
  token: string;
  community: string;
  filePath: string;
  /** Only for the log line. */
  label: string;
  name?: string;
  /**
   * Short description for the video record. Optional: the upload route takes it from the
   * editor, the Mail.ru import has nothing to say beyond the filename.
   */
  description?: string;
}): Promise<VkUploadResult> {
  // Step 1: reserve the record. VK answers with a one-off upload address.
  const saved = await callVkApi<unknown>("video.save", input.token, {
    group_id: input.community,
    name: input.name ?? buildUploadName(),
    // VK trims this itself; sending an empty string instead is rejected as an empty field.
    ...(input.description?.trim()
      ? { description: input.description.trim().slice(0, 1_000) }
      : {}),
    is_private: 0,
    // No wall post on upload: the video is attached to an article, and a bare video on the
    // community wall is not the announcement anybody wants.
    wallpost: 0,
    // Comments off on the upload: a video attached to an article is discussed on the site,
    // and the wall post that carries it is where the conversation belongs.
    no_comments: 1,
  });

  const uploadUrl = assertVkUploadUrl(extractUploadUrl(saved));

  /*
    Step 2: the bytes, streamed from disk inside the multipart envelope VK requires.

    The measured fact behind this: identical bytes as `application/octet-stream` answer
    HTTP 412, and the same bytes under a `video_file` part answer HTTP 200. `contentLength`
    is exact, so the request is not chunked — which also removes a class of proxy surprises.
  */
  const filename = input.filePath.split(/[\\/]/).pop() || "video.mp4";
  const { body, contentType, contentLength } = await videoUploadBody(input.filePath, filename);

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    body: body as unknown as BodyInit,
    headers: { "Content-Type": contentType, "Content-Length": String(contentLength) },
    duplex: "half",
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  } as RequestInit);

  if (!uploadResponse.ok) {
    throw new VkVideoError(`ВК отклонил файл: HTTP ${uploadResponse.status}`, "upload");
  }

  // VK answers 200 with a plain number on success; an `error` object on a 200 is still a
  // failure, which is the trap this reads around.
  const uploadedBody = await uploadResponse.text().catch(() => "");
  if (uploadedBody.trim().startsWith("{")) {
    const parsed = JSON.parse(uploadedBody) as {
      error?: { error_msg?: string; error_code?: number };
    };
    if (parsed.error) {
      throw new VkVideoError(
        `ВК отклонил файл: ${parsed.error.error_msg ?? "неизвестная ошибка"} (${
          parsed.error.error_code ?? "?"
        })`,
        "upload",
      );
    }
  }

  // The ids come back from video.save, or only after the upload. Both are consulted.
  const ids = extractVideoIds(saved) ?? (await resolveIds(input.token, input.community));

  if (!ids?.videoId) {
    throw new VkVideoError(
      "ВК принял файл, но не вернул id видео — ссылку собрать не из чего.",
      "save",
    );
  }

  const ownerId = ids.ownerId || vkOwnerId();
  const videoUrl = publicVideoUrl(ownerId, ids.videoId);
  const vkVideoId = videoAttachmentId(ownerId, ids.videoId);

  console.log(`[vk-video] ${videoUrl} ← ${input.label}`);

  return { videoUrl, videoId: ids.videoId, ownerId, vkVideoId };
}

/** Asks VK which videos the community has, to recover ids when save omitted them. */
async function resolveIds(
  token: string,
  community: string,
): Promise<{ videoId: string; ownerId: string } | null> {
  const listed = await callVkApi<unknown>(
    "video.get",
    token,
    { owner_id: community, count: 1, v: VK_API_VERSION },
    15_000,
  );

  const items = Array.isArray(listed) ? listed : [];
  const first = items[0] as Record<string, unknown> | undefined;
  if (!first || first.video_id === undefined) return null;

  return { videoId: String(first.video_id), ownerId: String(first.owner_id ?? community) };
}
