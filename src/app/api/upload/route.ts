import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { UPLOAD_DIR } from "@/lib/upload-dir";
import { encodeUpload } from "@/lib/upload-encode";

/**
 * Local media upload for the editorial CMS.
 *
 * Files are written outside `public/` and served by the /uploads/[...path]
 * route handler — Next snapshots `public/` at boot and would never serve a file
 * created afterwards. For a single-node deployment this keeps the publish flow
 * dependency-free; a multi-instance setup needs object storage instead.
 */

export const runtime = "nodejs";

/** Only real raster images; SVG is excluded because it can carry script. */
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Ожидается multipart/form-data с полем file." },
      { status: 400 },
    );
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Файл не передан." },
      { status: 400 },
    );
  }

  const extension = ALLOWED_TYPES[file.type];
  if (!extension) {
    return NextResponse.json(
      { error: "Допустимы только JPG, PNG и WebP." },
      { status: 415 },
    );
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "Файл пустой." }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Файл больше 8 МБ." },
      { status: 413 },
    );
  }

  const original = Buffer.from(await file.arrayBuffer());

  /*
    Re-encode before storing: this is the one place every photograph passes through, and a
    body image never reaches the `next/image` optimiser afterwards. Measured before this
    existed: 298 MB of uploads, 78 files over 1 MB, and a 1.2 MB JPEG downloaded in full by
    every reader of one article. See `lib/upload-encode.ts` for why the format is preserved
    and why a failure here still stores the file.
  */
  const encoded = await encodeUpload(original, file.type);
  if (!encoded) {
    return NextResponse.json(
      { error: "Допустимы только JPG, PNG и WebP." },
      { status: 415 },
    );
  }

  // The extension comes from the bytes `sharp` actually found, never from the
  // client-supplied filename or MIME, so a crafted name cannot influence the stored path.
  const filename = `${randomUUID()}${encoded.extension}`;

  /*
    A failed write is answered in JSON, like every other failure on this route.

    Measured on production when the disk filled: `writeFile` rejected, Next answered with
    its HTML error page, and every caller's `response.json()` died with
    `Unexpected token '<', "<html> <h"… is not valid JSON`. The editor was shown a parser
    error for a server that had run out of space — the one message that could not help.
  */
  try {
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, filename), encoded.bytes);
  } catch (error) {
    console.error("[upload] не удалось записать файл", error);
    const noSpace =
      error instanceof Error && /ENOSPC|no space left/i.test(`${error.message} ${error.name}`);
    return NextResponse.json(
      {
        error: noSpace
          ? "На сервере закончилось место — файл не сохранён. Сообщите администратору."
          : "Не удалось сохранить файл на сервере. Попробуйте ещё раз.",
      },
      { status: noSpace ? 507 : 500 },
    );
  }

  return NextResponse.json(
    { url: `/uploads/${filename}` },
    { status: 201 },
  );
}
