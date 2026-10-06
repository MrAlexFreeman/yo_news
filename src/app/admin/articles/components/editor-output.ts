import type { Editor } from "@tiptap/core";

/**
 * The HTML the editor hands to the form, and therefore to the database.
 *
 * Not `editor.getHTML()`. TipTap's trailing-node behaviour appends an empty
 * paragraph so there is always somewhere to put the caret below the last block —
 * which is right for editing and wrong for storage. Every article saved through
 * the editor would grow a stray `<p></p>`, and since the body is what the Dzen feed
 * and the search index read, that artefact would spread further than the editor.
 *
 * Stripped only at the very end, and only while the paragraphs are empty, so
 * anything the author actually wrote is untouched. An empty body comes back as an
 * empty string, which is what the schema's length check expects.
 */
export function editorBodyHtml(editor: Editor): string {
  return editor.getHTML().replace(/(?:<p><\/p>)+$/, "");
}