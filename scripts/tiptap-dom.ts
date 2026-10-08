/**
 * Round-trips article bodies through a real TipTap editor.
 *
 * This is the test that decides whether swapping the textarea was safe.
 *
 * A rich-text editor does not store what it was given: it parses the document
 * into its own schema and serialises that back. Anything the schema does not know
 * is not preserved — it is deleted, silently, the first time an editor opens an
 * article and saves it. The failure lands days later, on a published page, with
 * no error anywhere in between.
 *
 * So the question is not "does the editor format things" but "does every construct
 * an article can already contain come back out". The fixtures below cover what the
 * toolbar can emit and what the 71 stored bodies actually contain; the round trip
 * runs each one through the same extension list the component uses, twice, and
 * fails if a second pass changes anything.
 */
import { JSDOM } from "jsdom";

/**
 * A DOM for ProseMirror to build its view in.
 *
 * Installed on globalThis rather than passed around because ProseMirror reaches
 * for `document` from inside its own modules, and there is no seam to inject
 * through. Assigned before `@tiptap/core` is imported for the same reason.
 *
 * The URL matters: the Link extension reads `location` to decide what a relative
 * href resolves against.
 */
export function installDom(url = "https://eartnews.ru/admin/articles/new") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });

  const scope = globalThis as unknown as Record<string, unknown>;
  const assign = (key: string, value: unknown) => {
    Object.defineProperty(scope, key, { value, configurable: true, writable: true });
  };

  assign("window", dom.window);
  assign("document", dom.window.document);
  assign("navigator", dom.window.navigator);
  for (const key of [
    "HTMLElement",
    "Element",
    "Node",
    "Text",
    "DOMParser",
    "Range",
    "NodeFilter",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "getSelection",
    "MutationObserver",
  ] as const) {
    assign(key, (dom.window as unknown as Record<string, unknown>)[key]);
  }

  // jsdom has no layout engine, so it ships neither of these. ProseMirror's view
  // asks for both while attaching; without them it throws on the first flush.
  assign("requestAnimationFrame", (cb: (time: number) => void) =>
    setTimeout(() => cb(Date.now()), 0),
  );
  assign("cancelAnimationFrame", (id: number) => clearTimeout(id));

  /*
    A layout stub, for the same missing engine.

    ProseMirror calls `getClientRects` on whatever node holds the caret whenever it
    scrolls a selection into view — which is any transaction that moves the caret in a
    focused editor, so inserting a photo through the sidebar's handle reaches it. jsdom
    implements neither method, and the failure is a `TypeError` from deep inside
    prosemirror-view, which reads as a bug in the component under test.

    An empty list and a zero rect are the only truthful answers without layout: there is
    nothing to measure, and ProseMirror needs a rect only to decide how far to scroll.
    Scrolling is a no-op here either way. `getClientRects` returns an empty list rather
    than a rect because that is what prosemirror-view's `singleRect` checks for before
    falling back to `getBoundingClientRect`.
  */
  const emptyRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON() {
      return this;
    },
  });

  for (const prototype of [dom.window.Node.prototype, dom.window.Range.prototype]) {
    Object.defineProperty(prototype, "getClientRects", {
      value: () => [],
      configurable: true,
      writable: true,
    });
    Object.defineProperty(prototype, "getBoundingClientRect", {
      value: emptyRect,
      configurable: true,
      writable: true,
    });
  }

  if (!dom.window.document.querySelector(".tiptap")) {
    const host = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(host);
  }

  return dom;
}

export type RoundTrip = {
  /** HTML after one parse-and-serialise pass. */
  html: string;
  /** HTML after a second pass over the first one's output. */
  again: string;
  /** What the public page would render from {@link html}. */
  rendered: string;
  /** The editor, for running commands. */
  editor: import("@tiptap/core").Editor;
};