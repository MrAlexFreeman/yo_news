import path from "node:path";

/**
 * Where uploaded media lives on disk.
 *
 * Deliberately outside `public/`. Next snapshots the public directory when the
 * server boots, so files written at runtime are never served — verified on
 * both `next dev` and `next start`: an upload returned 201 with a usable URL,
 * but GET on that URL 404'd. Serving through /uploads/[...path] instead reads
 * from disk per request and works no matter when the file appeared.
 *
 * On a host with an ephemeral filesystem (Render's default), point
 * UPLOAD_DIR at a mounted disk or uploads will vanish on every redeploy.
 */
export const UPLOAD_DIR = path.resolve(
  process.env.UPLOAD_DIR?.trim() || path.join(process.cwd(), "uploads"),
);

/** Extension → MIME type for the formats the upload endpoint accepts. */
const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export function contentTypeFor(filename: string): string | null {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? null;
}

/**
 * Resolves a URL path segment to an absolute path inside UPLOAD_DIR, or null if
 * it would escape the directory. Guards against `..` traversal and absolute
 * paths smuggled through the URL.
 */
export function resolveUploadPath(relative: string): string | null {
  const decoded = decodeURIComponent(relative);
  if (decoded.includes("\0")) return null;

  const target = path.resolve(UPLOAD_DIR, decoded);
  const prefix = UPLOAD_DIR.endsWith(path.sep)
    ? UPLOAD_DIR
    : `${UPLOAD_DIR}${path.sep}`;

  return target === UPLOAD_DIR || target.startsWith(prefix) ? target : null;
}
