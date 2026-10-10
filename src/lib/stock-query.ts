/**
 * Turning a Russian newsroom phrase into English stock-photo keywords.
 *
 * Pure — no key, no `server-only`, no network — so the prompt, the answer parser and the
 * fallback are all directly assertable. The call itself lives in
 * `lib/stock-query-translator.ts`, beside the other DeepSeek callers, for the same reason
 * `lib/rewriter.ts` sits apart from `lib/rewrite-prompt.ts`.
 *
 * **Why this exists at all.** Unsplash indexes English alt-text written by photographers,
 * and a search for «экологический парк» matches almost nothing: measured on the key this
 * project uses, a Russian query returns single digits where the same idea in English
 * returns thousands. That is a language gap, not a spelling one — which is why the fallback
 * below is a last resort and says so, rather than pretending a transliteration closes it.
 */

import { TITLE_STOP_WORDS } from "@/lib/unsplash";

/** How many keywords the prompt asks for, and the ceiling this module enforces on the answer. */
export const STOCK_QUERY_KEYWORDS = 4;

/** The longest query Unsplash is asked for; longer phrases match worse, not better. */
export const STOCK_QUERY_MAX = 120;

/**
 * The prompt.
 *
 * Asks for keywords rather than a sentence because Unsplash is a keyword matcher: a
 * translated headline is one long phrase that matches nothing, while `autumn forest lake`
 * matches photographs. "Visual" and "concrete" are there because the model otherwise
 * reaches for what the story is *about* («депутаты обсудили бюджет» → «politics budget»)
 * rather than what a camera could have photographed.
 */
export const STOCK_QUERY_SYSTEM_PROMPT = [
  "Extract 2-4 concrete English visual search keywords for an Unsplash stock photo query",
  "from this Russian news title/text.",
  "Output ONLY comma-separated English keywords, no markdown, no quotes, no explanation.",
].join(" ");

/** The user's phrase, as the one message after the system prompt. */
export function buildStockQueryUserMessage(text: string): string {
  const trimmed = text.trim().slice(0, 600);
  return `Input: ${trimmed}`;
}

/** True when the text contains a Cyrillic letter, which is what triggers the translator. */
export function containsCyrillic(text: string): boolean {
  return /[\p{Script=Cyrillic}]/u.test(text);
}

/**
 * The words worth carrying into a search, from a Russian phrase.
 *
 * Shared with `keywordsFromTitle`, which seeds the search box: this is the same decision
 * about which words describe a picture, so it is the same list and the same order. A
 * transliteration of «Открыли Yandex и Сбербанк» that kept «открыли» would put a verb into a
 * query where a photographer is being looked for.
 */
function visualWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !TITLE_STOP_WORDS.has(word));
}

/**
 * Cleans the model's answer into something Unsplash can be sent.
 *
 * The prompt asks for bare comma-separated keywords, and a model that mostly complies
 * still returns a fenced block, a leading "Keywords:", stray quotes or a trailing period on
 * the last word. Every one of those turns a good query into a bad one, and Unsplash answers
 * a bad query with an empty list rather than an error — so the failure would be invisible
 * and would look like "Unsplash has no photos of this".
 *
 * Returns null when nothing usable is left, so the caller can fall back deliberately rather
 * than search for the empty string.
 */
export function parseStockQueryAnswer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  let text = raw.trim();
  if (!text) return null;

  // ```json … ``` or ``` … ``` around the whole answer.
  text = text.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();

  // A leading label, which is the most common way the instruction is not followed.
  text = text.replace(/^\s*(keywords?|ключевые слова|слова)\s*[:\-—]\s*/i, "").trim();

  const keywords = text
    .split(/[,;\n]+/)
    .map((part) =>
      part
        // Quotes and brackets, wherever they are.
        .replace(/["'`«»“”\[\]()]/g, "")
        // A trailing full stop on the last word only; a dot inside is not a separator here
        // because the split above has already run.
        .replace(/\.$/, "")
        .replace(/\s+/g, " ")
        .trim()
        // One word, or two joined by a hyphen. Longer than that is a phrase the model
        // failed to split, and Unsplash would treat the whole thing as one term.
        .slice(0, 40)
        .trim(),
    )
    // A Latin-only query is the whole point; a leftover Cyrillic keyword means the model
    // did not translate that one, and it would match nothing.
    .filter((keyword) => keyword.length > 1 && /^[A-Za-z0-9][A-Za-z0-9 '-]*$/.test(keyword));

  const unique = [...new Set(keywords.map((keyword) => keyword.toLowerCase()))]
    .slice(0, STOCK_QUERY_KEYWORDS)
    .map((keyword) => keyword.replace(/\b\w/g, (char) => char.toUpperCase()));

  return unique.length > 0 ? unique.join(", ") : null;
}

/**
 * Cyrillic → Latin, for the fallback.
 *
 * Deliberately small and mechanical. A full transliteration would produce something that
 * looks English and is not — «экологический» becomes `ekologicheskiy`, which matches no
 * photograph anywhere. What this can actually rescue is a title with a place name or a
 * Latin token in it, and that is all it is for.
 */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * The query to use when the model is unavailable.
 *
 * Latin words pass through and Cyrillic is transliterated, **both kept**. An earlier version
 * returned Latin words if there were any and stopped there, which quietly dropped
 * «Сбербанк» from «Открыли Yandex и Сбербанк» because «yandex» was already there — and a
 * proper noun is the single most useful thing this can find, since it is the one word in a
 * headline that a photographer may actually have photographed.
 *
 * Pure digits are dropped: "2024" is not a visual keyword, and a headline whose only Latin
 * content is a year has nothing for this to offer. Returns null in that case, which the
 * caller turns into "type something" rather than a search that returns nothing for a
 * reason nobody can see.
 */
export function fallbackStockQuery(text: string): string | null {
  const keywords = visualWords(text)
    .map((word) => {
      if (/^[a-z][a-z-]*$/.test(word)) return word;
      // Transliterated rather than dropped, so a Cyrillic proper noun survives next to a
      // Latin one instead of losing to it.
      const transliterated = [...word]
        .map((char) => (TRANSLIT[char] ?? ""))
        .join("");
      // A pure-digit word transliterates to nothing: TRANSLIT has no entry for "2", so the
      // lookup yields "" and the character is dropped. That is what excludes "2024" — not
      // the guard below, which is already false by the time it runs.
      return /^[a-z][a-z-]*$/.test(transliterated) ? transliterated : "";
    })
    .filter((word) => word.length > 2);

  const unique = [...new Set(keywords)].slice(0, STOCK_QUERY_KEYWORDS);

  return unique.length > 0 ? unique.join(", ").slice(0, STOCK_QUERY_MAX) : null;
}

/** Where a prepared query came from, so the UI can say which happened. */
export type StockQuerySource = "deepseek" | "fallback" | "as-entered";

export type PreparedStockQuery = {
  /** What to send to Unsplash. */
  query: string;
  /** Which path produced it. */
  source: StockQuerySource;
  /** Set when the input was Russian and needed work, whatever the path. */
  translated: boolean;
};

/**
 * Decides what to search for, without calling anything.
 *
 * The whole rule in one place: Latin goes through untouched, Cyrillic goes to the
 * translator, and anything that comes back unusable falls back. `as-entered` is the common
 * case and deliberately does no work at all — an editor who typed `autumn forest` should
 * not have a model rewrite it.
 */
export function prepareStockQuery(
  text: string,
  translate: (value: string) => Promise<string | null>,
): Promise<PreparedStockQuery> {
  const trimmed = text.trim();

  if (!trimmed) {
    return Promise.resolve({ query: "", source: "as-entered", translated: false });
  }

  if (!containsCyrillic(trimmed)) {
    return Promise.resolve({
      query: trimmed.slice(0, STOCK_QUERY_MAX),
      source: "as-entered",
      translated: false,
    });
  }

  return translate(trimmed).then((answer) => {
    if (answer) {
      return { query: answer, source: "deepseek" as const, translated: true };
    }

    const fallback = fallbackStockQuery(trimmed);
    return {
      // No fallback at all means there was nothing to search for; the raw Russian is
      // returned rather than an empty query, because a Russian phrase does sometimes
      // match, and an empty one definitely does not.
      query: fallback ?? trimmed.slice(0, STOCK_QUERY_MAX),
      source: "fallback" as const,
      translated: true,
    };
  });
}