"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { PlayCircle, Trash2 } from "lucide-react";

import { VIDEO_EMBED_ALLOW, isAllowedVideoEmbed } from "@/lib/video-embed";

/**
 * A pasted video, as an opaque block rather than live markup.
 *
 * This node exists to stop TipTap deleting video. StarterKit knows nothing about
 * `<figure class="video-embed"><iframe>`, so an article with an embed would lose
 * it the moment its editor opened and saved — the store would call the iframe
 * markup a parse error and drop it, and nobody would notice until the video was
 * gone from a published page. Keeping it as an atom means the body round-trips.
 *
 * What the editor *shows* is a placeholder rather than the iframe, so the page
 * does not load a YouTube player while someone is still writing around it.
 * `renderHTML` is what gets stored, and it emits exactly what `buildVideoEmbed`
 * would have produced — one representation of an embed, in the database and on
 * the site.
 */

type VideoAttrs = {
  src: string;
  title: string;
  allow: string;
  referrerpolicy: string;
};

/**
 * Reads the iframe out of pasted markup, or refuses it.
 *
 * Returning false makes ProseMirror treat the element as not-a-node, so the paste
 * falls through to whatever handles it instead of becoming an editor frame. That
 * guard is the same host allowlist the sanitiser applies at render time; refusing
 * here as well means an arbitrary third-party page is never loaded into the admin
 * origin, which sanitising the stored HTML alone would not achieve.
 */
function attrsFromElement(element: HTMLElement): VideoAttrs | false {
  const src = element.getAttribute("src");
  if (!src || !isAllowedVideoEmbed(src)) return false;

  return {
    src,
    title: element.getAttribute("title") ?? "Видео",
    allow: element.getAttribute("allow") ?? VIDEO_EMBED_ALLOW,
    referrerpolicy:
      element.getAttribute("referrerpolicy") ?? "strict-origin-when-cross-origin",
  };
}

function VideoEmbedView({ node, deleteNode, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper
      as="figure"
      data-video-embed=""
      className="my-3"
      contentEditable={false}
    >
      <div
        className={[
          "flex flex-wrap items-center gap-2 rounded border border-dashed px-3 py-2.5 text-sm",
          selected
            ? "border-amber-500 bg-amber-50"
            : "border-neutral-300 bg-neutral-50 text-neutral-600",
        ].join(" ")}
      >
        <PlayCircle className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {String(node.attrs.src)}
        </span>
        <button
          type="button"
          onClick={deleteNode}
          className="inline-flex items-center gap-1 rounded-sm border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:border-red-400 hover:text-red-600"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Убрать
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export const VideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: "Видео" },
      allow: { default: VIDEO_EMBED_ALLOW },
      referrerpolicy: { default: "strict-origin-when-cross-origin" },
    };
  },

  parseHTML() {
    return [
      {
        // The shape buildVideoEmbed emits: a figure wrapping the frame.
        tag: "figure.video-embed",
        getAttrs: (element) => {
          const iframe = (element as HTMLElement).querySelector("iframe");
          return iframe ? attrsFromElement(iframe) : false;
        },
      },
      {
        // A bare frame, which is what arrives when an editor copies one straight
        // out of a page's source.
        tag: "iframe",
        getAttrs: (element) => attrsFromElement(element as HTMLElement),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "figure",
      { class: "video-embed" },
      [
        "iframe",
        mergeAttributes(HTMLAttributes, {
          loading: "lazy",
          allowfullscreen: "true",
        }),
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoEmbedView);
  },
});