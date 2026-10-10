"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Newspaper, Trash2 } from "lucide-react";

import {
  READ_ALSO_CLASS,
  parseReadAlsoMarker,
  readAlsoHref,
} from "@/lib/read-also";

/**
 * A "read also" plate placed by hand, as an opaque block.
 *
 * The same reason `VideoEmbed` exists: StarterKit knows nothing about
 * `<figure class="read-also">`, so an article carrying one would lose it the moment its
 * editor opened and saved — the store would treat the markup as unknown and drop it, and
 * nobody would notice until the plate had vanished from a published page. Keeping it as an
 * atom means the body round-trips.
 *
 * What is stored is an *identity*, not a copy of the plate: `renderHTML` emits a figure
 * wrapping a single link, and the public page looks the story up and renders the same
 * `ReadAlsoBlock` it uses for the automatic one. The editor is therefore shown the plate as
 * it will appear, including the live cover, and the page decides what is actually true at
 * render time. See `lib/read-also.ts` for why it is not the other way round.
 *
 * `atom: true` because a plate has no editable interior — an editor who wants to change the
 * headline changes the headline on the story, not on the plate.
 */

type ReadAlsoAttrs = {
  slug: string;
  title: string;
};

function attrsFromElement(element: HTMLElement): ReadAlsoAttrs | false {
  const marker = parseReadAlsoMarker(element.outerHTML);
  // Only a link to a story makes this a plate. A figure the editor pasted for its own sake
  // must stay ordinary markup rather than becoming a block with nothing behind it.
  return marker ? { slug: marker.slug, title: marker.title } : false;
}

function ReadAlsoView({ node, deleteNode, selected }: NodeViewProps) {
  const title = String(node.attrs.title ?? "");
  const slug = String(node.attrs.slug ?? "");

  return (
    <NodeViewWrapper
      as="figure"
      contentEditable={false}
      className={[
        "my-3 flex items-center gap-3 rounded border border-dashed px-3 py-2.5",
        selected
          ? "border-amber-500 bg-amber-50"
          : "border-neutral-300 bg-neutral-50 text-neutral-600",
      ].join(" ")}
    >
      <Newspaper className="size-4 shrink-0 text-amber-600" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold tracking-wider text-amber-700 uppercase">
          Читайте также
        </span>
        <span className="block truncate text-sm font-medium text-neutral-800">{title}</span>
        <span className="block truncate text-xs text-neutral-400">/news/{slug}</span>
      </span>
      <button
        type="button"
        onClick={deleteNode}
        className="inline-flex items-center gap-1 rounded-sm border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:border-red-400 hover:text-red-600"
      >
        <Trash2 className="size-3.5" aria-hidden />
        Убрать
      </button>
    </NodeViewWrapper>
  );
}

export const ReadAlsoBlockNode = Node.create({
  name: "readAlsoBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      slug: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        // The shape `buildReadAlsoHtml` emits, and the shape the sanitiser lets through:
        // `ALLOW_DATA_ATTR` is off here, so a data attribute would not survive and the
        // class is the only thing left to recognise the block by.
        tag: `figure.${READ_ALSO_CLASS}`,
        getAttrs: (element) => attrsFromElement(element as HTMLElement),
      },
    ];
  },

  renderHTML({ node }) {
    const slug = String(node.attrs.slug ?? "").trim();

    /*
      Built as a spec rather than a string: `renderHTML` returns what TipTap serialises
      straight into the body's HTML, and a content hole (`0`) would emit nothing at all —
      an atom has no content to put in it. So the anchor is spelled out here, sharing the
      escaping and the address builder with `buildReadAlsoHtml` so the two cannot drift.

      A figure with no link is emitted rather than nothing: an atom has to serialise to
      something, and an empty `<figure>` is dropped as unknown markup on the way back in,
      which is what happens to a plate whose slug was cleared.
    */
    return [
      "figure",
      mergeAttributes({ class: READ_ALSO_CLASS }),
      ["a", { href: readAlsoHref(slug) }, String(node.attrs.title ?? "")],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ReadAlsoView);
  },
});