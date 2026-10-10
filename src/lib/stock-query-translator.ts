import "server-only";

import { getSetting } from "@/lib/settings";
import {
  buildStockQueryUserMessage,
  parseStockQueryAnswer,
  STOCK_QUERY_SYSTEM_PROMPT,
} from "@/lib/stock-query";

/**
 * Asking DeepSeek for English stock-photo keywords.
 *
 * Server-only because it holds a key, and split from `lib/stock-query.ts` for the same
 * reason `lib/rewriter.ts` is split from `lib/rewrite-prompt.ts`: the prompt and the parser
 * are pure and testable, and this is the part that needs a credential and a network.
 *
 * Returns null rather than throwing, on purpose. This call sits on the way to a search, and
 * a search with a worse query still shows the editor photographs; a search with an error page
 * does not. Every failure — no key, no balance, a timeout, an answer that is not a list —
 * falls through to the caller's transliteration, which is worse at translation and always
 * available.
 */

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";

/**
 * Short, because the answer is two to four words.
 *
 * Sixty seconds is generous for that and still bounded: the editor is looking at an empty
 * search box, and a translation that has not come back in a minute is a translation that is
 * not going to be worth waiting for.
 */
const TIMEOUT_MS = 60_000;

/** Four keywords is well under this; the ceiling is on a runaway answer. */
const MAX_TOKENS = 60;

/**
 * Low. There is no variation to buy here — the same title should give the same keywords
 * every time, or the editor retunes a query that changes under them.
 */
const TEMPERATURE = 0.1;

export async function translateToStockQuery(text: string): Promise<string | null> {
  const apiKey = (await getSetting("DEEPSEEK_API_KEY")).trim();
  if (!apiKey) return null;

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
        messages: [
          { role: "system", content: STOCK_QUERY_SYSTEM_PROMPT },
          { role: "user", content: buildStockQueryUserMessage(text) },
        ],
      }),
    });
  } catch {
    // Timeout, DNS, TLS — all of it. The caller has a fallback and the editor has a search
    // box; neither of them needs this failure's details.
    return null;
  }

  // 401 (bad key) and 402 (no balance) are the same outcome here as a network failure:
  // no keywords, and a transliteration instead.
  if (!response.ok) return null;

  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
  } | null;

  return parseStockQueryAnswer(payload?.choices?.[0]?.message?.content);
}