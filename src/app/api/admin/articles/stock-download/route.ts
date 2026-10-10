import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { UPLOAD_DIR, UPLOAD_URL_PREFIX } from "@/lib/upload-dir";
import { getSetting } from "@/lib/settings";
import {
  formatStockCredit,
  isFetchableUnsplashImage,
  readUnsplashPhoto,
  UNSPLASH_COVER_WIDTH,
  UnsplashError,
} from "@/lib/unsplash";

export const runtime = "nodejs";
/** Spends an Unsplash call and writes a file; nothing here may be cached. */
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/articles/stock-download` — take a photograph from Unsplash as the cover.
 *
 * Under `/api/admin/`, so Basic Auth applies, and requires `application/json` like the
 * other editorial routes: a form can only send urlencoded or multipart, neither of which
 * is valid JSON, while a cross-origin JSON request needs a preflight no CORS header here
 * permits.
 *
 * **The request body carries an id and nothing else.** The image address is read back from
 * Unsplash's own answer to `/photos/<id>` rather than accepted from the browser. An earlier
 * shape took the URL from the client, which would have made this route a server-side
 * fetcher for anything the editor typed into the form — an internal address included. The
 * id is the only thing that crosses the wire, and it is still checked against Unsplash's
 * shape before anything is fetched.
 *
 * **The download_location ping.** Unsplash's API terms require a hit on the photo's
 * `download_location` whenever it is used. It is taken from the metadata answer and never
 * from the request, and a failure to deliver it does not fail the download: the cover is
 * already in hand and the editor is waiting, whereas a dropped ping is a reporting matter.
 */

const MAX_BYTES = 8 * 1024 * 1024;

function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.split(";")[0].trim() === "application/json";
}

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  if (!isJsonRequest(request)) {
    return fail(415, "Ожидается POST с Content-Type: application/json.");
  }

  let body: { photoId?: unknown };
  try {
    body = (await request.json()) as { photoId?: unknown };
  } catch {
    return fail(400, "Тело запроса не является JSON.");
  }

  const photoId = typeof body.photoId === "string" ? body.photoId.trim() : "";
  // Unsplash ids are short and URL-safe. Checked here as well as by `photoUrl`'s
  // encoding, so a request that is obviously not a photo id never becomes an API call —
  // and never spends one of the fifty.
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(photoId)) {
    return fail(400, "Не указан идентификатор фотографии.");
  }

  const accessKey = (await getSetting("UNSPLASH_ACCESS_KEY")).trim();
  if (!accessKey) {
    return fail(503, "Не задан ключ Unsplash — добавьте его в /admin/settings.");
  }

  // 1. Read the photo's own metadata back from Unsplash.
  let photo;
  try {
    photo = await readUnsplashPhoto(fetch as never, accessKey, photoId);
  } catch (error) {
    if (error instanceof UnsplashError && error.kind === "hourly limit reached") {
      return fail(
        429,
        "Часовая лимита Unsplash исчерпан (50 запросов в час). Попробуйте позже.",
      );
    }
    if (error instanceof UnsplashError && error.kind === "auth") {
      return fail(502, "Unsplash отклонил ключ доступа. Проверьте его в /admin/settings.");
    }
    return fail(502, "Unsplash недоступен. Попробуйте позже.");
  }

  if (!photo) {
    return fail(404, "Фотография не найдена или недоступна.");
  }

  // 2. Announce the download, as the API terms ask. Before the bytes move, and never from
  //    a client-supplied address.
  if (photo.downloadLocation.startsWith("https://api.unsplash.com/")) {
    void fetch(photo.downloadLocation, {
      headers: { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      // Swallowed on purpose — see the note above. The cover does not depend on it.
    });
  }

  // 3. Fetch the image itself, from Unsplash's CDN and nowhere else.
  let downloaded: Buffer;
  try {
    if (!isFetchableUnsplashImage(photo.previewUrl)) {
      return fail(502, "Unsplash вернул адрес, который не является его CDN.");
    }

    const response = await fetch(photo.previewUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return fail(502, `Unsplash не отдал файл (HTTP ${response.status}).`);
    }

    downloaded = Buffer.from(await response.arrayBuffer());
    if (downloaded.length === 0) {
      return fail(502, "Unsplash вернул пустой файл.");
    }
    if (downloaded.length > MAX_BYTES) {
      return fail(502, "Файл больше 8 МБ.");
    }
  } catch {
    // The reason is dropped rather than echoed: a failed fetch's message can carry the
    // full signed URL, and this string is shown to the editor.
    return fail(502, "Не удалось скачать фотографию.");
  }

  // 4. Re-encode to a WebP cover, at the width the site already uses for covers.
  let filename: string;
  try {
    const { default: sharp } = await import("sharp");

    const webp = await sharp(downloaded)
      .rotate()
      .resize({
        width: UNSPLASH_COVER_WIDTH,
        // `inside`, so a portrait photograph comes out shorter rather than stretched to a
        // width it does not have.
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 88 })
      .toBuffer();

    filename = `stock-${randomUUID()}.webp`;
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, filename), webp);
  } catch {
    return fail(502, "Не удалось обработать фотографию.");
  }

  return NextResponse.json({
    ok: true,
    url: `${UPLOAD_URL_PREFIX}${filename}`,
    // The credit as text, for `photoSource`.
    credit: formatStockCredit(photo),
    /*
      What the photographer wrote about the picture, for `alt`.

      Not the same thing as the credit and not a substitute for it: the credit says who
      took it, the description says what is on it. The reader who cannot see the image is
      owes the second. Empty when the photographer wrote nothing, and the caller falls back
      to the credit rather than shipping an empty `alt`, which hides the picture from a
      screen reader entirely.
    */
    alt: photo.description ?? "",
    // And as its two links, for the columns that carry the licence's requirements.
    stock: {
      photoId: photo.id,
      authorName: photo.authorName,
      authorUrl: photo.authorUrl,
      photoUrl: photo.photoUrl,
    },
  });
}