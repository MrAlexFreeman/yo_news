import { createReadStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Streams a single file out of a multipart request onto disk.
 *
 * This exists because `request.formData()` is the obvious way to read an upload
 * and the wrong one here: it materialises the whole body in memory. With nginx
 * accepting 500 MB for this route on a 709 MB box that is not a large upload, it
 * is the process being killed mid-request — and the site's other work goes down
 * with it. So the body is piped straight to a file and only the small header
 * fields are kept in memory.
 *
 * Deliberately scoped to one file: this route uploads a video and nothing else,
 * and a general parser would be a general parser to maintain forever.
 */

export type ParsedUpload = {
  /** Absolute path of the temporary file holding the bytes. */
  filePath: string;
  /** Filename as sent by the browser; advisory only, never used for a path. */
  filename: string;
  /** Content-Type declared for the part, if any. */
  contentType: string;
  size: number;
};

/** Anything a browser plausibly calls a video. */
const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv", ".flv", ".mpg", ".mpeg", ".3gp",
]);

export function isVideoFilename(name: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** Extracts the boundary token from a multipart Content-Type. */
export function boundaryOf(contentType: string): string | null {
  if (!/multipart\/form-data/i.test(contentType)) return null;
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] ?? match?.[2];
  return boundary && boundary.length > 0 ? boundary : null;
}

export class UploadTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Файл больше ${Math.round(limit / 1024 / 1024)} МБ.`);
    this.name = "UploadTooLargeError";
  }
}

export class MalformedUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedUploadError";
  }
}

/**
 * Walks the multipart stream, writing the first part that carries a filename.
 *
 * A three-state scan — before the boundary, in headers, in the body — with a carry
 * buffer for the few bytes of a delimiter that straddle two chunks. Chunks arriving
 * at a delimiter boundary are the case that breaks naive `indexOf` handling, so the
 * tail is always re-examined with the next chunk.
 */
export async function streamFirstFileToDisk(
  request: Request,
  target: { maxBytes: number; tmpDir: string },
): Promise<ParsedUpload> {
  const boundary = boundaryOf(request.headers.get("content-type") ?? "");
  if (!boundary) {
    throw new MalformedUploadError("Ожидается multipart/form-data с boundary.");
  }
  if (!request.body) {
    throw new MalformedUploadError("Тело запроса пусто.");
  }

  await mkdir(target.tmpDir, { recursive: true });
  // randomUUID, not the client's filename: the name is attacker-controlled and
  // this path is joined onto a directory.
  const filePath = path.join(target.tmpDir, `vk-video-${crypto.randomUUID()}.upload`);

  const delimiter = Buffer.from(`--${boundary}`);
  const CRLF = Buffer.from("\r\n");

  let state: "preamble" | "headers" | "body" = "preamble";
  let carry: Buffer = Buffer.alloc(0);
  let size = 0;
  let filename = "";
  let contentType = "";
  let wroteFile = false;

  const out = createWriteStream(filePath);
  const finish = async () => {
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on("error", reject);
    });
  };

  const reader = request.body.getReader();

  /** Appends file bytes, enforcing the cap before anything reaches the disk. */
  const writeBytes = async (piece: Buffer) => {
    if (piece.length === 0) return;
    size += piece.length;
    if (size > target.maxBytes) throw new UploadTooLargeError(target.maxBytes);
    if (!out.write(piece)) await new Promise<void>((r) => out.once("drain", () => r()));
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      // Buffer.from, not the raw Uint8Array: the scan below uses Buffer.indexOf
      // with a string needle and Buffer.subarray(...).equals(...).
      const incoming: Buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      let chunk: Buffer = carry.length > 0 ? Buffer.concat([carry, incoming]) : incoming;
      carry = Buffer.alloc(0);

      for (;;) {
        if (state === "preamble") {
          const index = chunk.indexOf(delimiter);
          if (index === -1) {
            // Keep the last delimiter.length-1 bytes: a delimiter could start there.
            carry = chunk.subarray(Math.max(0, chunk.length - delimiter.length + 1));
            chunk = Buffer.alloc(0);
            break;
          }
          chunk = chunk.subarray(index + delimiter.length);
          state = "headers";
          continue;
        }

        if (state === "headers") {
          // Headers end at a blank line: CRLFCRLF, or LFLF for lenient clients.
          let end = chunk.indexOf("\r\n\r\n");
          let skip = 4;
          if (end === -1) {
            end = chunk.indexOf("\n\n");
            skip = 2;
          }
          if (end === -1) {
            carry = chunk;
            chunk = Buffer.alloc(0);
            break;
          }

          const rawHeaders = chunk.subarray(0, end).toString("utf8");
          filename =
            rawHeaders.match(/filename\*?=(?:UTF-8'')?"?([^"\r\n;]+)/i)?.[1]?.trim() ?? "";
          contentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? "";

          chunk = chunk.subarray(end + skip);

          // A part without a filename is a plain field. Keep scanning for the one
          // that does have one rather than writing a text field to disk.
          if (!filename) {
            state = "preamble";
            continue;
          }

          state = "body";
          continue;
        }

        // state === "body"
        const closing = chunk.indexOf(delimiter);
        if (closing !== -1) {
          let end = closing;
          // The CRLF before the delimiter belongs to the framing, not the file.
          if (end >= 2 && chunk.subarray(end - 2, end).equals(CRLF)) end -= 2;
          else if (end >= 1 && chunk[end - 1] === 0x0a) end -= 1;

          await writeBytes(chunk.subarray(0, end));

          wroteFile = true;
          await finish();
          return { filePath, filename, contentType, size };
        }

        // Everything except a possible trailing partial delimiter is file data.
        //
        // The window is delimiter + 2, not just the delimiter: the CRLF that
        // precedes the delimiter belongs to the framing and has to be trimmed off
        // the end of the file, and with a window of exactly `delimiter.length` that
        // CRLF could already have been flushed to disk on the previous chunk. The
        // file then came out one or two bytes long.
        const keep = delimiter.length + 2;
        if (chunk.length <= keep) {
          // Held, not written. Writing here as well would write every accumulated
          // byte again on the next read — the file grew by the carry length for
          // each chunk small enough to hit this branch.
          carry = chunk;
          chunk = Buffer.alloc(0);
          break;
        }

        await writeBytes(chunk.subarray(0, chunk.length - keep));
        carry = chunk.subarray(chunk.length - keep);
        chunk = Buffer.alloc(0);
        break;
      }
    }

    await finish();
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => {});
    throw error;
  }

  // An empty stream that never reached the body state.
  if (!wroteFile) {
    await rm(filePath, { force: true }).catch(() => {});
    throw new MalformedUploadError("В запросе нет файла.");
  }

  const info = await stat(filePath);
  return { filePath, filename, contentType, size: info.size };
}

/** Best-effort cleanup; the caller may be handling an error already. */
export async function discardTempFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true }).catch(() => {});
}

/**
 * A read stream for handing the temporary file to VK.
 *
 * `highWaterMark` is raised from the default 64 KB: a 300 MB video over a 64 KB
 * window turns into thousands of small TLS writes and an upload that crawls.
 */
export function fileUploadStream(filePath: string) {
  return createReadStream(filePath, { highWaterMark: 1024 * 1024 });
}