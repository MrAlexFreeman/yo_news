/**
 * The markup of a photo inside an article body, and the classes it carries.
 *
 * Pure — no TipTap, no DOM — so the same strings can be asserted in the check suite
 * without standing up an editor, and so the sidebar can append a figure to the body
 * when the editor is not on screen. The editor's own node imports these constants
 * rather than repeating them: a class that exists in two places is a class that
 * disagrees with itself the first time one of them is edited.
 */

/** Class the figure carries into the database, and the hook the stylesheet uses. */
export const FIGURE_CLASS = "article-figure";

/** Class on the caption element. */
export const FIGURE_CAPTION_CLASS = "article-figure__caption";

/**
 * Escapes a value for an HTML attribute or a text node.
 *
 * Both contexts, one function: the set that matters in an attribute (`"`, `'`) and the
 * set that matters in text (`<`, `>`, `&`) is the union, and escaping all five in both
 * places is never wrong. A caption is written by a journalist and a src comes from the
 * server today, but the caption is the one that will eventually be pasted from a wire
 * feed.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * One figure, as the editor stores it.
 *
 * The caption element is always emitted, even when empty — the same decision the
 * editor's insertion makes, and for the same reason: an empty `<figcaption>` is the
 * only place to click to write an attribution later, and leaving it out means the
 * only way to add one is to delete the photo and start again.
 */
export function figureHtml(src: string, caption: string): string {
  const trimmed = caption.trim();
  return [
    `<figure class="${FIGURE_CLASS}">`,
    `<img src="${escapeHtml(src.trim())}" alt="${escapeHtml(trimmed)}">`,
    `<figcaption class="${FIGURE_CAPTION_CLASS}">${escapeHtml(trimmed)}</figcaption>`,
    `</figure>`,
  ].join("");
}

/**
 * The body with a figure added at the end.
 *
 * Used when the editor is not mounted — the writer is on another tab of the form — and
 * there is no caret to insert at. Appending to the stored HTML is the honest answer
 * there: the alternative is switching tabs, mounting the editor and inserting at
 * position zero, which puts the picture above the headline paragraph and looks like a
 * bug.
 */
export function appendFigureHtml(html: string, src: string, caption: string): string {
  const trimmed = html.trim();
  const figure = figureHtml(src, caption);
  return trimmed.length > 0 ? `${trimmed}${figure}` : figure;
}
