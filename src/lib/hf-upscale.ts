/**
 * The Hugging Face fallback for cover upscaling.
 *
 * Pure, and free of credentials, `server-only` and Prisma, for the same reason
 * `lib/fal-queue.ts` is: the interesting behaviour here is a retry policy against a
 * server that may be cold, and none of it can be tested from inside a route that
 * imports `server-only`. `fetch` is injected for exactly that reason.
 *
 * **What this provider is and is not.** `caidas/swin2SR-classical-sr-x2-64` is Swin2SR —
 * a super-resolution transformer that reconstructs detail supported by the pixels, in the
 * same family of reasoning as Real-ESRGAN and for the same reason it was chosen over the
 * diffusion upscalers: a fabricated detail in a news photograph is a fabricated fact,
 * and it is undetectable afterwards because the file looks better.
 *
 * The model named in the original brief, `akhaliq/Real-ESRGAN`, does not exist: the Hub
 * answers 401 for it, which is how it reports a missing or private repository, while a
 * known-good model answers 200 from the same host. It is recorded here so the substitution
 * is not mistaken for a typo later.
 *
 * **The endpoint.** Verified against the Hub's own documentation rather than assumed:
 * `POST {router}/hf-inference/models/{model}` with the image as a raw bytes payload, and
 * the output as raw image bytes. A JSON envelope with a base64 `inputs` field is the other
 * documented shape, but it inflates an 8 MB cover by a third for no benefit when the bytes
 * are accepted directly.
 */

import { isAbort, readProviderDetail, transportReason, UpscaleError } from "@/lib/image-upscale";

/**
 * The router, not `api-inference.huggingface.co`.
 *
 * The old host no longer resolves at all — a DNS failure, not a 404 — and the current
 * documentation points every inference task at the router. Kept as one exported string so
 * the test-connection route and this module cannot drift apart.
 */
export const HF_ROUTER_BASE = "https://router.huggingface.co";

/**
 * The model.
 *
 * Swin2SR rather than anything from the SwinIR family named in the brief: it is the only
 * long-updated x2 super-resolution checkpoint of the set that the Hub actually serves as
 * an image-to-image pipeline, it is Apache-2.0, and it has a fixed factor of two — which is
 * the default scale this route already offers, so no resampling is imposed afterwards.
 *
 * Fixed at 2×: the model is x2 by construction, and the `-s` flag this provider does not
 * have would have been the obvious way to fake a 4× that the weights cannot produce.
 */
export const HF_UPSCALE_MODEL = "caidas/swin2SR-classical-sr-x2-64";

/** Shown to the editor in the failure message. */
const MODEL_LABEL = "Hugging Face";

/**
 * One attempt's time budget.
 *
 * Longer than fal's, because a cold start is billed as compute and legitimately takes
 * tens of seconds; the total budget below is what stops a request that never finishes.
 */
export const HF_STEP_TIMEOUT_MS = 60_000;

/**
 * Wall-clock budget across every attempt, retries and sleeps included.
 *
 * The Hub answers 503 for a model that is loading and expects the caller to come back.
 * Two retries three seconds apart fit inside this; a third would put the total past what
 * an editor will wait through a spinner on a form they are about to lose.
 */
export const HF_TOTAL_TIMEOUT_MS = 150_000;

/**
 * How many times a cold model is re-asked for.
 *
 * Two, not one: the first 503 means "loading", and a single immediate retry lands inside
 * the same load and returns the same 503, which would turn a model that needs fifteen
 * seconds into a failure after five.
 */
export const HF_COLD_START_RETRIES = 2;

/** Gap before re-asking after a cold start. */
export const HF_RETRY_DELAY_MS = 3_000;

/** The slice of `fetch` this module uses, mirroring `FetchLike` in the fal queue. */
export type FetchLike = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
    signal?: AbortSignal;
  },
) => Promise<Response>;

export type HuggingFaceOptions = {
  fetchImpl: FetchLike;
  /** Sent as `Authorization: Bearer`. */
  token: string;
  /** The cover's bytes, exactly as they sit in `UPLOAD_DIR`. */
  image: Buffer;
  /** Overridable so a test does not spend real seconds on the cold-start path. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  stepTimeoutMs?: number;
  totalTimeoutMs?: number;
  coldStartRetries?: number;
  retryDelayMs?: number;
};

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The request URL for the configured model. */
export function modelUrl(model: string = HF_UPSCALE_MODEL): string {
  // The id is a path segment and must not be able to escape into another host.
  return `${HF_ROUTER_BASE}/hf-inference/models/${encodeURIComponent(model)}`;
}

/**
 * Whether a status means "come back later", as opposed to a real refusal.
 *
 * 503 for a loading model, and 429 for a busy one, are the two the Hub documents as worth
 * retrying. Everything else — 401, 404, 422 — is about the request itself and will fail
 * identically on the next attempt, so retrying it only spends the editor's time.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 503 || status === 429;
}

/**
 * Whether the answer is an image, by its magic bytes rather than by its Content-Type.
 *
 * The Hub answers a failed inference with JSON and *no* error status in some paths, and a
 * 200 carrying `{"error": "Model not loaded"}` would otherwise be written to `uploads/`
 * and served to readers as a broken cover. A file that is not a picture must never reach
 * the storage directory, and the only trustworthy test is the bytes themselves — the same
 * reason the manifest check reads the PNG header instead of trusting a declared size.
 */
export function sniffImageFormat(bytes: Uint8Array): "png" | "jpeg" | "webp" | null {
  if (bytes.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }

  return null;
}

/**
 * Runs one inference, retrying a cold model.
 *
 * Returns the image bytes. Throws `UpscaleError` with a stage the editor can act on:
 * `submit` for a key or request the provider refused, `wait` for a cold start that never
 * warmed up, `download` for a 200 that is not a picture.
 */
export async function runHuggingFaceUpscale(options: HuggingFaceOptions): Promise<Buffer> {
  const {
    fetchImpl,
    token,
    image,
    sleep = defaultSleep,
    now = Date.now,
    stepTimeoutMs = HF_STEP_TIMEOUT_MS,
    totalTimeoutMs = HF_TOTAL_TIMEOUT_MS,
    coldStartRetries = HF_COLD_START_RETRIES,
    retryDelayMs = HF_RETRY_DELAY_MS,
  } = options;

  const deadline = now() + totalTimeoutMs;
  const url = modelUrl();

  for (let attempt = 0; attempt <= coldStartRetries; attempt += 1) {
    if (attempt > 0) {
      /*
        Stop rather than sleep past the deadline. Without this the last retry starts after
        the total budget has already been spent, and a caller with a short budget waits
        longer than it agreed to — the retry loop would be the thing that overruns.
      */
      if (now() >= deadline) {
        throw new UpscaleError("истекло время ожидания", "wait");
      }
      await sleep(retryDelayMs);
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(image),
        signal: AbortSignal.timeout(stepTimeoutMs),
      });
    } catch (error) {
      if (isAbort(error)) {
        throw new UpscaleError(
          `превышено время ожидания (${Math.round(stepTimeoutMs / 1000)} с на попытку)`,
          "wait",
        );
      }
      throw new UpscaleError(transportReason(error), "submit");
    }

    if (response.ok) {
      /*
        Cloned *before* the body is read, and that ordering is load-bearing: `arrayBuffer()`
        consumes the stream, and a `clone()` afterwards throws "Body has already been
        consumed" — which turned the diagnostic path below into an unhandled TypeError and
        lost the provider's explanation entirely. The cheap body copy is taken up front so
        both readers have something to read.
      */
      const forDetail = response.clone();
      const bytes = new Uint8Array(await response.arrayBuffer());

      if (!sniffImageFormat(bytes)) {
        /*
          A 200 that is not an image. The provider reports some failures in the body of a
          success, so the status alone is not evidence the work was done — and writing this
          to the uploads directory would publish a broken cover under a 200.
        */
        const detail = await forDetail.text().catch(() => "");
        throw new UpscaleError(
          `провайдер вернул не изображение${detail ? ` (${readProviderDetail(detail)})` : ""}`,
          "download",
        );
      }

      return Buffer.from(bytes);
    }

    // Read the body once: it is a stream, and a second read would silently be empty.
    const detail = readProviderDetail(await response.text().catch(() => ""));

    if (isRetryableStatus(response.status) && attempt < coldStartRetries) {
      continue;
    }

    if (isRetryableStatus(response.status)) {
      throw new UpscaleError(
        `модель не прогрелась за ${Math.round(totalTimeoutMs / 1000)} с${detail ? ` (${detail})` : ""}`,
        "wait",
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new UpscaleError(
        "Hugging Face отклонил токен — проверьте его целиком в настройках",
        "submit",
      );
    }

    throw new UpscaleError(
      `${MODEL_LABEL} вернул ошибку ${response.status}${detail ? ` (${detail})` : ""}`,
      "submit",
    );
  }

  /* Unreachable: the loop either returns or throws. Present so the function is total. */
  throw new UpscaleError("истекло время ожидания", "wait");
}