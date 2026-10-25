import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

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
  /**
   * Short text fields that arrived **before** the file part, by name.
   *
   * Only the fields seen until the file is written: the parser returns the moment the file's
   * closing boundary is read, which is the point of it — the request stops being drained as
   * soon as the bytes are on disk. So a client that wants `title` and `description` must send
   * them ahead of the file, and that is said in the route too.
   *
   * Each value is capped at `FIELD_MAX_BYTES`; a field larger than that is truncated rather
   * than trusted, because these are names, not payloads.
   */
  fields: Record<string, string>;
};

/** How much of a text field is kept. Titles and descriptions are short by nature. */
const FIELD_MAX_BYTES = 4 * 1024;

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

  let state: "preamble" | "headers" | "body" | "field" = "preamble";
  let carry: Buffer = Buffer.alloc(0);
  let size = 0;
  let filename = "";
  let contentType = "";
  let wroteFile = false;
  const fields: Record<string, string> = {};
  /** Name and accumulated value of the plain field being read, if any. */
  let fieldName = "";
  let fieldValue: Buffer = Buffer.alloc(0);

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

          /*
            A part without a filename is a plain field. Its value is collected — `title` and
            `description` ride ahead of the file — but only up to `FIELD_MAX_BYTES`, and a part
            with no name at all is skipped exactly as before.
          */
          if (!filename) {
            const name = rawHeaders.match(/\bname="([^"]+)"/i)?.[1]?.trim() ?? "";
            if (name) {
              fieldName = name;
              fieldValue = Buffer.alloc(0);
              state = "field";
            } else {
              state = "preamble";
            }
            continue;
          }

          state = "body";
          continue;
        }

        if (state === "field") {
          /*
            The same boundary handling as the file body, with two differences: the value is held
            in memory (it is a name, not a payload), and reaching the cap truncates it rather than
            failing the request.
          */
          const closingField = chunk.indexOf(delimiter);
          if (closingField !== -1) {
            let end = closingField;
            if (end >= 2 && chunk.subarray(end - 2, end).equals(CRLF)) end -= 2;
            else if (end >= 1 && chunk[end - 1] === 0x0a) end -= 1;

            if (fieldValue.length < FIELD_MAX_BYTES) {
              fieldValue = Buffer.concat([fieldValue, chunk.subarray(0, end)]);
            }
            fields[fieldName] = fieldValue.subarray(0, FIELD_MAX_BYTES).toString("utf8");
            fieldName = "";
            fieldValue = Buffer.alloc(0);

            chunk = chunk.subarray(closingField + delimiter.length);
            state = "headers";
            continue;
          }

          const keepField = delimiter.length + 2;
          if (chunk.length <= keepField) {
            carry = chunk;
            chunk = Buffer.alloc(0);
            break;
          }

          if (fieldValue.length < FIELD_MAX_BYTES) {
            fieldValue = Buffer.concat([fieldValue, chunk.subarray(0, chunk.length - keepField)]);
          }
          carry = chunk.subarray(chunk.length - keepField);
          chunk = Buffer.alloc(0);
          break;
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
          return { filePath, filename, contentType, size, fields: { ...fields } };
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
  return { filePath, filename, contentType, size: info.size, fields: { ...fields } };
}

/** Best-effort cleanup; the caller may be handling an error already. */
export async function discardTempFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true }).catch(() => {});
}

/**
 * The multipart body VK's video upload expects, built around the file on disk.
 *
 * **Measured, and the reason this exists.** VK's upload endpoint answers **HTTP 412** to a
 * request whose body is the raw file with `Content-Type: application/octet-stream` — which
 * is what this project sent — and **HTTP 200** to the same bytes wrapped in
 * `multipart/form-data` under a field named `video_file`. Both were tried against the live
 * service with the same file. So the browser upload route had never worked either: it hit
 * the same 412 for as long as it existed, and nothing noticed because no check uploaded a
 * real file.
 *
 * Built by hand rather than with `FormData`, for the reason this module exists at all: a
 * `FormData` holding a `Blob` is the whole file in memory, and the box has 709 MB. The body
 * is a header, the file streamed straight off disk, and a footer — nothing is copied, and
 * `contentLength` is exact, so the request is sent with a length rather than chunked.
 */
export async function videoUploadBody(
  filePath: string,
  filename: string,
): Promise<{ body: Readable; contentType: string; contentLength: number }> {
  const { size } = await stat(filePath);

  // A per-request boundary. Random rather than fixed because a fixed one could appear in
  // the file's own bytes, and the upload would be truncated at that point.
  const boundary = `----ynewnsvk${randomUUID().replace(/-/g, "")}`;

  /*
    The filename is quoted and stripped of quotes, newlines and backslashes. It is VK's to
    ignore, but an unescaped quote here would end the parameter and turn the rest of the
    name into another header — the standard way a hand-built multipart body is broken.
  */
  const safeName = filename.replace(/["\\\r\n]/g, "_").slice(0, 180) || "video.mp4";

  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="video_file"; filename="${safeName}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");

  const body = Readable.from(
    (async function* stream() {
      yield head;
      // `for await` rather than a pipe into a PassThrough: it propagates backpressure from
      // the socket to the file handle without a second buffer in between.
      for await (const chunk of createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
        yield chunk as Buffer;
      }
      yield tail;
    })(),
  );

  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: head.length + size + tail.length,
  };
}