/**
 * Shared constants for AI cover generation.
 *
 * Deliberately free of credentials and of `server-only`, so the editorial test
 * suite can assert on them. What is here is content and an allowlist, not
 * configuration — and the server enforces both the style allowlist and the no-text
 * rules, so neither an editor nor a stale client can talk the image model into
 * rendering lettering on a card that Dzen will then refuse.
 */

/**
 * Appended by us to every prompt immediately before it goes to FLUX.
 *
 * Applied in code rather than asked of DeepSeek. An earlier version ended with
 * "End with exactly this, unmodified" in the user message, which relies on a text
 * model obeying an instruction about its own output — and when it does not, the
 * no-text rule silently disappears and Dzen later rejects the card. A suffix this
 * module appends cannot be forgotten by a model, dropped by a rewrite of the
 * prompt, or lost when the editor's own words are used.
 *
 * Style-neutral on purpose. The previous version opened with "editorial
 * photography", which fought the three non-photographic styles: asking for an oil
 * painting and then appending "editorial photography, 8k" gave FLUX two
 * conflicting instructions and the picture came out halfway between them. The look
 * now comes solely from the chosen style directive.
 *
 * The negative half is the load-bearing part: text-to-image models reliably put
 * captions, watermarks and logos into generated images, and Dzen rejects an image
 * with rendered text on it. `16:9` is stated here because FLUX is given explicit
 * pixel dimensions anyway, but repeating the ratio in the prompt keeps the framing
 * right if a model crops.
 */
export const FLUX_POSTFIX =
  "clean composition, strictly no text, no letters, no watermark, no typography, 16:9 aspect ratio";

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

/** The four looks a cover may be generated in. */
export type CoverStyle = "realistic" | "illustration" | "sketch" | "painting";

/**
 * The style allowlist, in the order the editor sees it.
 *
 * The `directive` is pasted into the DeepSeek system prompt verbatim, so it is
 * never built from request input: `resolveCoverStyle` picks one of these objects
 * or falls back to the default, and a string that is not in this table never
 * reaches the prompt. That is what keeps a crafted `style` from smuggling
 * instructions of its own into the system prompt.
 */
export const COVER_STYLES: readonly {
  value: CoverStyle;
  label: string;
  directive: string;
}[] = [
  {
    value: "realistic",
    label: "Реалистичность (ультрафотореализм)",
    directive:
      "editorial documentary news photography, authentic ultra-photorealistic, shot on 35mm f/1.8 lens, natural lighting, high dynamic range, raw photo, masterwork",
  },
  {
    value: "illustration",
    label: "Иллюстрация",
    directive:
      "modern editorial digital illustration, clean graphic design, rich vector shapes, elegant editorial magazine art",
  },
  {
    value: "sketch",
    label: "Рисунок",
    directive:
      "detailed pencil and ink architectural sketch, refined cross-hatching line art, vintage graphic drawing",
  },
  {
    value: "painting",
    label: "Картина",
    directive:
      "classic oil painting on textured canvas, visible expressive impasto brushstrokes, dramatic fine art composition",
  },
];

/**
 * Photography, the look a news portal defaults to.
 *
 * Named rather than taken as `COVER_STYLES[0]` so the default is visible at the
 * point of use, and so reordering the list for the UI cannot silently change what
 * an editor gets when they never touch the select.
 */
export const DEFAULT_COVER_STYLE: CoverStyle = "realistic";

export function isCoverStyle(value: unknown): value is CoverStyle {
  return COVER_STYLES.some((style) => style.value === value);
}

/**
 * The allowlist lookup, with a fallback rather than a rejection.
 *
 * A missing or unknown style resolves to the default rather than 400: the field
 * was added after the client shipped, so an editor with a stale tab open sends no
 * `style` at all. Refusing that would break a working button over a cosmetic
 * preference. Unknown values are treated exactly like a missing one.
 */
export function resolveCoverStyle(value: unknown): CoverStyle {
  return isCoverStyle(value) ? value : DEFAULT_COVER_STYLE;
}

/** The directive for a style, for tests and for callers holding a bare value. */
export function styleDirective(value: unknown): string {
  const style = COVER_STYLES.find((entry) => entry.value === resolveCoverStyle(value));
  // Unreachable in practice: resolveCoverStyle always returns a listed value.
  return style?.directive ?? "";
}

/**
 * The system prompt for DeepSeek, for one chosen style.
 *
 * A function rather than a constant because the style directive has to be named
 * explicitly. Relying on DeepSeek to infer the look from the story is what made the
 * old prompt drift: it asked for "photorealistic" in the preamble and then appended
 * a suffix, and nothing tied the two together.
 *
 * Deliberately blunt about text, and blunt twice over — here and in the postfix we
 * append — because a news story invites exactly the signage, headlines and document
 * text that Dzen refuses on the finished card.
 *
 * Lives here rather than in ai-cover.ts so the test suite can assert on it: that
 * module is `server-only` and cannot be imported by a plain tsx script.
 */
export function buildDeepseekSystemPrompt(value: unknown): string {
  const style = resolveCoverStyle(value);

  return [
    "You are an expert prompt engineer for the FLUX image generation model.",
    "Your task is to generate a single detailed English prompt for an editorial cover based on the news title, lead, optional editor hint, and the chosen visual STYLE.",
    "",
    "STYLE DIRECTIVES:",
    ...COVER_STYLES.map(
      (entry) => `- ${entry.value}: "${entry.directive}".`,
    ),
    "",
    `The chosen STYLE is "${style}". Write the prompt in that style, and no other.`,
    "",
    "CRITICAL NEGATIVE RULES (STRICT):",
    "- ABSOLUTELY NO TEXT, NO LETTERS, NO WORDS, NO WATERMARKS, NO RUSSIAN OR ENGLISH CHARACTERS, NO LABELS, NO TYPOGRAPHY.",
    "- Avoid signage, newspapers, screens, road sign text, banners, and logos.",
    "- Combine the news context with the editor's hint (if provided, treat hint as the visual focus).",
    "- Return ONLY the raw English prompt string, without quotes or markdown formatting.",
  ].join("\n");
}

/**
 * Longest editor-supplied hint before it stops being a hint.
 *
 * The hint is optional and refines the story rather than replacing it, so it needs
 * to stay short: past a sentence or two it stops being a visual focus and becomes
 * a second prompt competing with the headline.
 */
export const AI_HINT_LIMIT = 600;

/** Headline length sent to the prompt model. */
export const AI_TITLE_LIMIT = 300;

/**
 * The editor's hint, from either field name.
 *
 * `customPrompt` is current; `prompt` is the name the request used before the
 * style picker landed. A tab that was open across that deploy still sends the old
 * name, and without this the hint would be dropped silently — the editor would get
 * a generic cover and no indication why. The current name wins when both arrive.
 *
 * Pure and exported so the precedence is asserted directly: the alternative was an
 * HTTP test, and the hint has no effect on validation, so such a test could not
 * tell "alias read" from "alias ignored" without spending provider credit.
 */
export function pickHint(customPrompt: unknown, legacyPrompt?: unknown): string {
  const current = typeof customPrompt === "string" ? customPrompt.trim() : "";
  if (current) return current.slice(0, AI_HINT_LIMIT);

  const legacy = typeof legacyPrompt === "string" ? legacyPrompt.trim() : "";
  return legacy.slice(0, AI_HINT_LIMIT);
}

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