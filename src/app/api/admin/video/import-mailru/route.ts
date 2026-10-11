import path from "node:path";

import { NextResponse } from "next/server";

import {
  DownloadHostError,
  DownloadTooLargeError,
  downloadToTempFile,
} from "@/lib/stream-download";
import { discardTempFile, isVideoFilename } from "@/lib/multipart-stream";
import { UPLOAD_DIR } from "@/lib/upload-dir";
import { VkVideoError } from "@/lib/vk-video";
import { requireVkVideoConfig, uploadVideoFileToVk } from "@/lib/vk-video-upload";
import { isCloudDownloadHost, isMailruPublicLink, parseMailruPublicLink } from "@/lib/mailru-cloud";
import {
  type MailruFailure,
  resolveMailruDownload,
} from "@/lib/mailru-cloud";

export const runtime = "nodejs";

/**
 * Moves a video out of Облако Mail.ru and into VK Video.
 *
 * ---------------------------------------------------------------------------
 * Why this route exists rather than an embed
 * ---------------------------------------------------------------------------
 * `cloud.mail.ru` refuses to be framed — `X-Frame-Options: SAMEORIGIN` and a
 * `frame-ancestors` list without this site in it, both measured. An `<iframe>` pointing at
 * a public Mail.ru Cloud page renders an error inside the article, so the video has to be
 * moved to a host that does embed. VK does, and this site already has a community and a
 * token for it.
 *
 * ---------------------------------------------------------------------------
 * The two things that must not go wrong here
 * ---------------------------------------------------------------------------
 * **Memory.** The box has 709 MB of RAM and the file may be hundreds of megabytes. Nothing
 * is ever held whole: Mail.ru is read as a stream into a temporary file, VK is written from
 * a stream off that file, and the file is deleted in `finally` however the request ends.
 *
 * **Where we fetch from.** The caller sends a link, which makes this a server-side request
 * forgery surface by construction. Nothing the caller sends is fetched directly: the URL is
 * parsed to a `cloud.mail.ru/public/<key>/<name>` shape, the download address comes from
 * Mail.ru's own dispatcher, and every address actually fetched — including one arrived at
 * by redirect — is checked against a host allowlist before a byte is written.
 */

/** Matches the ceiling the browser-upload route uses; VK takes no more usefully. */
const MAX_BYTES = 500 * 1024 * 1024;

const TMP_DIR = path.join(UPLOAD_DIR, "tmp");

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json(
      { error: "Ожидается POST с Content-Type: application/json." },
      { status: 415 },
    );
  }

  let body: { url?: unknown };
  try {
    body = (await request.json()) as { url?: unknown };
  } catch {
    return NextResponse.json({ error: "Тело запроса не является JSON." }, { status: 400 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const link = parseMailruPublicLink(url);
  if (!link) {
    return NextResponse.json(
      {
        error:
          "Нужна публичная ссылка вида https://cloud.mail.ru/public/<ключ>/<файл>. " +
          "Встроить страницу Облака напрямую нельзя — оно запрещает встраивание, " +
          "поэтому видео сначала переносится в ВК.",
      },
      { status: 400 },
    );
  }

  // Configuration first: it is the cheapest failure and the only one the editor fixes.
  let config: { token: string; community: string };
  try {
    config = await requireVkVideoConfig();
  } catch (error) {
    if (error instanceof VkVideoError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  let tempPath: string | null = null;

  try {
    const resolved = await resolveMailruDownload(fetch as never, link, MAX_BYTES);
    if (!resolved.ok) {
      return NextResponse.json(
        { error: failureMessage(resolved.reason, resolved.detail) },
        { status: resolved.reason === "too-large" ? 413 : 502 },
      );
    }

    if (!isVideoFilename(resolved.filename)) {
      return NextResponse.json(
        { error: `«${resolved.filename}» не похож на видеофайл.` },
        { status: 415 },
      );
    }

    const downloaded = await downloadToTempFile(fetch as never, resolved.url, {
      tmpDir: TMP_DIR,
      maxBytes: MAX_BYTES,
      extension: path.extname(resolved.filename).toLowerCase(),
      allowHost: isCloudDownloadHost,
    });
    tempPath = downloaded.filePath;

    const result = await uploadVideoFileToVk({
      token: config.token,
      community: config.community,
      filePath: downloaded.filePath,
      label: `${resolved.filename}, ${Math.round(downloaded.size / 1024 / 1024)} МБ`,
      // Named after the file it came from, which for an imported video is more useful than
      // a timestamp: the editor can find it in the community's list afterwards.
      name: resolved.filename.slice(0, 120),
    });

    return NextResponse.json({ success: true, ...result, source: resolved.filename });
  } catch (error) {
    if (error instanceof DownloadTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (error instanceof DownloadHostError) {
      // Never expected from the resolver's own answer; kept because a redirect that left
      // the allowlist would land here and it must not look like a network blip.
      console.error(`[mailru] ${error.message}`);
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    if (error instanceof VkVideoError) {
      console.error(`[mailru] ${error.stage}: ${error.message}`);
      return NextResponse.json({ error: error.message }, { status: 502 });
    }

    console.error("[mailru] необработанная ошибка", error);
    return NextResponse.json(
      { error: "Не удалось перенести видео из Облака. Попробуйте ещё раз." },
      { status: 500 },
    );
  } finally {
    // However this ended — success, a rejection, a thrown error — the copy on disk is not
    // a deliverable. VK has the video, and a leaked 500 MB file per attempt would fill a
    // disk that has under 3 GB free.
    if (tempPath) await discardTempFile(tempPath);
  }
}

/** The editor-facing sentence for each way the resolution can fail. */
function failureMessage(reason: MailruFailure, detail?: string): string {
  switch (reason) {
    case "not-a-link":
      return "Это не похоже на публичную ссылку Облака Mail.ru.";
    case "dispatcher":
      return `Облако Mail.ru не ответило на запрос диспетчера${detail ? ` (${detail})` : ""}. Попробуйте позже.`;
    case "not-found":
      return "По этой ссылке файл не найден — возможно, публикация удалена.";
    case "not-a-video":
      return `По ссылке не видеофайл${detail ? `: ${detail}` : ""}.`;
    case "too-large":
      return `Файл больше ${Math.round(MAX_BYTES / 1024 / 1024)} МБ — перенести не получится.`;
    case "unreachable":
      return `Не удалось получить файл из Облака${detail ? ` (${detail})` : ""}.`;
    default:
      return "Не удалось перенести видео из Облака.";
  }
}

/** Exported for the checks: the same predicate the route uses to reject a link. */
export { isMailruPublicLink };
