/**
 * Reading a story's cover off the disk, for whoever has to upload it somewhere.
 *
 * Extracted from vk-publisher because there are now three publishers — VK, Telegram
 * and MAX — and they must agree on what a cover is. Duplicated three times it would
 * drift the first time someone added a format, and the drift would show up as one
 * messenger posting without a picture and the other two not.
 *
 * The function is re-exported from vk-publisher, which is where it lived first, so
 * `scripts/check-vk-publisher.ts` keeps importing it from the path it already uses.
 */

import { readFile } from "node:fs/promises";

import { contentTypeFor, resolveUploadPath, UPLOAD_URL_PREFIX } from "@/lib/upload-dir";

/**
 * Absolute base for links handed to a third party.
 *
 * Falls back to localhost so that a misconfigured `.env` produces a visibly wrong
 * link rather than a link to nothing.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const base = configured && configured.length > 0 ? configured : "http://localhost:3000";
  return base.replace(/\/+$/, "");
}

/**
 * The bytes of a cover image, plus what the recipient should be told they are.
 *
 * Three cases, and they are not interchangeable:
 *
 * 1. `/uploads/<name>` — read from disk. This is the case that was broken: `fetch()`
 *    in Node rejects a relative URL outright ("Failed to parse URL from /uploads/…"),
 *    so every repost since uploads moved out of `public/` went out with no picture at
 *    all, and the only trace was a warning in the error log that reads like noise.
 *
 *    Reading the file is also the right call rather than building an absolute URL and
 *    fetching it: it avoids a request from the server to itself through nginx on every
 *    publish, and it does not depend on the public hostname being resolvable from
 *    inside the process — which is not true on every host.
 *
 * 2. `http(s)://…` — fetched. A cover may legitimately live somewhere else, and there
 *    is nothing to read from disk for it.
 *
 * 3. Any other relative path — a file Next serves from `public/`, say. Resolved
 *    against the site URL, which is the only way Node can fetch it.
 */
export async function readCoverImage(
  coverImage: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const trimmed = coverImage.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`cover image fetch failed with HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    return { bytes: await response.arrayBuffer(), contentType };
  }

  if (trimmed.startsWith(UPLOAD_URL_PREFIX)) {
    // `resolveUploadPath` is the same guard the /uploads route uses: it rejects a path
    // that would escape UPLOAD_DIR, so a stored value cannot be used to read an
    // arbitrary file off the server.
    const target = resolveUploadPath(trimmed.slice(UPLOAD_URL_PREFIX.length));
    if (!target) {
      throw new Error("cover image path escapes the upload directory");
    }

    const contentType = contentTypeFor(target);
    if (!contentType) {
      throw new Error("cover image is not a supported image format");
    }

    /*
      Copied into a fresh ArrayBuffer rather than handed over as a Node Buffer: a
      Buffer is a view onto a pool, and `Blob` will not accept a view whose buffer
      may be a SharedArrayBuffer.

      This is `readFile` rather than a `createReadStream` pipe because every consumer
      ends at `FormData.append`, which takes a `Blob` and not a stream — a stream
      would have to be buffered into one first, so streaming here would be two
      mechanisms producing the same bytes. A cover is capped at a few megabytes by
      the upload endpoint, so the buffering is not worth optimising away.
    */
    const file = await readFile(target);
    return {
      bytes: Uint8Array.from(file).buffer,
      contentType,
    };
  }

  // Case 3. Made absolute here rather than at the call site so every caller of
  // `readCoverImage` gets the same behaviour.
  const response = await fetch(`${siteUrl()}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`cover image fetch failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  return { bytes: await response.arrayBuffer(), contentType };
}

/** The extension that goes with a content type, for a multipart filename. */
export function extensionFor(contentType: string): string | null {
  switch (contentType.split(";")[0]?.trim().toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return null;
  }
}