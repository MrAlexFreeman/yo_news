import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * The source line of a quotation, as `<cite>`.
 *
 * A mark rather than a block node, and that is a correctness decision rather than a
 * stylistic one. `<cite>` is *phrasing content* — the HTML spec puts it inside a
 * paragraph, never beside one — so a block-level `cite` node would be invalid markup
 * and, more practically, ProseMirror cannot hold one node type in both an inline and
 * a block position.
 *
 * What the editor's own rendering did before this existed, measured: a stored
 * `<cite class="block …">— Источник</cite>` was rewritten to `<p>— Источник</p>`
 * the first time the article was opened, because the blockquote's content model is
 * blocks and an unknown inline element has nowhere to go. The source survived as
 * text and lost its meaning, silently, on the next save.
 *
 * With a mark, the paragraph keeps its `<p>` and the attribution inside it stays a
 * `<cite>` — valid HTML, and the styling hangs off the element rather than off a
 * `display: block` applied to an inline tag.
 */

/** Class every citation carries, and the hook the stylesheet uses. */
export const QUOTE_SOURCE_CLASS = "article-quote__source";

export const Cite = Mark.create({
  name: "cite",

  parseHTML() {
    return [{ tag: "cite" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["cite", mergeAttributes(HTMLAttributes, { class: QUOTE_SOURCE_CLASS }), 0];
  },
});

/**
 * Adds an attribution line to the quotation the caret is in.
 *
 * Returns false when the caret is not inside a `<blockquote>`, so the caller can say
 * so rather than dropping a paragraph into the middle of an ordinary one. The caller
 * decides how to report it; this module does not own a message.
 *
 * The em dash is part of the inserted text rather than a CSS `::before`, so it is
 * there in the database and in every consumer that renders the body — including the
 * messenger text, which never sees the stylesheet.
 */
export function insertQuoteSourceAtCaret(editor: QuoteEditor): boolean {
  if (!editor.isActive("blockquote")) return false;

  const { from, to } = editor.state.selection;

  editor
    .chain()
    .focus()
    .insertContentAt(
      { from, to },
      {
        type: "paragraph",
        content: [{ type: "text", marks: [{ type: "cite" }], text: QUOTE_SOURCE_PREFIX }],
      },
    )
    .run();

  /*
    The caret has to be moved to the end of the line just inserted.

    `insertContent` at a text position splits the paragraph and leaves the selection in
    the *remainder*, not in the inserted block — so typing carried on in the middle of
    the quotation and the attribution stayed empty. Measured: with the caret in "Цит|ата."
    the source line appeared correctly and the next characters landed in "…ата.",
    outside the `<cite>` and after the split.
  */
  const { doc } = editor.state;

  let end = -1;
  doc.descendants((node, pos) => {
    if (end !== -1) return false;
    if (node.type.name !== "paragraph" || pos + node.nodeSize - 1 < to) return true;

    let cited = false;
    node.descendants((child) => {
      if (child.isText && child.marks.some((mark) => mark.type.name === "cite")) {
        cited = true;
        return false;
      }
      return true;
    });

    if (cited) {
      end = pos + node.nodeSize - 1;
      return false;
    }
    return true;
  });

  if (end !== -1) editor.commands.setTextSelection(end);

  return true;
}

/** The dash a citation line opens with. */
export const QUOTE_SOURCE_PREFIX = "— ";

/** The editor type, imported rather than restated so it cannot drift from TipTap's. */
export type QuoteEditor = import("@tiptap/core").Editor;
