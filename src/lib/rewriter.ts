import "server-only";

import { getSetting } from "@/lib/settings";
import {
  REWRITE_SYSTEM_PROMPT,
  buildRewriteUserMessage,
  looksLikeHtml,
  parseRewriteResponse,
  type RewriteRequest,
  type RewriteResult,
} from "@/lib/rewrite-prompt";

/**
 * Rewriting a wire item into an article with DeepSeek.
 *
 * Server-only: it holds an API key. The prompt and the answer parser live in
 * rewrite-prompt.ts, which is pure and where the tests are.
 *
 * Uses the same key and the same provider as the cover generator, read through the
 * settings service rather than `process.env`, so a key pasted into /admin/settings
 * takes effect without a restart — the behaviour every other integration here has.
 */

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

/**
 * Rewriting is one call, but not a quick one: 3-5 paragraphs is around 700 tokens out.
 * The cover prompt asks for 40 words and gives up at 20 seconds; this needs longer, and
 * a timeout that fires mid-generation would waste the tokens already spent.
 */
const TIMEOUT_MS = 90_000;

/** Enough for five paragraphs and a headline, and a ceiling on a runaway answer. */
const MAX_TOKENS = 2000;

/**
 * Low, but not zero. The facts are fixed and the structure is prescribed; a higher
 * temperature only buys variety in the wording, at the cost of an occasional invented
 * detail, which is the one thing the prompt forbids.
 */
const TEMPERATURE = 0.3;

export class RewriteError extends Error {
  constructor(
    message: string,
    /** "config" is fixable by an operator, "provider" by waiting. */
    readonly kind: "config" | "provider" | "answer",
  ) {
    super(message);
    this.name = "RewriteError";
  }
}

/** The rewritten article, ready to be put into the editor. */
export type { RewriteResult, RewriteRequest };

export async function rewriteArticle(request: RewriteRequest): Promise<RewriteResult> {
  if (!request.rawText.trim() && !request.title.trim()) {
    throw new RewriteError(
      "Нечего переписывать: нет ни заголовка, ни текста источника.",
      "config",
    );
  }

  const apiKey = await getSetting("DEEPSEEK_API_KEY");
  if (!apiKey) {
    throw new RewriteError(
      "Не задан DEEPSEEK_API_KEY. Укажите его в разделе «Настройки» (/admin/settings) или в .env — без него рерайт не работает.",
      "config",
    );
  }

  let response: Response;
  try {
    response = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        // Without this the model is free to answer with a fenced block or a sentence of
        // commentary; the parser copes, but asking is cheaper than coping.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: REWRITE_SYSTEM_PROMPT },
          { role: "user", content: buildRewriteUserMessage(request) },
        ],
      }),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new RewriteError(
      timedOut
        ? "DeepSeek не ответил за 90 секунд. Попробуйте ещё раз."
        : `Не удалось обратиться к DeepSeek: ${
            error instanceof Error ? error.message : "сетевая ошибка"
          }`,
      "provider",
    );
  }

  if (!response.ok) {
    // 401/402/403 are the editor's problem to fix in settings; the rest are transient.
    const kind = response.status === 401 || response.status === 402 ? "config" : "provider";
    throw new RewriteError(
      response.status === 402
        ? "DeepSeek отклонил запрос: на счету недостаточно средств."
        : `DeepSeek вернул ошибку ${response.status}. Проверьте ключ DEEPSEEK_API_KEY и баланс.`,
      kind,
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new RewriteError("DeepSeek вернул пустой ответ. Попробуйте ещё раз.", "answer");
  }

  const result = parseRewriteResponse(content);
  if (!result) {
    throw new RewriteError(
      "DeepSeek вернул ответ, из которого не удалось собрать статью. Попробуйте ещё раз.",
      "answer",
    );
  }

  // The model is asked for HTML paragraphs and usually gives them; when it answers with
  // a wall of prose, the paragraphs are rebuilt by the same normaliser the editor uses,
  // rather than stored as one line.
  return {
    ...result,
    contentHtml: looksLikeHtml(result.contentHtml)
      ? result.contentHtml
      : result.contentHtml
          .split(/\n{2,}/)
          .map((paragraph) => `<p>${escapeText(paragraph.trim())}</p>`)
          .filter((paragraph) => paragraph !== "<p></p>")
          .join(""),
  };
}

/**
 * Escapes text being wrapped in a paragraph.
 *
 * Only reached on the prose fallback, and only for the model's own words — but the
 * output goes into the article body and then into an editor, so a `<` in it must not
 * become markup on the way.
 */
function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
