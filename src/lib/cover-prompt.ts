/**
 * Shared constants for AI cover generation.
 *
 * Deliberately free of credentials and of `server-only`, so the editorial test
 * suite can assert on them. The brief below is content, not configuration — and
 * the server enforces it on both input modes, so a custom hint cannot opt out of
 * the parts Dzen enforces.
 */

/**
 * The photography brief appended to every prompt.
 *
 * Taken verbatim from the newsroom's spec. The negative half matters more than it
 * looks: text-to-image models reliably put captions, watermarks and logos into
 * generated images, and Dzen rejects an image with rendered text on it — so the
 * exclusions are doing real work rather than adding flavour.
 */
export const PHOTO_STYLE_SUFFIX =
  "editorial photography, realistic daylight, high resolution, 16:9 aspect ratio, strictly no text, no captions, no logos, no collage";

/** Longest editor-supplied hint before it stops being a hint. */
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