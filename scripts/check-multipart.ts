import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  MalformedUploadError,
  UploadTooLargeError,
  boundaryOf,
  isVideoFilename,
  streamFirstFileToDisk,
} from "../src/lib/multipart-stream";

/** Builds a real multipart body so the parser is tested against real framing. */
function buildMultipart(
  boundary: string,
  parts: { name: string; filename?: string; type?: string; body: Buffer }[],
): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"`;
    if (part.filename) header += `; filename="${part.filename}"`;
    header += "\r\n";
    if (part.type) header += `Content-Type: ${part.type}\r\n`;
    chunks.push(Buffer.from(`${header}\r\n`, "utf8"));
    chunks.push(part.body);
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(chunks);
}

function requestFor(body: Buffer, boundary: string, chunkSize = 64 * 1024): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Many small chunks on purpose: the delimiter-straddling path only runs when
      // a boundary lands across two reads.
      for (let offset = 0; offset < body.length; offset += chunkSize) {
        controller.enqueue(body.subarray(offset, offset + chunkSize));
      }
      controller.close();
    },
  });

  return new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: stream,
    // Node's Request needs this for a stream body.
    ...({ duplex: "half" } as object),
  } as RequestInit);
}

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
};

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "mp-test-"));

  try {
    // --- helpers ------------------------------------------------------------
    check(
      "boundary из Content-Type",
      boundaryOf('multipart/form-data; boundary=abc123') === "abc123" &&
        boundaryOf('multipart/form-data; boundary="a b"') === "a b" &&
        boundaryOf("application/json") === null,
      "оба вида и отказ",
    );
    check(
      "видео-расширения распознаются",
      isVideoFilename("a.MP4") && isVideoFilename("b.mov") && !isVideoFilename("c.jpg"),
      "mp4/mov — да, jpg — нет",
    );

    // --- a plain single file -----------------------------------------------
    const payload = Buffer.from("x".repeat(200_000));
    const boundary = "----probe";
    const body = buildMultipart(boundary, [
      { name: "file", filename: "clip.mp4", type: "video/mp4", body: payload },
    ]);

    const parsed = await streamFirstFileToDisk(requestFor(body, boundary), {
      maxBytes: 10 * 1024 * 1024,
      tmpDir: dir,
    });
    check(
      "файл извлечён целиком",
      parsed.size === payload.length &&
        readFileSync(parsed.filePath).equals(payload),
      `${parsed.size} байт`,
    );
    check(
      "имя и тип прочитан",
      parsed.filename === "clip.mp4" && parsed.contentType === "video/mp4",
      `${parsed.filename} / ${parsed.contentType}`,
    );

    // --- a text field before the file -------------------------------------
    const withField = buildMultipart(boundary, [
      { name: "caption", body: Buffer.from("подпись к ролику") },
      { name: "file", filename: "clip.mp4", type: "video/mp4", body: payload },
    ]);
    const parsedField = await streamFirstFileToDisk(requestFor(withField, boundary), {
      maxBytes: 10 * 1024 * 1024,
      tmpDir: dir,
    });
    check(
      "текстовое поле пропущено, файл взят",
      parsedField.filename === "clip.mp4" &&
        readFileSync(parsedField.filePath).equals(payload),
      `${parsedField.filename}, ${parsedField.size} байт`,
    );

    // --- chunk boundaries that straddle a delimiter ------------------------
    // chunkSize 7 is deliberately hostile: nearly every delimiter lands mid-chunk.
    for (const chunkSize of [1, 7, 13, 64]) {
      const parsedChunks = await streamFirstFileToDisk(
        requestFor(withField, boundary, chunkSize),
        { maxBytes: 10 * 1024 * 1024, tmpDir: dir },
      );
      check(
        `файл собран при chunk=${chunkSize}`,
        parsedChunks.filename === "clip.mp4" &&
          readFileSync(parsedChunks.filePath).equals(payload),
        `${parsedChunks.size} байт`,
      );
    }

    // --- payload containing delimiter-like bytes ---------------------------
    // A file whose content includes the boundary text must not be cut short.
    const tricky = Buffer.concat([
      payload,
      Buffer.from(`\r\n${boundary}`, "utf8"),
      payload,
    ]);
    const trickyBody = buildMultipart(boundary, [
      { name: "file", filename: "clip.mp4", type: "video/mp4", body: tricky },
    ]);
    const parsedTricky = await streamFirstFileToDisk(requestFor(trickyBody, boundary, 64), {
      maxBytes: 10 * 1024 * 1024,
      tmpDir: dir,
    });
    check(
      "похожие на разделитель байты внутри файла не порвали его",
      readFileSync(parsedTricky.filePath).equals(tricky),
      `${parsedTricky.size} из ${tricky.length}`,
    );

    // --- the size cap ------------------------------------------------------
    let capped = false;
    try {
      await streamFirstFileToDisk(requestFor(body, boundary), {
        maxBytes: 1000,
        tmpDir: dir,
      });
    } catch (error) {
      capped = error instanceof UploadTooLargeError;
    }
    check("превышение лимита отклонено", capped, "UploadTooLargeError");

    // --- malformed inputs --------------------------------------------------
    let notMultipart = false;
    try {
      await streamFirstFileToDisk(
        new Request("http://localhost/upload", { method: "POST", body: "raw" }),
        { maxBytes: 1024, tmpDir: dir },
      );
    } catch (error) {
      notMultipart = error instanceof MalformedUploadError;
    }
    check("не-multipart отклонён", notMultipart, "MalformedUploadError");

    let noBoundary = false;
    try {
      await streamFirstFileToDisk(
        new Request("http://localhost/upload", {
          method: "POST",
          headers: { "content-type": "multipart/form-data" },
          body: "x",
        }),
        { maxBytes: 1024, tmpDir: dir },
      );
    } catch (error) {
      noBoundary = error instanceof MalformedUploadError;
    }
    check("multipart без boundary отклонён", noBoundary, "MalformedUploadError");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} проверок пройдено`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });