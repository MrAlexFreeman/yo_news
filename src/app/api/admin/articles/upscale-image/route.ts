import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { contentTypeFor, resolveUploadPath, UPLOAD_DIR, UPLOAD_URL_PREFIX } from "@/lib/upload-dir";
import { runFalQueue, type FetchLike } from "@/lib/fal-queue";
import { runHuggingFaceUpscale, type FetchLike as HfFetchLike } from "@/lib/hf-upscale";
import {
  buildUpscaleInput,
  DEFAULT_UPSCALE_OPTIONS,
  providerLabel,
  readResultSize,
  readResultUrl,
  resolveFaceEnhance,
  resolveUpscaleProvider,
  resolveUpscaleScale,
  transportReason,
  upscaleFailureMessage,
  UpscaleError,
  UPSCALE_MAX_INPUT_BYTES,
  UPSCALE_STEP_TIMEOUT_MS,
  type UpscaleProvider,
  type UpscaleStage,
} from "@/lib/image-upscale";
import { getSetting } from "@/lib/settings";

export const runtime = "nodejs";
/** Reads a row and talks to a provider; nothing here may be cached. */
export const dynamic = "force-dynamic";

/**
 * «Улучшить фото» — upscale and de-noise an already-uploaded cover.
 *
 * A third route in the editorial API beside `/api/admin/generate-cover` and the upload
 * endpoint, because the operation is neither of them: it takes a file that already exists,
 * spends money on a different provider, and returns a new file rather than replacing one.
 *
 * Under `/api/admin/`, so `src/proxy.ts` requires Basic Auth, and `POST` requires
 * `application/json` — the same guard that stops a cross-origin page from spending the
 * account's credit by posting a form.
 *
 * **The cover is only ever read from `UPLOAD_DIR`, never fetched from a URL.** The shared
 * `readCoverImage` helper would accept an `http(s)` cover and fetch it, which is right for the
 * messengers — they need a picture whatever its origin — but wrong here: this endpoint would
 * become a server-side fetcher for any URL an editor typed into the cover field, including
 * one pointing at an internal address. Restricting it to `/uploads/` removes that surface, and
 * it is also the only case that can work, because fal is handed the bytes inline rather than
 * a link (see lib/image-upscale.ts).
 */

type RequestBody = {
  /** The stored cover, e.g. `/uploads/abc.png`. */
  coverImage?: unknown;
  scale?: unknown;
  face?: unknown;
};

function fail(stage: UpscaleStage, detail?: string, provider?: UpscaleProvider) {
  return NextResponse.json(
    { error: upscaleFailureMessage(stage, detail, provider) },
    { status: stage === "input" ? 400 : 502 },
  );
}

/**
 * Resolves a stored `/uploads/…` value to bytes on disk.
 *
 * The two rejections are both load-bearing. `resolveUploadPath` is the same guard the
 * `/uploads` route uses and refuses a path that would escape the upload directory, so a
 * crafted value cannot read an arbitrary file off the server. `contentTypeFor` refuses a
 * file that is not one of the three raster formats the upload endpoint accepts, which keeps
 * an HTML file saved by some other route from being sent upstream as an image.
 */
async function readStoredCover(coverImage: string): Promise<{
  bytes: Buffer;
  contentType: string;
}> {
  if (!coverImage.startsWith(UPLOAD_URL_PREFIX)) {
    throw new UpscaleError("обложка должна быть загруженным файлом", "input");
  }

  const target = resolveUploadPath(coverImage.slice(UPLOAD_URL_PREFIX.length));
  if (!target) {
    throw new UpscaleError("путь ведёт за пределы папки загрузок", "input");
  }

  const contentType = contentTypeFor(target);
  if (!contentType) {
    throw new UpscaleError("файл не является JPG, PNG или WebP", "input");
  }

  const { readFile } = await import("node:fs/promises");

  let file: Buffer;
  try {
    file = await readFile(target);
  } catch {
    /*
      The raw reason is deliberately dropped. Node's ENOENT message carries the absolute
      path it tried — `/var/www/uartnews/uploads/…` — and this string is shown to the editor
      in a toast and written to the browser console. The path is not something the page has
      any business knowing, and "the file is gone" is the whole of what it needs to act on.
    */
    throw new UpscaleError("файл не найден в папке загрузок", "input");
  }

  if (file.length === 0) {
    throw new UpscaleError("файл пустой", "input");
  }
  if (file.length > UPSCALE_MAX_INPUT_BYTES) {
    throw new UpscaleError("файл больше 8 МБ — улучшать нечего, загрузите меньший", "input");
  }

  return { bytes: file, contentType };
}

/** fal's queue, once: submit, poll to completion, fetch the result. */
async function runUpscale(
  apiKey: string,
  input: Record<string, unknown>,
): Promise<{ payload: unknown }> {
  const payload = await runFalQueue({
    fetchImpl: fetch as unknown as FetchLike,
    apiKey,
    input,
  });

  return { payload };
}

/**
 * One provider's answer: the improved file, and the pixel size when the provider reported it.
 *
 * Both providers are reduced to this before anything is written, so the storage path, the
 * re-encode and the response shape below are written once and cannot drift between them.
 */
type UpscaleOutcome = {
  bytes: Buffer;
  width: number;
  height: number;
  provider: UpscaleProvider;
};

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json(
      { error: "Ожидается POST с Content-Type: application/json." },
      { status: 415 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Тело запроса не является JSON." }, { status: 400 });
  }

  const coverImage = typeof body.coverImage === "string" ? body.coverImage.trim() : "";

  if (!coverImage) {
    return fail("input", "обложка не указана");
  }

  let cover: { bytes: Buffer; contentType: string };
  try {
    cover = await readStoredCover(coverImage);
  } catch (error) {
    const detail = error instanceof Error ? error.message : undefined;
    return fail("input", detail);
  }

  /*
    Read both keys before choosing. Asking only for fal and treating "no fal key" as "no
    upscale available" is what put a «Не задан ключ fal.ai» in front of an editor on a server
    that had a perfectly good second provider configured — the warning named one of two
    ways the feature could work and so read as "upscaling is broken".
  */
  const [falKey, huggingFaceKey] = await Promise.all([
    getSetting("FAL_API_KEY"),
    getSetting("HUGGINGFACE_API_KEY"),
  ]);
  const provider = resolveUpscaleProvider({ falApiKey: falKey, huggingfaceApiKey: huggingFaceKey });

  if (!provider) {
    return NextResponse.json(
      {
        error:
          "Не задан ни один ключ улучшения фото. Добавьте ключ fal.ai или Hugging Face в /admin/settings.",
      },
      { status: 503 },
    );
  }

  const options = {
    // The defaults live in the pure module so there is one place that decides them; here
    // they are only a base for whatever the caller asked for.
    ...DEFAULT_UPSCALE_OPTIONS,
    scale: resolveUpscaleScale(body.scale),
    face: resolveFaceEnhance(body.face),
  };

  let outcome: UpscaleOutcome;

  try {
    if (provider === "huggingface") {
      const bytes = await runHuggingFaceUpscale({
        fetchImpl: fetch as unknown as HfFetchLike,
        token: huggingFaceKey.trim(),
        image: cover.bytes,
      });

      // The Hub returns the picture in the response, so there is no second fetch and no
      // expiring link to race. Dimensions come from the file itself for the same reason the
      // body is sniffed: a 200 that is not an image must not become a stored cover.
      const { default: sharp } = await import("sharp");
      const meta = await sharp(bytes).metadata();

      outcome = {
        bytes,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        provider,
      };
    } else {
      const { toFalImageInput } = await import("@/lib/image-upscale");
      const result = await runUpscale(
        falKey.trim(),
        buildUpscaleInput(toFalImageInput(cover.bytes, cover.contentType), options),
      );
      const payload = result.payload;

      const downloadUrl = readResultUrl(payload);
      if (!downloadUrl) {
        return fail("download", "в ответе нет ссылки на изображение", provider);
      }

      // fal's media links expire, so downloading immediately is not optional.
      const response = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(UPSCALE_STEP_TIMEOUT_MS),
      });

      if (!response.ok) {
        return fail("download", `HTTP ${response.status}`, provider);
      }

      const bytes = Buffer.from(await response.arrayBuffer());

      if (bytes.length === 0) {
        return fail("download", "провайдер вернул пустой файл", provider);
      }
      if (bytes.length > UPSCALE_MAX_INPUT_BYTES) {
        return fail("download", "файл больше 8 МБ", provider);
      }

      outcome = {
        bytes,
        width: readResultSize(payload)?.width ?? 0,
        height: readResultSize(payload)?.height ?? 0,
        provider,
      };
    }
  } catch (error) {
    if (error instanceof UpscaleError) return fail(error.stage, error.message, provider);
    return fail("wait", transportReason(error), provider);
  }

  // Store as WebP, like every other generated cover.
  try {
    const { default: sharp } = await import("sharp");
    const filename = `upscaled-${randomUUID()}.webp`;

    const webp = await sharp(outcome.bytes)
      .rotate()
      .webp({ quality: 88 })
      .toBuffer();

    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(UPLOAD_DIR, filename), webp);

    return NextResponse.json({
      ok: true,
      url: `${UPLOAD_URL_PREFIX}${filename}`,
      width: outcome.width,
      height: outcome.height,
      scale: options.scale,
      face: options.face,
      // So the editor is told which engine ran: both produce a working upscale, and without
      // this a provider that never fired is indistinguishable from one that did.
      provider: outcome.provider,
      providerLabel: providerLabel(outcome.provider),
    });
  } catch (error) {
    return fail("save", transportReason(error), provider);
  }
}