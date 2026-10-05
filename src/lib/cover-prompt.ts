/**
 * Shared constants for AI cover generation.
 *
 * Deliberately free of credentials and of `server-only`, so the editorial test
 * suite can assert on them. The brief below is content, not configuration — and
 * the server enforces it on both input modes, so a custom hint cannot opt out of
 * the parts Dzen enforces.
 */

/**
 * Appended by us to every prompt immediately before it goes to FLUX.
 *
 * Applied in code rather than asked of DeepSeek. The previous version ended with
 * "End with exactly this, unmodified" in the user message, which relies on a text
 * model obeying an instruction about its own output — and when it does not, the
 * no-text rule silently disappears and Dzen later rejects the card. A suffix this
 * module appends cannot be forgotten by a model, dropped by a rewrite of the
 * prompt, or lost when the editor's own words are used.
 *
 * The negative half is the load-bearing part: text-to-image models reliably put
 * captions, watermarks and logos into generated images, and Dzen rejects an image
 * with rendered text on it.
 */
export const FLUX_POSTFIX =
  "editorial photography, 8k, sharp focus, clean composition, strictly no text, no letters, no watermark, no typography";

/**
 * Appends {@link FLUX_POSTFIX}, unless it is already the tail.
 *
 * Idempotent because DeepSeek sometimes ends its answer with wording close enough
 * to the postfix to be worth not repeating, and a doubled suffix is noise in the
 * prompt the editor is shown.
 */
export function applyFluxPostfix(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return trimmed;
  return trimmed.endsWith(FLUX_POSTFIX) ? trimmed : `${trimmed}, ${FLUX_POSTFIX}`;
}

/**
 * The system prompt for DeepSeek.
 *
 * Verbatim from the newsroom's spec, and deliberately blunt about text: the model
 * has to be told twice, once here and once in the postfix we append, because a
 * photograph of a news story invites exactly the signage, headlines and document
 * text that the postfix then has to suppress.
 *
 * Lives here rather than in ai-cover.ts so the test suite can assert on it — that
 * module is `server-only` and cannot be imported by a plain tsx script.
 */
export const DEEPSEEK_SYSTEM_PROMPT = [
  "You are an expert prompt engineer for FLUX image generator for an editorial news portal.",
  "Your task is to create a detailed, photorealistic prompt in English based on the news title, lead, and editor's guidance.",
  "CRITICAL RULES:",
  "1. ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO TYPOGRAPHY, NO WATERMARKS, NO RUSSIAN OR ENGLISH INSCRIPTIONS.",
  "2. Avoid elements that naturally contain text: do not describe street signs with text, newspapers, computer screens with code/words, document text, posters, or commercial logos. If cars or buildings are present, specify they have plain surfaces without inscriptions.",
  "3. Style: Editorial documentary news photography, realistic, natural lighting, high resolution, 16:9 aspect ratio.",
  "4. Output ONLY the raw English prompt string, without quotes, markdown formatting, or preamble.",
].join("\n");

/**
 * Longest editor-supplied hint before it stops being a hint.
 *
 * The hint is optional and now refines the story rather than replacing it, so it
 * needs to stay short: past a sentence or two it stops being a visual focus and
 * becomes a second prompt competing with the headline.
 */
export const AI_HINT_LIMIT = 600;

/** Headline length sent to the prompt model. */
export const AI_TITLE_LIMIT = 300;

/**
 * FLUX rejects dimensions that are not multiples of 16, and the news card wants
 * 16:9. 1024×576 is the smallest frame that satisfies both: 576 = 16×36 and
 * 1024/576 is exactly 16:9. 1024 px also sits comfortably above Dzen's 700 px
 * minimum for the card image, which the editor is warned about on manual uploads.
 */
export const COVER_WIDTH = 1024;
export const COVER_HEIGHT = 576;

/** FLUX-1-schnell is a 4-step distilled model; more steps buy nothing here. */
export const COVER_STEPS = 4;