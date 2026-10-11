"use client";

import { Mark, mergeAttributes } from "@tiptap/core";

import { ENTITY_LINK_CLASS, ENTITY_HREF_PREFIXES, entityHref, slugFromEntityHref } from "@/lib/entity-card";

/**
 * A card reference, as a mark over the words that name the thing.
 *
 * The same reason `VideoEmbed` exists: StarterKit knows nothing about a link to a card,
 * so an article containing one would render it as an ordinary link the moment the body
 * left the editor — no dashed underline, no popover, and an editor with no way to tell
 * that a reference was there at all.
 *
 * It is a **mark**, not a node, because it wraps the words the editor had selected rather
 * than replacing them: the reader must still see the name as it was written. Stored as
 * the ordinary `<a href="/wiki/…">` the mark emits, so there is exactly one
 * representation of a card in the database and on the site.
 *
 * No node view. Marks in TipTap are rendered through `renderHTML`, and a node view would
 * put a React component around inline characters — which breaks the editor's own text
 * handling at exactly the point where a writer is typing. What is lost by not having one
 * is the little "remove reference" button; the toolbar button is a toggle instead, so the
 * same action is one click away and needs no component inside the text.
 */

type CardAttrs = {
  slug: string;
  title: string;
};

export const EntityCardLink = Mark.create({
  name: "entityCardLink",

  /*
    `inclusive: false` for the same reason the Link extension is configured that way in
    `editor-extensions.ts`: with the default, a mark swallows whatever is typed at its
    trailing edge, so finishing a word after a card reference would silently extend it.
    Measured there on links, and the cause is identical.
  */
  inclusive: false,

  addAttributes() {
    return {
      slug: { default: null },
      title: { default: null },
    };
  },

  /*
    Parsed back out of the stored anchor, and only when the href really is a card's
    address. Without the second condition every ordinary link in the article would be
    taken for a card. `slugFromEntityHref` is the same function the sanitiser and the
    popover use, so the three cannot disagree about what an entity link is.
  */
  parseHTML() {
    return [
      {
        /*
          Both prefixes, as a selector list.

          A body written before the address moved carries `/entities/<slug>`, and opening
          such an article in the editor has to recognise those links as cards — otherwise
          they would come back as ordinary links, and the mark that makes the card a card
          would be lost on the next save. The selector is only the cheap first pass;
          `slugFromEntityHref` below is the real test, and it is the same function the
          sanitiser and the popover use, so the three cannot disagree.
        */
        tag: ENTITY_HREF_PREFIXES.map((prefix) => `a[href^="${prefix}"]`).join(", "),
        getAttrs: (element: Element | string) => {
          const anchor = element as HTMLElement;
          const slug = slugFromEntityHref(anchor.getAttribute("href"));
          if (!slug) return false;
          return { slug, title: anchor.textContent ?? slug };
        },
      },
    ];
  },

  /*
    `href` is re-derived from the slug rather than trusted from the attribute, so a body
    carrying a hand-written `/wiki/<something else>` cannot end up with the label of one
    card and the destination of another.

    The class is written here only so the editor draws the dashed underline while the
    editor is typing; the sanitiser replaces it on every render, and is the authority on
    what a card link looks like.
  */
  renderHTML({ HTMLAttributes }) {
    const slug = String(HTMLAttributes.slug ?? "");
    const title = String(HTMLAttributes.title ?? slug);

    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        href: entityHref(slug),
        class: ENTITY_LINK_CLASS,
        title: `Карточка объекта: ${title}`,
      }),
      0,
    ];
  },

  addCommands() {
    return {
      /** Applies the card to the current selection, or removes it if already applied. */
      toggleEntityCard:
        (attrs: CardAttrs) =>
        ({ state, commands }) => {
          /*
            Read off the document rather than through an extension helper, because
            `CommandProps` carries no `mark`. `rangeHasMark` is the same test ProseMirror
            itself uses, and it is scoped to the selection so a card elsewhere in the
            story cannot make this one look applied.
          */
          const type = state.schema.marks[this.name];
          const { from, to } = state.selection;
          const applied =
            type !== undefined && from !== to && state.doc.rangeHasMark(from, to, type);

          return applied
            ? commands.unsetMark(this.name)
            : commands.setMark(this.name, attrs);
        },
    };
  },
});

/*
 * The command on the chain.
 *
 * Declared rather than cast at the call site: without this the toolbar's
 * `.toggleEntityCard(…)` does not typecheck, and the tempting fix is an `as any` where the
 * real problem — an undeclared command — is that the command was never registered.
 */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    entityCardLink: {
      /** True when the selection already carries this card. */
      toggleEntityCard: (attrs: CardAttrs) => ReturnType;
    };
  }
}