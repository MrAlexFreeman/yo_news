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

  /*
    Where the line goes: at the end of the quotation, not at the caret.

    Two measurable failures led here.

    The first version inserted at the selection range, which *replaces* whatever is
    selected. Pressing «Цитата» and then «Источник цитаты» — the obvious order — left the
    quotation's own text destroyed and only the attribution behind it, because the
    selection was still the range the quote was made from. Found in the browser pass,
    not by a unit test: every check called the function with a bare caret.

    The second version inserted at the caret and then had to go and find where the
    inserted paragraph had landed, because `insertContent` at a text position splits the
    paragraph and leaves the selection in the remainder. Appending at the end of the
    enclosing blockquote removes the search: the position is known before the call, and
    the attribution belongs last by definition — it is a signature under the quotation,
    not an interruption in the middle of it.
  */
  const { $from } = editor.state.selection;

  let quoteDepth = -1;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "blockquote") {
      quoteDepth = depth;
      break;
    }
  }
  if (quoteDepth === -1) return false;

  // Just inside the closing token of the blockquote, i.e. after its last child.
  const endOfQuote = $from.after(quoteDepth) - 1;

  editor
    .chain()
    .focus()
    .insertContentAt(endOfQuote, {
      type: "paragraph",
      content: [{ type: "text", marks: [{ type: "cite" }], text: QUOTE_SOURCE_PREFIX }],
    })
    .run();

  // The caret has to end up after the dash, inside the new paragraph, or the writer's
  // next characters land somewhere else entirely.
  const { doc } = editor.state;

  let caret = -1;
  doc.descendants((node, pos) => {
    if (caret !== -1) return false;
    if (node.type.name !== "paragraph" || pos + node.nodeSize - 1 < endOfQuote) return true;

    let cited = false;
    node.descendants((child) => {
      if (child.isText && child.marks.some((mark) => mark.type.name === "cite")) {
        cited = true;
        return false;
      }
      return true;
    });

    if (cited) {
      caret = pos + node.nodeSize - 1;
      return false;
    }
    return true;
  });

  if (caret !== -1) editor.commands.setTextSelection(caret);

  return true;
}

/** The dash a citation line opens with. */
export const QUOTE_SOURCE_PREFIX = "— ";

/** The editor type, imported rather than restated so it cannot drift from TipTap's. */
export type QuoteEditor = import("@tiptap/core").Editor;
