import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { isVkClipLink, unsupportedVideoMessage, videoEmbedSrc } from "@/lib/video-embed";

/** The event the editor listens for, so a rejected paste can say why in its own strip. */
export const VIDEO_PASTE_REJECTED_EVENT = "video-paste-rejected";

/** Tells the component above why a video link did not become a player. */
function announce(editor: Editor, message: string): void {
  const view = editor.view.dom.ownerDocument.defaultView;
  if (!view) return;
  editor.view.dom.dispatchEvent(
    new view.CustomEvent(VIDEO_PASTE_REJECTED_EVENT, { detail: message, bubbles: true }),
  );
}

/**
 * Pasting a video address puts the player into the body instead of the address.
 *
 * Why this exists: the toolbar has a «Видео» button with a URL prompt, and nothing told an
 * editor to use it. Pasting a link is what everyone does — and what every messenger and most
 * CMSs turn into a player — so a pasted VK link arrived as an ordinary amber link, which is
 * indistinguishable from "the video feature does not work". That was the state reported from
 * the desk: «вставляю ссылку на видео — в тексте видео не появляется».
 *
 * The guard is deliberately narrow, because a paste handler that is too eager is worse than
 * none at all:
 *
 *   - only a **bare** address (one token, no spaces) — a link inside a sentence stays text,
 *     since lifting it out into a block would break the sentence;
 *   - only a **collapsed** selection — pasting over selected text is how an editor makes a
 *     link, and that is not a request for a player;
 *   - never inside a code block, where the address is content;
 *   - only hosts `buildVideoEmbed` already trusts, so the paste path cannot mint an iframe
 *     pointing somewhere the sanitiser would refuse.
 *
 * Anything else falls through to the normal paste, untouched.
 */
export const VideoLinkPaste = Extension.create({
  name: "videoLinkPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain")?.trim() ?? "";
            if (!text || /\s/.test(text)) return false;

            const { selection } = view.state;
            if (!selection.empty) return false;
            if (selection.$from.parent.type.name === "codeBlock") return false;

            const src = videoEmbedSrc(text);
            if (!src) {
              /*
                A link recognised as a video but not frameable — a VK Клип is the case that
                prompted this. The paste still falls through as ordinary text; what changes is
                that the desk is told which link it was, instead of watching nothing happen.
              */
              if (isVkClipLink(text)) announce(editor, unsupportedVideoMessage(text));
              return false;
            }

            editor
              .chain()
              .insertContent({ type: "videoEmbed", attrs: { src } })
              .scrollIntoView()
              .run();
            return true;
          },
        },
      }),
    ];
  },
});
