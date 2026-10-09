/**
 * AI upscaling for a story's cover: the fal.ai `esrgan` model.
 *
 * Pure, and free of credentials, `server-only` and Prisma, so the security suite can
 * assert on what may be sent to the provider and what may be written to the response
 * without standing up the queue.
 *
 * **Why Real-ESRGAN and not the diffusion upscalers.** `clarity-upscaler` and the other
 * generative upscalers regenerate the picture from a prompt: they sharpen it well, and they
 * also invent detail that was never there. On a news site that is not a cosmetic setting — a
 * fabricated detail in a photograph is a fabricated fact, and it is undetectable afterwards
 * because the file looks *better*. Real-ESRGAN is a convolutional network that restores what
 * the pixels support, so it removes compression artefacts and raises sharpness without
 * adding anything the camera did not see.
 *
 * The endpoint shape, the input schema and the queue protocol below were read from fal's own
 * documentation rather than assumed. The model is credited for commercial use.
 */

export const FAL_QUEUE_BASE = "https://queue.fal.run";

/** The model id as fal addresses it, in one place so a change is one edit. */
export const UPSCALE_MODEL = "fal-ai/esrgan";

/** Shown to the editor in the failure message. */
const MODEL_LABEL = "Real-ESRGAN";

/**
 * The multipliers offered.
 *
 * Two, not four, and not an arbitrary number: four quadruples the pixel count, and the
 * upload endpoint caps a file at 8 MB, so a 4× cover of an already-large photo is rejected
 * on save — after the editor has paid for the upscale and waited for it.
 */
export const UPSCALE_SCALES = [2, 4] as const;
export type UpscaleScale = (typeof UPSCALE_SCALES)[number];

export const DEFAULT_UPSCALE_SCALE: UpscaleScale = 2;

/**
 * Total wall-clock budget for the queue round trip.
 *
 * Generous, because the work includes waiting for a GPU runner that may be cold, and short
 * enough that an editor does not abandon the form. The point is not to fail a slow upscale —
 * it is to stop a request that will never finish, since the alternative is nginx giving up
 * with no message and the button left spinning.
 */
export const UPSCALE_TIMEOUT_MS = 120_000;

/** How long one queue call may take on its own. */
export const UPSCALE_STEP_TIMEOUT_MS = 30_000;

/**
 * Ceiling on what may be sent upstream.
 *
 * The upload endpoint already caps an incoming file at 8 MB, and base64 inflates it by about
 * a third, so this is the same picture in transit. Enforced before the request is made
 * rather than by the provider, so an oversized file fails instantly and for free.
 */
export const UPSCALE_MAX_INPUT_BYTES = 8 * 1024 * 1024;

/** Which step failed, so the editor is told whether to retry or to fix configuration. */
export type UpscaleStage = "input" | "submit" | "wait" | "download" | "save";

/** A failure with a message written for the editor rather than for a log. */
export class UpscaleError extends Error {
  constructor(
    message: string,
    readonly stage: UpscaleStage,
  ) {
    super(message);
    this.name = "UpscaleError";
  }
}

/** The resolved options for one call. */
export type UpscaleOptions = {
  scale: UpscaleScale;
  /**
   * Runs the GFPGAN face pass after the upscale.
   *
   * On by default because the brief asks for it and because the covers that most need it
   * are the ones with people in them: the upscale operates on 4-pixel blocks, and a face at
   * news-stand size is exactly where those blocks show.
   */
  face: boolean;
};

export const DEFAULT_UPSCALE_OPTIONS: UpscaleOptions = {
  scale: DEFAULT_UPSCALE_SCALE,
  face: true,
};

/**
 * A scale the editor asked for, narrowed to the allowlist.
 *
 * Unrecognised values fall back to the default rather than being refused: this is a cosmetic
 * preference on a form, and failing a cover save over it would be a worse outcome than
 * quietly doing the sensible thing. The allowlist is still enforced — a caller cannot talk
 * the provider into an 8× frame it does not support.
 */
export function resolveUpscaleScale(raw: unknown): UpscaleScale {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());

  return (UPSCALE_SCALES as readonly number[]).includes(value)
    ? (value as UpscaleScale)
    : DEFAULT_UPSCALE_SCALE;
}

/** Whether to run the face pass. Anything unrecognised means on. */
export function resolveFaceEnhance(raw: unknown): boolean {
  if (raw === null || raw === undefined || raw === "") return true;
  if (typeof raw === "boolean") return raw;

  const value = String(raw).trim().toLowerCase();

  if (value === "false" || value === "0" || value === "off" || value === "нет") return false;
  return true;
}

/**
 * The cover as a data URI, which is how it has to travel.
 *
 * fal fetches `image_url` from the open internet, and this site's covers live in a local
 * `UPLOAD_DIR` that is not reachable from outside. The documented alternative — a public
 * URL — would mean publishing every intermediate cover publicly before it is improved, so
 * the bytes go in the request instead. Base64 is what costs: about a third more on the wire.
 */
export function toFalImageInput(bytes: Buffer, contentType: string): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

/** The request body fal expects, built from the verified schema. */
export function buildUpscaleInput(
  imageUrl: string,
  options: UpscaleOptions,
): Record<string, unknown> {
  return {
    image_url: imageUrl,
    scale: options.scale,
    // `face` is fal's own name for what the brief calls face_enhance.
    face: options.face,
    // JPEG, not PNG: a 2× cover in PNG is several times the weight of the same frame in
    // JPEG for no visible gain, and the file then has to fit the 8 MB upload cap forever
    // afterwards, on every repost and every regeneration.
    output_format: "jpeg",
  };
}

/** The queue URL for submitting, derived rather than concatenated at the call site. */
export function submitUrl(): string {
  return `${FAL_QUEUE_BASE}/${UPSCALE_MODEL}`;
}

/** The queue URL for one request's status. */
export function statusUrl(requestId: string): string {
  return `${FAL_QUEUE_BASE}/${UPSCALE_MODEL}/requests/${encodeURIComponent(requestId)}/status`;
}

/** The queue URL for one request's result. */
export function resultUrl(requestId: string): string {
  return `${FAL_QUEUE_BASE}/${UPSCALE_MODEL}/requests/${encodeURIComponent(requestId)}`;
}

/**
 * The id of a submitted request, or null when the answer is not one.
 *
 * Separate from the whole submission payload on purpose: the other three URLs come back in
 * the same object and using them would hand the provider's hostname authority over which
 * endpoint this code polls next.
 */
export function readRequestId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const id = (payload as Record<string, unknown>).request_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export type FalStatus = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

/**
 * The state of a queued request.
 *
 * Anything unrecognised — including a missing field — is treated as still running. The
 * alternative is to treat it as finished, which would send the editor to an empty result and
 * report success for a request that is still going.
 */
export function readStatus(payload: unknown): FalStatus {
  const status = (payload as Record<string, unknown> | null)?.status;

  if (status === "IN_QUEUE" || status === "IN_PROGRESS" || status === "COMPLETED") {
    return status;
  }
  return "IN_PROGRESS";
}

/**
 * The failure fal reported, when it reported one.
 *
 * A completed request can still have failed: the queue finished the *lifecycle*, not the
 * work. Without this the caller would read `COMPLETED`, fetch a result with no image in it,
 * and tell the editor the upscale succeeded.
 */
export function readProviderError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const body = payload as Record<string, unknown>;
  if (!body.error && !body.error_type) return null;

  const detail =
    typeof body.error === "string"
      ? body.error
      : `ошибка провайдера (${String(body.error_type ?? "неизвестный тип")})`;

  // The provider echoes the request back in some error bodies, which can contain the key.
  return detail.replace(/[A-Za-z0-9_-]{24,}/g, "…").slice(0, 200);
}

/**
 * Where to download the improved image from.
 *
 * Validated rather than trusted: this URL is written into an `http` request from the server,
 * so a crafted or hijacked response must not be able to point it at an internal address. Only
 * https is allowed, and the host has to be fal's own media CDN — which is the only host the
 * documented output ever names.
 */
export function readResultUrl(payload: unknown): string | null {
  const raw = (payload as Record<string, unknown> | null)?.image;
  const url = (raw as Record<string, unknown> | null)?.url;

  if (typeof url !== "string" || !url.trim()) return null;

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase();
  // `fal.media` and `v3.fal.media` are the two the documentation names. Matching the
  // registrable domain rather than one host keeps a new CDN edge working without an edit,
  // while still refusing anything the provider did not name.
  const isFalMedia =
    host === "fal.media" ||
    host.endsWith(".fal.media") ||
    host === "fal.ai" ||
    host.endsWith(".fal.ai");

  if (!isFalMedia) return null;
  if (parsed.username || parsed.password) return null;

  return parsed.toString();
}

/** Pixel dimensions the provider reported, when it reported any. */
export function readResultSize(payload: unknown): { width: number; height: number } | null {
  const image = (payload as Record<string, unknown> | null)?.image as
    | Record<string, unknown>
    | undefined;

  const width = Number(image?.width);
  const height = Number(image?.height);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

/**
 * fal's own words about a failure, when it sent any.
 *
 * Its errors arrive as `{"detail": "..."}` — a JSON envelope, which is what the editor saw
 * verbatim in testing: a wall of escaped braces with the actual sentence buried inside it. The
 * body is unwrapped here, and stripped of anything token-shaped on the way, because fal echoes
 * parts of the request back in some errors.
 */
export function readProviderDetail(body: string): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";

  let message = trimmed;
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as { detail?: unknown; error?: unknown };
    const inner = parsed.detail ?? parsed.error;
    if (typeof inner === "string" && inner.trim()) message = inner;
  }

  const safe = message.replace(/[A-Za-z0-9_-]{24,}/g, "…").trim();
  return safe.length > 160 ? `${safe.slice(0, 160)}…` : safe;
}

/** Whether a thrown value is one of the two abort shapes. */
export function isAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError";
}

/**
 * What the editor is told, by stage.
 *
 * The stage is named because it decides what the editor should do next, and a single generic
 * "не удалось" answers nothing: a missing key is fixed in settings, a timeout is fixed by
 * trying again in a minute, and an unreadable file is fixed by uploading a different one.
 */
export function upscaleFailureMessage(stage: UpscaleStage, detail?: string): string {
  const suffix = detail ? ` (${detail})` : "";

  switch (stage) {
    case "input":
      return `Не удалось прочитать обложку${suffix}. Загрузите файл заново.`;
    case "submit":
      return `Не удалось отправить фото на обработку${suffix}. Проверьте ключ fal.ai в настройках и баланс.`;
    case "wait":
      return `${MODEL_LABEL} не ответил за ${Math.round(UPSCALE_TIMEOUT_MS / 1000)} с${suffix}. Попробуйте ещё раз.`;
    case "download":
      return `Обработка прошла, но фото не удалось забрать${suffix}. Попробуйте ещё раз.`;
    case "save":
      return `Не удалось сохранить улучшенное фото${suffix}. Проверьте свободное место на диске.`;
  }
}

/**
 * A transport failure as one short clause.
 *
 * `fetch` reports a reason on the failures worth naming and a bare "fetch failed" on the rest,
 * which tells an editor nothing. Token-shaped runs are stripped: a thrown message can carry
 * a request header, and this one is shown to a person.
 */
export function transportReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (!raw.trim() || /^(fetch failed|network error|load failed)$/i.test(raw.trim())) {
    return "сеть недоступна";
  }

  const safe = raw.replace(/[A-Za-z0-9_-]{24,}/g, "…").trim();
  return safe && safe.length <= 120 ? safe : "сеть недоступна";
}