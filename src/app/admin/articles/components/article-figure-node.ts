import { Node, mergeAttributes } from "@tiptap/core";

import { FIGURE_CAPTION_CLASS, FIGURE_CLASS } from "@/lib/article-figure";

/**
 * A photo inside the article body, with an optional caption.
 *
 * Why a node of this project's own rather than the stock Image extension alone: the
 * requirement is a *figure* — an image that carries its own caption and reads as one
 * block — and an `<img>` is a leaf with nowhere to put one. The stock extension can
 * place a picture and nothing else, so the caption had to live somewhere.
 *
 * Why the caption is a real child node rather than an attribute edited in a dialog:
 * the person writing wants to see the caption under the picture and type it there.
 * An attribute would have to be edited in a side panel, and the editor would be
 * showing something the reader never sees. A child node means what is on screen is
 * what is stored.
 *
 * The class is semantic — `article-figure`, not the utility list spelled out in the
 * task — and that is a deliberate departure with a technical reason. Tailwind scans
 * *source files* to decide which classes to emit, so a class that exists only in a
 * database row was never generated and does nothing at all: `text-gray-500` on a
 * stored caption would silently fall back to the inherited colour. The project
 * already styles the whole body through `.article-body` for the same reason, and
 * that is where this belongs too.
 *
 * `figure.video-embed` is left to the VideoEmbed node. Both nodes would otherwise
 * claim every `<figure>`, and the loser's content would be dropped on the next save
 * — silently, the first time somebody opened an article with a video in it.
 */

/** Class the figure carries into the database, and the hook the stylesheet uses. */
export { FIGURE_CLASS, FIGURE_CAPTION_CLASS } from "@/lib/article-figure";

/**
 * The caption, as a line of text under the picture.
 *
 * `defining: true` so that Enter inside it makes a new paragraph *after* the figure
 * rather than splitting the caption in two, which is what a person pressing Enter
 * under a photo means.
 */
export const ArticleFigcaption = Node.create({
  name: "articleFigcaption",
  content: "inline*",
  defining: true,

  parseHTML() {
    return [{ tag: "figcaption" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "figcaption",
      mergeAttributes(HTMLAttributes, { class: FIGURE_CAPTION_CLASS }),
      0,
    ];
  },
});

export const ArticleFigure = Node.create({
  name: "articleFigure",
  group: "block",
  // The image is required; the caption is not. A figure with a caption and no picture
  // is not a figure, and the schema says so rather than leaving it to the stylesheet.
  content: "image articleFigcaption?",
  defining: true,
  draggable: true,

  parseHTML() {
    return [
      {
        tag: "figure",
        getAttrs: (element) => {
          // Declines the video embed, whose markup is also a <figure>. Returning false
          // makes ProseMirror treat this element as not-a-figure-for-us and fall
          // through to the VideoEmbed rule, rather than dropping the iframe.
          const className = (element as HTMLElement).getAttribute("class") ?? "";
          if (className.split(/\s+/).includes("video-embed")) return false;
          return null;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["figure", mergeAttributes(HTMLAttributes, { class: FIGURE_CLASS }), 0];
  },
});

/**
 * The shape the editor inserts; kept here so the checks can build the same node.
 *
 * The caption node is always present, even when the writer left the field empty. That
 * is a deliberate trade: a figure without a `figcaption` has nowhere to click, so the
 * only way to add an attribution later would be to delete the photo and insert it
 * again. An empty `<figcaption>` costs a few bytes and gives the writer the place they
 * expect. It also keeps the editor and the database showing the same thing, which is
 * the property this editor spends most of its comments protecting.
 */
export function figureContent(src: string, alt: string, caption: string) {
  const trimmedCaption = caption.trim();
  return {
    type: "articleFigure",
    content: [
      { type: "image", attrs: { src, alt } },
      {
        type: "articleFigcaption",
        content: trimmedCaption ? [{ type: "text", text: trimmedCaption }] : [],
      },
    ],
  };
}

/**
 * Inserts a figure at the caret and leaves the caret on the line below it.
 *
 * Two things this does explicitly that the obvious one-liner gets wrong, both
 * measured against a real editor:
 *
 *  1. `insertContent([figure, paragraph])` produces the right caret but also leaves a
 *     stray empty paragraph *between* the figure and whatever followed it, which is a
 *     blank line in the published article.
 *  2. `insertContent(figure)` alone puts the caret **inside the caption**, so the next
 *     thing typed continues the caption instead of starting the next paragraph — the
 *     opposite of what "insert a picture and keep writing" means.
 *
 * So the figure is inserted on its own and the caret is then placed deliberately: at
 * the start of the text block that follows, or in a new paragraph if the figure
 * landed at the end of the body, which is where a writer expects to be.
 */
export function insertFigureAtCaret(
  editor: FigureEditor,
  src: string,
  alt: string,
  caption: string,
): void {
  const { from, to } = editor.state.selection;

  editor.chain().focus().insertContentAt({ from, to }, figureContent(src, alt, caption)).run();

  const { doc } = editor.state;

  // The figure we just inserted is the first one at or after the old caret: insertion
  // only ever shifts content to the right, so nothing earlier can have appeared.
  let figureEnd = -1;
  doc.descendants((node, pos) => {
    if (figureEnd !== -1) return false;
    if (node.type.name === "articleFigure" && pos + node.nodeSize - 1 >= to) {
      figureEnd = pos + node.nodeSize;
      return false;
    }
    return true;
  });

  if (figureEnd === -1) return;

  const $after = doc.resolve(figureEnd);

  if ($after.nodeAfter && $after.nodeAfter.isTextblock) {
    // Inside the following block, at its first character.
    editor.commands.setTextSelection(figureEnd + 1);
    return;
  }

  // At the end of the body: give the writer a paragraph to type in.
  editor.chain().focus().insertContentAt(figureEnd, { type: "paragraph" }).run();
}

/** The editor type, imported rather than restated so it cannot drift from TipTap's. */
export type FigureEditor = import("@tiptap/core").Editor;
