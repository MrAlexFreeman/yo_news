import { readFile, stat } from "node:fs/promises";

import { contentTypeFor, resolveUploadPath } from "@/lib/upload-dir";

/**
 * Serves uploaded media from disk.
 *
 * `public/uploads` cannot be used for this: Next takes a snapshot of the public
 * directory at boot and never picks up files written afterwards, so every cover
 * uploaded through the CMS returned a broken image. Reading from disk per
 * request avoids that entirely.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params;

  if (!segments?.length) {
    return new Response("Not found", { status: 404 });
  }

  const target = resolveUploadPath(segments.join("/"));
  if (!target) {
    return new Response("Not found", { status: 404 });
  }

  const contentType = contentTypeFor(target);
  if (!contentType) {
    // Only the image formats the upload endpoint accepts are ever served.
    return new Response("Not found", { status: 404 });
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) {
      return new Response("Not found", { status: 404 });
    }

    const body = await readFile(target);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(info.size),
        // Filenames are UUIDs and never change, so they cache hard.
        "Cache-Control": "public, max-age=31536000, immutable",
        // Never let a stored file be sniffed into something executable.
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
