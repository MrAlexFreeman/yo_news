import "server-only";

import {
  AI_TITLE_LIMIT,
  COVER_HEIGHT,
  COVER_STEPS,
  COVER_WIDTH,
  applyFluxPostfix,
  buildDeepseekSystemPrompt,
  resolveCoverStyle,
  type CoverStyle,
} from "@/lib/cover-prompt";
import { extractImageBytes } from "@/lib/deepinfra-response";
import { getSetting } from "@/lib/settings";

/**
 * Re-exported so the route imports every cover constant from one place. The
 * definitions live in cover-prompt.ts because the test suite cannot import this
 * module: `server-only` throws outside a React Server Component, which is the
 * guard working as intended.
 */
export { AI_HINT_LIMIT, AI_TITLE_LIMIT } from "@/lib/cover-prompt";
export type { CoverStyle } from "@/lib/cover-prompt";

/**
 * AI cover generation: DeepSeek turns a Russian story into an English
 * photography prompt, DeepInfra's FLUX-1-schnell turns that prompt into a picture.
 *
 * Server-only because it holds two API keys and writes files to disk. Nothing in
 * here is reachable from the browser except through /api/admin/generate-cover,
 * which is behind Basic Auth.
 *
 * FLUX-1-schnell rather than the full model specifically because it is a 4-step
 * distilled model: the editorial desk wants a usable cover in a few seconds, not
 * a better one in a minute.
 */

/** Two calls, two providers, one clear error for the editor. */
export class AiCoverError extends Error {
  constructor(
    message: string,
    /** Which step failed, so the editor knows whether to retry or fix config. */
    readonly stage: "prompt" | "image" | "save",
  ) {
    super(message);
    this.name = "AiCoverError";
  }
}

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const DEEPINFRA_URL =
  "https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-1-schnell";

/**
 * Timeouts. The text step is quick and a hang means something is wrong upstream;
 * the image step gets longer because a cold FLUX worker really can take a while.
 * Without these a stalled provider would hold the request until nginx gives up
 * and leave the editor staring at a spinner.
 */
const PROMPT_TIMEOUT_MS = 20_000;
const IMAGE_TIMEOUT_MS = 90_000;

/**
 * FLUX happily produces multi-megabyte base64. A cap keeps a runaway response
 * from filling the 709 MB box's heap on the way to being discarded.
 */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;

/** How much of the article is worth sending. */
const SOURCE_CHAR_LIMIT = 6000;

/** Kept as an alias so callers can keep importing MAX_TITLE_LENGTH. */
const MAX_TITLE_LENGTH = AI_TITLE_LIMIT;

/** Re-exported for the route handler. */
export { MAX_TITLE_LENGTH };

/**
 * Reads an API key through the settings service, not `process.env`.
 *
 * This is what makes a key saved in /admin/settings take effect immediately: the
 * lookup happens per request, so a paste followed by a reload needs no pm2
 * restart. Reading the environment directly here would pin the value at module
 * load and quietly ignore anything the editor just saved.
 */
async function requireKey(name: "DEEPSEEK_API_KEY" | "DEEPINFRA_API_KEY"): Promise<string> {
  const value = await getSetting(name);
  if (!value) {
    throw new AiCoverError(
      `Не задан ${name}. Укажите его в разделе «Настройки» (/admin/settings) или в .env — без него генерация обложек не работает.`,
      "prompt",
    );
  }
  return value;
}

/**
 * Builds the English image prompt from the story, the editor's hint and the style.
 *
 * All of title, lead and hint go to DeepSeek together rather than one standing in
 * for another. The original design had two mutually exclusive modes: without a hint
 * the model saw only the story, and with a hint it saw only the hint and the story
 * was discarded. That made a hint a replacement rather than a refinement, so an
 * editor who wrote "крупный план светофора" got a traffic light and no longer got
 * the news it belonged to.
 *
 * The style is resolved through the allowlist before it reaches the system prompt,
 * so a crafted value cannot become an instruction of its own.
 *
 * The lead and title carry the news; the body is included but trimmed, because a
 * 4000-character article produces a prompt that names six unrelated scenes and
 * generates a collage — the one thing the system prompt forbids.
 */
export async function buildPhotoPrompt(source: {
  title?: string;
  lead?: string;
  content?: string;
  hint?: string;
  style?: string;
}): Promise<string> {
  const title = (source.title ?? "").trim().slice(0, MAX_TITLE_LENGTH);
  const lead = (source.lead ?? "").trim();
  const content = (source.content ?? "")
    .trim()
    .slice(0, SOURCE_CHAR_LIMIT);
  const hint = (source.hint ?? "").trim();
  const style: CoverStyle = resolveCoverStyle(source.style);

  if (!title && !lead && !content && !hint) {
    throw new AiCoverError(
      "Нечего описать: добавьте заголовок, лид или текст материала.",
      "prompt",
    );
  }

  const apiKey = await requireKey("DEEPSEEK_API_KEY");

  const material = [
    title && `Headline: ${title}`,
    lead && `Summary: ${lead}`,
    content && `Body:\n${content}`,
    hint &&
      `Editor's hint (treat as the visual focus, while keeping the overall ` +
      `context of the story above): ${hint}`,
    `Chosen style: ${style}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(PROMPT_TIMEOUT_MS),
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0.4,
      max_tokens: 120,
      messages: [
        { role: "system", content: buildDeepseekSystemPrompt(style) },
        {
          role: "user",
          content:
            "Turn this news story into one concise English prompt for an " +
            "editorial cover in the chosen style. Describe a single scene that " +
            "shows the subject, and nothing that would need invented detail. " +
            "Maximum 40 words. Output only the prompt.\n\n" +
            material,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new AiCoverError(
      `DeepSeek вернул ошибку ${response.status}. Проверьте ключ DEEPSEEK_API_KEY и баланс.`,
      "prompt",
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const prompt = payload.choices?.[0]?.message?.content?.trim();

  if (!prompt) {
    throw new AiCoverError(
      "DeepSeek вернул пустой промпт. Попробуйте ещё раз или уточните тему.",
      "prompt",
    );
  }

  // Models like to wrap the answer in quotes or add a label; the image model is
  // happier with the bare prompt.
  return prompt.replace(/^["'`]+|["'`]+$/g, "").slice(0, 800);
}

/**
 * Renders the image and returns its raw bytes plus the prompt actually sent.
 *
 * The style postfix is applied here rather than at the call site because this is
 * the last point before FLUX: anywhere earlier, a future caller could reasonably
 * decide it had already handled the style and skip it. The returned prompt is the
 * post-fixed one so the log line and the editor-facing preview both show what the
 * image model was really given, postfix included.
 *
 * FLUX-1-schnell answers with base64 PNG. The format is whatever the upstream
 * sends — the caller decides what to store after inspecting the bytes.
 */
export async function renderCover(prompt: string): Promise<{ bytes: Buffer; prompt: string }> {
  const apiKey = await requireKey("DEEPINFRA_API_KEY");

  const finalPrompt = applyFluxPostfix(prompt);

  const response = await fetch(DEEPINFRA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    body: JSON.stringify({
      prompt: finalPrompt,
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      num_inference_steps: COVER_STEPS,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new AiCoverError(
      `DeepInfra вернул ошибку ${response.status}${summarise(detail)}. Проверьте ключ DEEPINFRA_API_KEY и баланс.`,
      "image",
    );
  }

  const text = await response.text();
  if (text.length > MAX_IMAGE_BYTES) {
    throw new AiCoverError("Изображение от модели слишком большое.", "image");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new AiCoverError("DeepInfra вернул не-JSON ответ.", "image");
  }

  const image = extractImageBytes(payload);
  if (!image) {
    throw new AiCoverError(
      "DeepInfra не вернул изображение в ответе. Попробуйте другой промпт.",
      "image",
    );
  }

  if (image.length > MAX_IMAGE_BYTES) {
    throw new AiCoverError("Изображение от модели слишком большое.", "image");
  }

  return { bytes: image, prompt: finalPrompt };
}

/** Upstream errors are logged, not shown: they can echo the request key. */
function summarise(body: string): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  // Never surface more than a short hint, and never anything token-shaped.
  const safe = trimmed.replace(/[A-Za-z0-9_-]{24,}/g, "…");
  return safe.length > 160 ? ` (${safe.slice(0, 160)}…)` : ` (${safe})`;
}

/** The trimmed prompt, for logging and for showing the editor what was sent. */
export function describePrompt(prompt: string): string {
  return prompt.length > 200 ? `${prompt.slice(0, 200)}…` : prompt;
}