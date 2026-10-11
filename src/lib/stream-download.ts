import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * Streaming a remote file to a temporary file on disk.
 *
 * The box has 709 MB of RAM, so a video is never a buffer: bytes go from the network socket
 * to the filesystem with a megabyte in flight. `arrayBuffer()` on a 300 MB film is a
 * three-hundred-megabyte allocation on a machine that would then start swapping the site to
 * death rather than failing one request.
 *
 * `fetch` follows redirects on its own, which is why the host allowlist is checked twice —
 * once by the caller on the address it asked for, and once here on `response.url`, which is
 * where a redirect would have taken it. A public-link resolver that trusted the first check
 * alone would be a way to read any address the box can reach.
 */

/** Thrown when a download would exceed the caller's ceiling. */
export class DownloadTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Файл больше ${Math.round(limit / 1024 / 1024)} МБ.`);
  }
}

/** Thrown when a redirect leaves the hosts the caller allowed. */
export class DownloadHostError extends Error {
  constructor(readonly host: string) {
    super(`Загрузка ушла на ${host} — этот хост не разрешён.`);
  }
}

export type DownloadOptions = {
  /** Where the temporary file is written. Created if missing. */
  tmpDir: string;
  /** Hard ceiling on the bytes written. */
  maxBytes: number;
  /** Suffix for the temp name, so the file keeps a usable extension. */
  extension?: string;
  /** Called with the host of every address actually fetched, including after redirects. */
  allowHost: (hostname: string) => boolean;
  /** Long enough for a video over a home connection, still bounded. */
  timeoutMs?: number;
};

export type DownloadedFile = { filePath: string; size: number };

/** Fetches `url` and writes it to a temp file, or throws having cleaned up after itself. */
export async function downloadToTempFile(
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
  url: string,
  options: DownloadOptions,
): Promise<DownloadedFile> {
  const asked = hostOf(url);
  if (!asked || !options.allowHost(asked)) throw new DownloadHostError(asked ?? "?");

  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 20 * 60_000),
    headers: { Accept: "*/*" },
  });

  // After redirects. `response.url` is the address the bytes actually came from.
  const landed = hostOf(response.url || url);
  if (!landed || !options.allowHost(landed)) {
    await response.body?.cancel().catch(() => {});
    throw new DownloadHostError(landed ?? "?");
  }

  if (!response.ok) throw new Error(`Загрузка не удалась: HTTP ${response.status}`);
  if (!response.body) throw new Error("Ответ без тела.");

  // Refused before a byte is written when the server states the size.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await response.body.cancel().catch(() => {});
    throw new DownloadTooLargeError(options.maxBytes);
  }

  await mkdir(options.tmpDir, { recursive: true });
  const filePath = path.join(
    options.tmpDir,
    `${randomUUID()}${options.extension ?? ""}`,
  );

  let written = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length;
      // The ceiling is enforced while streaming, not only from the header: a chunked
      // response states no size at all, and that is exactly how an oversized file would
      // otherwise walk past the check above.
      callback(
        written > options.maxBytes ? new DownloadTooLargeError(options.maxBytes) : null,
        chunk,
      );
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      counter,
      createWriteStream(filePath),
    );
  } catch (error) {
    // A half-written video is never a deliverable, so it goes whether the failure was the
    // ceiling, the network or the disk.
    await rm(filePath, { force: true }).catch(() => {});
    throw error;
  }

  return { filePath, size: written };
}

/** The hostname of a URL, or null when it is not one. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
