import path from "node:path";

import { NextResponse } from "next/server";

import {
  MalformedUploadError,
  UploadTooLargeError,
  discardTempFile,
  isVideoFilename,
  streamFirstFileToDisk,
} from "@/lib/multipart-stream";
import { UPLOAD_DIR } from "@/lib/upload-dir";
import { VkVideoError } from "@/lib/vk-video";
import { requireVkVideoConfig, uploadVideoFileToVk } from "@/lib/vk-video-upload";

export const runtime = "nodejs";

/**
 * Uploads an editor's video file to VK Video and returns the public link and attachment id.
 *
 * Under /api/admin/, so the matcher in src/proxy.ts puts Basic Auth in front of it.
 * The token never leaves the server: the browser sends the file and receives an address.
 *
 * **The file is streamed to disk, never parsed into memory.** nginx accepts 500 MB for this
 * path, and `request.formData()` on that body is a couple of hundred megabytes of heap on a
 * 709 MB box — enough to take the site down rather than fail one request.
 *
 * **`title` and `description` must come before the file part.** The streaming parser returns
 * the moment the file's closing boundary is read — that is the point of it — so text fields
 * behind the file would never be seen. The form sends them first, and a caller that forgets
 * loses the name, not the upload: `video.save` falls back to a timestamp and `video.edit`
 * replaces it at publication anyway.
 *
 * The VK half — reserve, stream, read back the ids — lives in `lib/vk-video-upload.ts`,
 * shared with the route that imports a video from Облако Mail.ru. What is here is only the
 * part that differs: the file arrives from the browser instead of from another host.
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
    const { token, community } = await requireVkVideoConfig();

    const upload = await streamFirstFileToDisk(request, {
      maxBytes: MAX_BYTES,
      tmpDir: TMP_DIR,
    });
    tempPath = upload.filePath;

    if (upload.size === 0) {
      return NextResponse.json({ ok: false, error: "Файл пустой." }, { status: 400 });
    }

    if (!isVideoFilename(upload.filename) && !upload.contentType.startsWith("video/")) {
      return NextResponse.json(
        { ok: false, error: "Ожидается видеофайл: .mp4, .mov, .webm или .mkv." },
        { status: 415 },
      );
    }

    if (upload.size > VK_MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Файл больше 2 ГБ — ВК такой ролик не примет." },
        { status: 413 },
      );
    }

    const title = (upload.fields.title ?? "").trim().slice(0, 128);
    const description = (upload.fields.description ?? "").trim().slice(0, 1_000);

    const result = await uploadVideoFileToVk({
      token,
      community,
      filePath: upload.filePath,
      label: `${upload.filename}, ${Math.round(upload.size / 1024 / 1024)} МБ`,
      // The name the browser sent, which already passed `isVideoFilename`. The temp copy on
      // disk is `.upload`, and that extension is refused by VK (see `videoPartFilename`).
      filename: upload.filename,
      ...(title ? { name: title } : {}),
      ...(description ? { description } : {}),
    });

    /*
      `playerUrl` is the public page the site embeds from — `https://vk.com/video-…`. VK's
      `video.save` also answers with a `player` field, an iframe-ready embed; it is not passed
      through because the storefront builds its own player from this address
      (`buildVideoEmbed`), and two ways to embed one video is one way too many.
    */
    return NextResponse.json({
      ok: true,
      vkVideoId: result.vkVideoId,
      playerUrl: result.videoUrl,
      videoId: result.videoId,
      ownerId: result.ownerId,
    });
  } catch (error) {
    if (error instanceof UploadTooLargeError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 413 });
    }
    if (error instanceof MalformedUploadError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    if (error instanceof VkVideoError) {
      // 503 for configuration, 502 for an upstream that answered badly.
      const status = /Не задан/.test(error.message) ? 503 : 502;
      console.error(`[vk-video] ${error.stage}: ${error.message}`);
      return NextResponse.json({ ok: false, error: error.message }, { status });
    }

    console.error("[vk-video] необработанная ошибка", error);
    return NextResponse.json(
      { ok: false, error: "Не удалось загрузить видео в ВК. Попробуйте ещё раз." },
      { status: 500 },
    );
  } finally {
    // The temp copy is never a deliverable — VK holds the video now — so it goes
    // away whether the upload worked or not. A leaked 500 MB file per attempt
    // would fill the disk the nginx change was meant to protect.
    if (tempPath) await discardTempFile(tempPath);
  }
}
