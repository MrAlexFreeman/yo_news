/**
 * Shared constants for AI cover generation.
 *
 * Deliberately free of credentials and of `server-only`, so the editorial test
 * suite can assert on them. What is here is content and an allowlist, not
 * configuration — and the server enforces the style allowlist and strips
 * lettering-triggering words, so neither an editor nor a stale client can talk the
 * image model into drawing a caption on a card that Dzen will then refuse.
 */

/**
 * Appended by us to every prompt immediately before it goes to FLUX.
 *
 * Positive descriptors only, and that is the whole point of the rewrite. The
 * previous version ended with "strictly no text, no letters, no watermark, no
 * typography" — and FLUX has no mechanism for negation. A diffusion model matches
 * the tokens it is given; naming a thing it should not draw is a reliable way to
 * get it drawn. Every version of this suffix that listed forbidden objects made the
 * problem worse, and the editors saw exactly that: gibberish lettering on shop
 * signs and plaques in covers that were otherwise fine.
 *
 * So nothing here is a prohibition. The no-text guarantee is carried by two other
 * means, neither of which puts a forbidden noun in front of FLUX:
 *
 *   1. the DeepSeek system prompt, which tells the *text* model to avoid such
 *      subjects and to compose around them — negations are fine there, because
 *      DeepSeek reads instructions rather than matching tokens;
 *   2. {@link sanitizeFluxPrompt}, which removes the trigger nouns from the final
 *      English prompt in code.
 *
 * What is left in the suffix is what actually helps: a shallow depth of field so
 * the background is out of focus and has nothing legible to carry, bokeh instead of
 * detail, and a clean frame.
 */
export const FLUX_POSTFIX =
  "shallow depth of field, heavily blurred background, soft cinematic bokeh, minimalist clean composition, 35mm photograph, 16:9";

/**
 * Appends {@link FLUX_POSTFIX}, unless it is already the tail.
 *
 * Idempotent so a repeated call cannot stack the suffix twice in the prompt the
 * editor is shown.
 */
export function applyFluxPostfix(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return trimmed;
  return trimmed.endsWith(FLUX_POSTFIX) ? trimmed : `${trimmed}, ${FLUX_POSTFIX}`;
}

/**
 * Whole phrases removed together, so no qualifier survives its head noun.
 *
 * Without these, deleting "sign" alone turned "road sign" into "road", which is
 * still a road — and a road is still somewhere FLUX puts a sign.
 */
const SIGN_PHRASES =
  /\b(?:road signs?|street signs?|traffic signs?|warning signs?|warning sign|signage|shop windows?|market stalls?|gas stations?|construction barriers?|police tape|road barriers?|license plates?|licence plates?)\b/gi;

/**
 * Scenes that invite lettering, removed as a backstop for the same reason the
 * subject nouns are: DeepSeek is told not to use them, and told again, and still
 * reaches for one.
 *
 * "market stall" rather than a bare "market": a bare "market" is load-bearing
 * vocabulary in financial news, and cutting it out of "stock market crash" leaves
 * a worse prompt than the one we were trying to protect.
 */
const SCENE_TRIGGERS =
  /\b(?:malls?|shopping cent(?:er|re)s?|retail|stores?|supermarkets?|storefronts?|shopfronts?)\b/gi;

/**
 * Warning vocabulary, which exists to sit on a board.
 *
 * Same reasoning applied to the adjectives: a warning sign is drawn because
 * something in the scene is a warning, so the adjectives go with the noun.
 */
const WARNING_WORDS = /\b(?:warning|caution|danger|stop|alert)\b/gi;

/** Objects that carry writing. */
const SIGNAGE_OBJECTS =
  /\b(?:signs?|billboards?|banners?|posters?|placards?|plaques?|notices?|nameplates?|badges?|labels?|newspapers?|documents?|papers?|screens?)\b/gi;

/**
 * Bare references to lettering, not to a physical object.
 *
 * Added beyond the newsroom's list: swapping or deleting the noun does not remove
 * what the model wrote on it, and "sign reading SALE" survives either way.
 * Word boundaries keep "texture", "textile" and "context" intact.
 */
const WORDING_TRIGGERS =
  /\b(?:text|texts|letters?|lettering|words?|wording|typography|inscriptions?|captions?|glyphs?)\b/gi;

/**
 * Runs of capital letters: the attempt at lettering itself.
 *
 * Image prompts are otherwise lower case, so an all-caps run carries no
 * descriptive information and only tells FLUX to draw a word.
 */
const CAPS_LETTERING = /\b[A-Z]{2,}\b/g;

/**
 * Removes what makes FLUX draw lettering and signage, from the final prompt.
 *
 * Everything is cut rather than substituted. That reverses an earlier version of
 * this function, which replaced "sign" with "facade" — and measurement showed the
 * substitution was making the problem worse, not neutral: a blank facade is an
 * invitation to letter, so the model filled the empty wall with gibberish exactly
 * where the word had been removed. Removing the subject leaves nothing to fill.
 *
 * The cut is to a space rather than to an empty string, so "a sign in the street"
 * becomes "a in the street" and not "ain the street".
 *
 * Run on the assembled prompt — postfix included — so what FLUX receives is
 * provably free of the triggers and the guarantee does not depend on the postfix
 * happening to be clean.
 */
export function sanitizeFluxPrompt(prompt: string): string {
  return prompt
    .replace(SIGN_PHRASES, " ")
    .replace(SCENE_TRIGGERS, " ")
    .replace(WARNING_WORDS, " ")
    .replace(SIGNAGE_OBJECTS, " ")
    .replace(WORDING_TRIGGERS, " ")
    .replace(CAPS_LETTERING, " ")
    // Tidy what the cuts leave behind: doubled spaces, a space before a comma or a
    // full stop, an empty pair of commas, and an article left dangling at the very
    // end of a clause.
    //
    // Deliberately narrow. An earlier version also stripped a leading "a"/"the" from
    // the whole prompt, which turned "a shopper's hands holding coins" into
    // "shopper's hands holding coins" — it was tidying the cuts and mangling every
    // well-formed prompt at the same time. "a entrance at dusk" reads badly to a
    // person and costs FLUX nothing.
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/\(\s*\)/g, "")
    .replace(/\b(a|an|the)\s+(?=[,.;]|$)/gi, "")
    .trim();
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
 * Rewritten around a measured failure: covers kept coming back with fake lettering
 * on shop signs, plaques and notices. The cause was asking for it twice — once here
 * and once in the suffix appended to FLUX — because diffusion models have no notion
 * of negation, so every forbidden noun was also a subject to draw.
 *
 * The negative rules therefore live *here* and nowhere else. DeepSeek reads
 * instructions, so "do not include signs" costs nothing when written to it; the same
 * sentence handed to FLUX would be a request. What reaches FLUX is positive
 * description plus {@link sanitizeFluxPrompt}.
 *
 * The composition rules do the real work. Telling the model to frame a court as
 * "a courthouse" is what produces a building with a plaque; telling it to use a
 * gavel in close-up, or an empty bench, produces an image with nothing to write on.
 *
 * Lives here rather than in ai-cover.ts so the test suite can assert on it: that
 * module is `server-only` and cannot be imported by a plain tsx script.
 */
export function buildDeepseekSystemPrompt(value: unknown): string {
  const style = resolveCoverStyle(value);

  return [
    "You generate prompts for the FLUX image model.",
    "IMPORTANT LESSON: FLUX cannot render text and tries to write gibberish on any sign, board, plaque, or storefront.",
    "",
    "STYLE DIRECTIVES:",
    ...COVER_STYLES.map((entry) => `- ${entry.value}: "${entry.directive}".`),
    `Use the "${style}" style, and no other.`,
    "",
    "MANDATORY COMPOSITION RULES:",
    "1. DO NOT include any signs, nameplates, road signs, building signs, store signs, notices, papers, badges, or screens.",
    "2. DO NOT frame scenes around building facades with storefronts.",
    "3. ALWAYS use cinematic photography techniques to prevent sharp background details:",
    '   - "shallow depth of field, f/1.8 aperture, blurry out-of-focus background, bokeh"',
    "   - Focus on close-up details, objects, hands, vehicles from angles where plates are hidden, nature, silhouettes, or atmospheric environment.",
    "4. Focus on capturing the MOOD and METAPHOR of the news rather than literal institutions. (e.g., for court: gavel close-up or empty wooden bench; for city hall: architectural columns without plaques; for traffic: blurred headlights in rain).",
    "",
    "FORBIDDEN SCENES. Never describe these, even when the news is about them:",
    "   - mall, shopping center, retail, store, supermarket, shop window, storefront, market stall, gas station, construction barrier, police tape, road barrier.",
    "   - Any warning vocabulary at all: warning, caution, danger, stop, alert.",
    "These subjects pull lettering into the frame no matter how the rest of the prompt is written, so they are excluded from the composition entirely.",
    "",
    "NEVER frame a wide angle of human environments. Prefer macro photography, extreme close-ups of objects, ground-level shots, silhouette angles, or natural landscapes without man-made boards.",
    "",
    "METAPHOR LIBRARY. When the news belongs to one of these themes, describe the listed image instead of the literal event:",
    "   - Retail, prices, trade: a shopping trolley seen close-up; a shelf of unlabelled vegetables and fruit; a shopper's hands holding coins or a paper bag.",
    "   - Danger, forest, quarry, environment: pine crowns against an overcast sky; a tyre tread mark in mud; a sandy quarry slope; thick fog between trees.",
    "   - Incidents, utilities, transport: wet asphalt reflecting street lamps; the silhouette of utility machinery at dusk; a bend in an empty snow-covered road; steam rising from ice.",
    "   - Power, courts, decisions: classical architectural columns in bokeh; a wooden council table; an empty chamber in soft light.",
    "Pick one metaphor and stay close to it. Do not name the news event itself in the prompt.",
    "",
    "5. Output ONLY the English prompt string, without any preamble or quotes.",
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