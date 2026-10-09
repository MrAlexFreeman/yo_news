/**
 * The FLUX models a cover may be generated with.
 *
 * Pure, and free of credentials, so the editorial suite can assert on the allowlist
 * without touching DeepInfra. Both entries were verified against the live API rather
 * than written from a brief, and the numbers below come from that measurement.
 */

/** The two models behind the selector. */
export type FluxModel = "flux-1-schnell" | "flux-2-klein-9b";

export type FluxModelSpec = {
  value: FluxModel;
  label: string;
  /**
   * The name without the parenthetical, for messages that have to read as a sentence:
   * "FLUX 2 Klein 9B не ответил за 30 секунд". The picker label carries a price/quality
   * note that has no place mid-sentence.
   */
  shortName: string;
  endpoint: string;
  steps: number;
  /**
   * Wall-clock budget for the image call.
   *
   * Deliberately not monotonic: klein-9b is the heavier model, yet it gets the
   * shorter budget. The 9b figure is the one the newsroom asked for, and it is ample
   * — a real generation on both models measures well under a second of inference on
   * DeepInfra's side. Schnell's existing 90 s budget is left alone rather than cut
   * to match, because lowering it could turn a slow cold start into a failure that
   * used to succeed.
   */
  timeoutMs: number;
};

const INFERENCE = "https://api.deepinfra.com/v1/inference/black-forest-labs";

export const FLUX_MODELS: readonly FluxModelSpec[] = [
  {
    value: "flux-1-schnell",
    label: "FLUX 1 Schnell (Быстрая, повседневная)",
    shortName: "FLUX 1 Schnell",
    endpoint: `${INFERENCE}/FLUX-1-schnell`,
    steps: 4,
    timeoutMs: 90_000,
  },
  {
    value: "flux-2-klein-9b",
    label: "FLUX 2 Klein 9B (Премиум, высокая детализация)",
    shortName: "FLUX 2 Klein 9B",
    endpoint: `${INFERENCE}/FLUX-2-klein-9b`,
    // klein-9b accepts num_inference_steps exactly as schnell does — verified by a
    // live call — so the same body serves both and the frame stays byte-identical.
    // Leaving the step count at 4 also keeps it the cheap option: DeepInfra reported
    // 0.00843 USD at 4 steps against 0.015 USD for the same model at its default
    // step count, so the knob is quality against cost, and 4 is the house default.
    steps: 4,
    timeoutMs: 30_000,
  },
];

/**
 * Schnell, the everyday default.
 *
 * Klein-9b measures about 7.5x dearer per image on the same frame (0.00843 against
 * 0.001125 USD), so it is opt-in rather than the default.
 */
export const DEFAULT_FLUX_MODEL: FluxModel = "flux-1-schnell";

export function isFluxModel(value: unknown): value is FluxModel {
  return FLUX_MODELS.some((model) => model.value === value);
}

/**
 * The allowlist lookup, with a fallback rather than a rejection.
 *
 * Same reasoning as the style picker: the field post-dates the client, so an editor
 * on a tab opened before the deploy sends nothing at all, and refusing that would
 * break a working button. An unrecognised value is treated as missing.
 */
export function resolveFluxModel(value: unknown): FluxModel {
  return isFluxModel(value) ? value : DEFAULT_FLUX_MODEL;
}

/** The full spec for a model, for the caller that builds the request. */
export function fluxModelSpec(value: unknown): FluxModelSpec {
  const model = resolveFluxModel(value);
  // Unreachable in practice: resolveFluxModel always returns a listed value.
  return FLUX_MODELS.find((entry) => entry.value === model)!;
}

/**
 * The body sent to DeepInfra.
 *
 * One shape for both models, deliberately. The brief offered `aspect_ratio` as an
 * alternative for the 9B, and it does work — but the same call measured 0.015 USD
 * against 0.00843 for this one, roughly twice the price for the same picture, and
 * it leaves the frame size up to the provider instead of fixed.
 *
 * 1024×576 rather than the 1200×675 from the brief: 675 is not a multiple of 16,
 * which is the constraint FLUX enforces on dimensions, and one frame size across both
 * models means one card layout on the site and one threshold to check against Dzen's
 * 700 px minimum. 1024 = 16×64 and 576 = 16×36, and 1024/576 is exactly 16:9.
 */
export function buildFluxBody(prompt: string, value: unknown): Record<string, unknown> {
  const spec = fluxModelSpec(value);
  return {
    prompt,
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    num_inference_steps: spec.steps,
  };
}

/** The pixel frame, restated here so this module has no imports at all. */
const COVER_WIDTH = 1024;
const COVER_HEIGHT = 576;

/**
 * A transport failure as the sentence the editor will read.
 *
 * This is the whole of the graceful-fallback requirement for the image step, and it lives
 * here — a module with no imports and no `server-only` — for two reasons. It sits next to
 * the models it talks about, so a message cannot name a budget that belongs to a different
 * entry; and it is callable from the test suite without standing up the cover pipeline,
 * which is what lets the real failure shape be asserted instead of approximated.
 *
 * Every message names the model. That is the one thing the editor can act on: switch back
 * to schnell, wait, or tell the hosting provider. A generic "не удалось сгенерировать"
 * names nothing and answers none of those.
 *
 * Before this existed, a timeout was not handled at all: `AbortSignal.timeout` rejects with
 * a `TimeoutError`, which is not an `AiCoverError`, so it fell through to the route's
 * catch-all and the panel showed a bare retry suggestion. The worst case was the premium
 * model, which an editor picks deliberately for a lead story — a silent 30-second timeout
 * there reads as "the picture failed", when what failed was the budget.
 */
export function fluxFailureMessage(spec: FluxModelSpec, error: unknown): string {
  if (isAbort(error)) {
    const seconds = Math.round(spec.timeoutMs / 1000);
    return (
      `${spec.shortName} не ответил за ${seconds} с — это таймаут на стороне провайдера. ` +
      `Попробуйте ещё раз или возьмите FLUX 1 Schnell.`
    );
  }

  return `Не удалось достучаться до DeepInfra для ${spec.shortName}: ${transportReason(error)}`;
}

/**
 * Whether a thrown value is the abort, by either spelling.
 *
 * `AbortSignal.timeout` rejects with a `TimeoutError`; a caller-supplied abort with an
 * `AbortError`. Both mean the same thing here — we stopped waiting — so both take the
 * timeout message rather than the transport one.
 */
function isAbort(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError";
}

/**
 * A network failure as one short clause.
 *
 * `fetch` only reports a reason on the failures worth naming (`ENOTFOUND`, `ECONNREFUSED`,
 * certificate errors), and those are passed through — they tell an editor whether to wait
 * or to call the provider. Everything else is Node's default "fetch failed", which is both
 * meaningless and untranslated, and it gets replaced rather than shown.
 *
 * Token-shaped runs are stripped for the same reason the upstream body is: a thrown
 * message can carry a request header.
 */
function transportReason(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  // The bare default, with or without the cause Node attaches to it. Nothing here is
  // actionable, so the wording is ours rather than the runtime's.
  if (!raw.trim() || /^(fetch failed|network error|load failed)$/i.test(raw.trim())) {
    return "сеть недоступна.";
  }

  const safe = raw.replace(/[A-Za-z0-9_-]{24,}/g, "…").trim();
  return safe && safe.length <= 120 ? safe : "сеть недоступна.";
}