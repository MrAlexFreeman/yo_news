import DOMPurify from "isomorphic-dompurify";

/**
 * The one DOMPurify instance this project uses, with a single attribute hook.
 *
 * Why not one hook per module: `isomorphic-dompurify` hands out a shared instance
 * and its hooks are global. `removeAllHooks()` from one module therefore unhooks
 * every other module's protection, and `removeHook(fn, event)` does not take a
 * function reference in this build — both were measured, not assumed. The failure
 * mode was silent and bad: once the feed was rendered, `sanitizeArticleHtml`
 * believed its hook was still installed (`hookInstalled` was true) and stopped
 * re-adding it, so public article pages rendered with the data-URI guard and the
 * video-iframe host check both switched off.
 *
 * So: one hook, and the caller declares which policy it wants. `sanitize` is
 * synchronous, so a module-level policy cannot be observed by a concurrent call.
 */

export type Policy = "article" | "dzen";

let policy: Policy = "article";
let installed = false;

/** Minimal shape shared by the element and window DOM nodes alike. */
type Node = {
  nodeName?: unknown;
  getAttribute?: (name: string) => string | null;
  setAttribute?: (name: string, value: string) => void;
  removeAttribute?: (name: string) => void;
  remove?: () => void;
};

function tagOf(node: unknown): string {
  const element = node as Node;
  return String(element?.nodeName ?? "").toLowerCase();
}

/** Schemes allowed in a URL attribute. Blocks `javascript:` and friends. */
const URI_ATTRIBUTES = ["href", "src", "action", "formaction", "xlink:href"];

/**
 * True when any URL attribute smuggles a `data:` scheme past whitespace and
 * control-character padding, which browsers ignore when resolving the scheme.
 */
function hasDataUri(node: unknown): boolean {
  const element = node as Node;
  if (typeof element?.getAttribute !== "function") return false;

  return URI_ATTRIBUTES.some((attribute) => {
    const value = element.getAttribute!(attribute);
    if (!value) return false;
    return value.replace(/[- ]/g, "").slice(0, 5).toLowerCase() === "data:";
  });
}

/** Hosts whose players may be framed. Mirrors PROVIDERS in video-embed.ts. */
const VIDEO_EMBED_HOSTS: readonly string[] = [
  "www.youtube.com",
  "youtube.com",
  "youtube-nocookie.com",
  "rutube.ru",
  "www.rutube.ru",
  "vk.com",
  "www.vk.com",
  "vk.ru",
  "www.vk.ru",
];

/** Absolute URL for a site-relative path; http(s) and non-navigable schemes pass. */
function absolutize(url: string, base: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(mailto:|tel:|#)/i.test(trimmed)) return trimmed;
  return `${base}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

/**
 * The styling every link in an article body carries.
 *
 * Forced rather than allowed through: the public page renders bodies inside a
 * `prose` container whose own link colour is easy to miss, and an editor pasting
 * a link needs it to look like a link without knowing that. Replaced wholesale, so
 * a `class` pasted by hand cannot stack on top and leave it looking like body text.
 */
export const ARTICLE_LINK_CLASS = "text-amber-600 hover:text-amber-700 underline";

/**
 * Article-page rules.
 *
 * No base URL is needed: the body is rendered relative to the page, so a
 * site-relative link stays relative and only a data URI is dangerous.
 */
function applyArticlePolicy(node: unknown) {
  const element = node as Node;

  if (tagOf(node) === "a") {
    element.setAttribute?.("class", ARTICLE_LINK_CLASS);

    // The target is a default, not an override. The link dialog has an "open in a
    // new tab" checkbox and expresses "same tab" as target="_self" precisely so
    // this default does not undo it — forcing _blank unconditionally would make
    // the checkbox a decoration. `rel` travels with the target we set ourselves;
    // an author's own rel is left alone.
    if (!element.getAttribute?.("target")) {
      element.setAttribute?.("target", "_blank");
      element.setAttribute?.("rel", "noopener noreferrer");
    }
    return;
  }

  if (tagOf(node) === "iframe") {
    // An iframe is only kept when it frames a known video player over https.
    // Anything else is dropped along with the element.
    const src = element.getAttribute?.("src") ?? "";
    let allowed = false;
    try {
      const parsed = new URL(src.trim());
      allowed = parsed.protocol === "https:" && VIDEO_EMBED_HOSTS.includes(parsed.hostname);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      element.removeAttribute?.("src");
      element.remove?.();
    }
    return;
  }

  if (hasDataUri(node)) {
    for (const attribute of URI_ATTRIBUTES) element.removeAttribute?.(attribute);
  }
}

function applyDzenPolicy(node: unknown, base: string) {
  if (!base) throw new Error("setFeedBase must be called before the dzen policy runs");
  const element = node as Node;

  // Dzen understands a link, not a player: «RSS-лента автоматически превращает в
  // виджет следующие ссылки». An iframe is removed so it cannot occupy space
  // where the widget is expected.
  if (["iframe", "object", "embed"].includes(tagOf(node))) {
    element.remove?.();
    return;
  }

  // Dzen fetches every URL from the feed itself and refuses relative ones.
  for (const attribute of ["src", "href"]) {
    const value = element.getAttribute?.(attribute);
    if (value) element.setAttribute?.(attribute, absolutize(value, base));
  }
}

let feedBase = "";

/** Base the Dzen policy rewrites relative URLs against, set per call. */
export function setFeedBase(base: string): void {
  feedBase = base;
}

/**
 * Runs `sanitize` under a named policy, installing the shared hook on first use.
 *
 * The base for the Dzen policy is passed through `setFeedBase` rather than
 * threaded as an argument because the hook signature is fixed by DOMPurify.
 */
export function withPolicy<T>(next: Policy, run: () => T): T {
  if (!installed) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (policy === "dzen") applyDzenPolicy(node, feedBase);
      else applyArticlePolicy(node);
    });
    installed = true;
  }

  const previous = policy;
  policy = next;
  try {
    return run();
  } finally {
    policy = previous;
  }
}

export { DOMPurify };