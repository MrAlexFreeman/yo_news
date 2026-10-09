/**
 * The fal.ai queue protocol: submit, poll, collect.
 *
 * `fetch` is injected rather than reached for, which is the only reason this is a separate
 * module at all. The queue is the most fragile part of the upscale path — three round trips,
 * a status vocabulary, and a `COMPLETED` that does not mean the work succeeded — and none of it
 * could be tested while it lived inside a route that imports `server-only` and Prisma. Called
 * from a plain script it can be driven with a stubbed transport, including the cases that
 * matter most and cannot be arranged against the real service: a job that fails after the
 * queue says it finished, and one that never finishes at all.
 *
 * No credentials and no `server-only`: the key is a parameter, never read from anywhere.
 */

import {
  isAbort,
  readProviderDetail,
  readProviderError,
  readRequestId,
  readStatus,
  resultUrl,
  statusUrl,
  submitUrl,
  transportReason,
  UPSCALE_STEP_TIMEOUT_MS,
  UPSCALE_TIMEOUT_MS,
  UpscaleError,
} from "@/lib/image-upscale";

/** The slice of `fetch` this module uses. Narrow on purpose: it makes stubs trivial. */
export type FetchLike = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

export type FalQueueOptions = {
  fetchImpl: FetchLike;
  /** Passed as `Authorization: Key …`. */
  apiKey: string;
  /** The model's input object, built by `buildUpscaleInput`. */
  input: Record<string, unknown>;
  /** Wall-clock budget across submit *and* poll, not per attempt. */
  timeoutMs?: number;
  stepTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Injected so a test does not have to spend real seconds waiting. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reads a response body defensively: an error page is not always JSON. */
async function readBody(response: Response): Promise<string> {
  return response.text().catch(() => "");
}

/** Turns a transport or HTTP failure into a staged error, in one place. */
function asUpscaleError(
  error: unknown,
  stage: "submit" | "wait" | "download",
): UpscaleError {
  if (error instanceof UpscaleError) return error;
  return new UpscaleError(
    isAbort(error) ? "превышено время ожидания" : transportReason(error),
    stage,
  );
}

/**
 * Runs one job to completion and returns the model's result payload.
 *
 * The budget is wall-clock across the whole call. A per-attempt budget would let a request
 * poll for as long as the editor keeps the button spinning, which is the outcome the total
 * exists to prevent.
 */
export async function runFalQueue(options: FalQueueOptions): Promise<unknown> {
  const {
    fetchImpl,
    apiKey,
    input,
    timeoutMs = UPSCALE_TIMEOUT_MS,
    stepTimeoutMs = UPSCALE_STEP_TIMEOUT_MS,
    pollIntervalMs = 1_500,
    sleep = defaultSleep,
    now = Date.now,
  } = options;

  const deadline = now() + timeoutMs;
  const headers = {
    Authorization: `Key ${apiKey}`,
    "Content-Type": "application/json",
  };

  // ---- 1. Submit ----
  let submitted: unknown;
  try {
    const response = await fetchImpl(submitUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(stepTimeoutMs),
    });

    if (!response.ok) {
      // Read once. A body is a stream: calling `text()` twice here would hand the second
      // call an already-consumed stream and silently produce an empty detail.
      const detail = readProviderDetail(await readBody(response));
      throw new UpscaleError(
        `fal.ai вернул ошибку ${response.status}${detail ? ` (${detail})` : ""}`,
        "submit",
      );
    }

    submitted = await response.json();
  } catch (error) {
    throw asUpscaleError(error, "submit");
  }

  const requestId = readRequestId(submitted);
  if (!requestId) {
    throw new UpscaleError("fal.ai не вернул идентификатор задания", "submit");
  }

  // ---- 2. Poll ----
  let completed = false;

  while (now() < deadline) {
    await sleep(pollIntervalMs);

    let status: unknown;
    try {
      const response = await fetchImpl(statusUrl(requestId), {
        headers,
        signal: AbortSignal.timeout(stepTimeoutMs),
      });

      if (!response.ok) {
        throw new UpscaleError(`fal.ai вернул ошибку ${response.status}`, "wait");
      }

      status = await response.json();
    } catch (error) {
      throw asUpscaleError(error, "wait");
    }

    /*
      * A finished queue request is not a finished job. fal reports the failure on the status
      * itself, and reading the result instead would find no image in it and hand the editor
      * a success with nothing behind it.
    */
    if (readStatus(status) !== "COMPLETED") continue;

    const providerError = readProviderError(status);
    if (providerError) {
      throw new UpscaleError(providerError, "wait");
    }

    completed = true;
    break;
  }

  if (!completed) {
    throw new UpscaleError("истекло время ожидания", "wait");
  }

  // ---- 3. Result ----
  try {
    const response = await fetchImpl(resultUrl(requestId), {
      headers,
      signal: AbortSignal.timeout(stepTimeoutMs),
    });

    if (!response.ok) {
      throw new UpscaleError(`fal.ai вернул ошибку ${response.status}`, "download");
    }

    return await response.json();
  } catch (error) {
    throw asUpscaleError(error, "download");
  }
}