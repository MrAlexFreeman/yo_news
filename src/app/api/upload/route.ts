import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { UPLOAD_DIR } from "@/lib/upload-dir";

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

  // The extension comes from the allowlist above, never from the client-supplied
  // filename, so a crafted name cannot influence the stored path.
  const filename = `${randomUUID()}${extension}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(
    path.join(UPLOAD_DIR, filename),
    Buffer.from(await file.arrayBuffer()),
  );

  return NextResponse.json(
    { url: `/uploads/${filename}` },
    { status: 201 },
  );
}
