import path from "node:path";

import { NextResponse } from "next/server";

import {
  MalformedUploadError,
  UploadTooLargeError,
  discardTempFile,
  fileUploadStream,
  isVideoFilename,
  streamFirstFileToDisk,
} from "@/lib/multipart-stream";
import { getSetting } from "@/lib/settings";
import { UPLOAD_DIR } from "@/lib/upload-dir";
import { VkVideoError, assertVkUploadUrl, callVkApi } from "@/lib/vk-video";
import {
  buildUploadName,
  extractUploadUrl,
  extractVideoIds,
  publicVideoUrl,
} from "@/lib/vk-video-format";
import { vkCommunityId, vkOwnerId } from "@/lib/vk-publisher";

export const runtime = "nodejs";

/**
 * Uploads an editor's video file to VK Video and returns the public link.
 *
 * Under /api/admin/, so the matcher in src/proxy.ts puts Basic Auth in front of it.
 * The token never leaves the server: the browser sends the file and receives a URL.
 *
 * The file is streamed to disk rather than parsed into memory. nginx accepts 500 MB
 * for this path, and `request.formData()` on that body is a couple of hundred
 * megabytes of heap on a 709 MB box — enough to take the site down rather than fail
 * one request.
 */

/** Matches the nginx `client_max_body_size` for this path. */
const MAX_BYTES = 500 * 1024 * 1024;

/**
 * VK's own upload ceiling for community video.
 *
 * VK rejects larger files at step two, after the bytes have already crossed the
 * network twice. Failing here turns a two-minute upload into an instant message.
 */
const VK_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** Where the temporary copy lives: same volume as the rest of UPLOAD_DIR. */
const TMP_DIR = path.join(UPLOAD_DIR, "tmp");

export async function POST(request: Request) {
  let tempPath: string | null = null;

  try {
    const token = await getSetting("VK_ACCESS_TOKEN");
    if (!token) {
      return NextResponse.json(
        {
          error:
            "Не задан токен ВК. Укажите его в разделе «Настройки» (/admin/settings) или в .env.",
        },
        { status: 503 },
      );
    }

    const community = vkCommunityId();
    if (!community) {
      return NextResponse.json(
        { error: "Не задан VK_COMMUNITY_ID в .env — некуда загружать видео." },
        { status: 503 },
      );
    }

    const upload = await streamFirstFileToDisk(request, {
      maxBytes: MAX_BYTES,
      tmpDir: TMP_DIR,
    });
    tempPath = upload.filePath;

    if (upload.size === 0) {
      return NextResponse.json({ error: "Файл пустой." }, { status: 400 });
    }

    if (!isVideoFilename(upload.filename) && !upload.contentType.startsWith("video/")) {
      return NextResponse.json(
        { error: "Ожидается видеофайл: .mp4, .mov, .webm или .mkv." },
        { status: 415 },
      );
    }

    if (upload.size > VK_MAX_BYTES) {
      return NextResponse.json(
        { error: "Файл больше 2 ГБ — ВК такой ролик не примет." },
        { status: 413 },
      );
    }

    // Step 1: reserve the video record. VK answers with a one-off upload address.
    const saved = await callVkApi<unknown>(
      "video.save",
      token,
      {
        group_id: community,
        name: buildUploadName(),
        is_private: 0,
        wallpost: 0,
        // No description: it is filled in by video.edit when the article publishes,
        // because at upload time the headline is usually still being written.
        no_comments: 1,
      },
    );

    const uploadUrl = assertVkUploadUrl(extractUploadUrl(saved));

    // Step 2: send the bytes. Streamed from the temp file, never buffered whole.
    //
    // `duplex: "half"` is required by undici for any request body that is a stream
    // rather than a fully-formed buffer, and the cast is what lets it through
    // TypeScript's BodyInit — Node's ReadStream is a valid undici body that the DOM
    // lib does not know about.
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      body: fileUploadStream(upload.filePath) as unknown as BodyInit,
      headers: { "Content-Type": "application/octet-stream" },
      duplex: "half",
      signal: AbortSignal.timeout(30 * 60_000),
    } as RequestInit);

    if (!uploadResponse.ok) {
      throw new VkVideoError(
        `ВК отклонил файл: HTTP ${uploadResponse.status}`,
        "upload",
      );
    }

    // VK answers 200 with a plain-number body on success; anything in `error` is
    // a real failure even on a 200.
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

    // The ids sometimes come back from video.save and sometimes only after the
    // upload, so both are consulted before giving up.
    const ids = extractVideoIds(saved) ?? (await resolveIds(token, community));

    if (!ids?.videoId) {
      throw new VkVideoError(
        "ВК принял файл, но не вернул id видео — ссылку собрать не из чего.",
        "save",
      );
    }

    console.log(
      `[vk-video] ${publicVideoUrl(ids.ownerId || vkOwnerId(), ids.videoId)} ← ${
        upload.filename
      }, ${Math.round(upload.size / 1024 / 1024)} МБ`,
    );

    return NextResponse.json({
      success: true,
      videoUrl: publicVideoUrl(ids.ownerId || vkOwnerId(), ids.videoId),
      videoId: ids.videoId,
      ownerId: ids.ownerId || vkOwnerId(),
    });
  } catch (error) {
    if (error instanceof UploadTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (error instanceof MalformedUploadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof VkVideoError) {
      // 503 for configuration, 502 for an upstream that answered badly.
      const status = /Не задан/.test(error.message) ? 503 : 502;
      console.error(`[vk-video] ${error.stage}: ${error.message}`);
      return NextResponse.json({ error: error.message }, { status });
    }

    console.error("[vk-video] необработанная ошибка", error);
    return NextResponse.json(
      { error: "Не удалось загрузить видео в ВК. Попробуйте ещё раз." },
      { status: 500 },
    );
  } finally {
    // The temp copy is never a deliverable — VK holds the video now — so it goes
    // away whether the upload worked or not. A leaked 500 MB file per attempt
    // would fill the disk the nginx change was meant to protect.
    if (tempPath) await discardTempFile(tempPath);
  }
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

const VK_API_VERSION = "5.199";