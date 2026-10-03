import DOMPurify from "isomorphic-dompurify";

import { isAllowedVideoEmbed } from "@/lib/video-embed";

/**
 * Tags the editorial editor emits. Kept as an explicit allowlist rather than
 * relying on DOMPurify's defaults: the admin toolbar produces a known set of
 * block and inline elements, so anything outside it has no business being in an
 * article body.
 */
const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "mark", "small",
  "blockquote", "q", "cite",
  "ul", "ol", "li", "dl", "dt", "dd",
  "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "pre", "code", "span", "div", "abbr", "time", "sup", "sub",
  // Video embeds. Kept in the allowlist so the editor can paste a YouTube or
  // Rutube player, and narrowed to approved hosts by the hook below — an
  // allowlisted tag alone would let anyone frame arbitrary third-party pages.
  "iframe",
];

const ALLOWED_ATTR = [
  "href", "title", "target", "rel",
  "src", "alt", "width", "height", "loading",
  "colspan", "rowspan", "scope",
  // Player affordances for the allowlisted video iframes.
  "allow", "allowfullscreen", "frameborder", "referrerpolicy",
  // The toolbar writes `style="text-align: …"`; DOMPurify strips unsafe
  // declarations from style values itself.
  "class", "id", "style", "datetime", "cite", "lang",
];

/**
 * Schemes allowed in href/src. Blocks `javascript:` while keeping the external
 * links and absolute paths editors write in the body.
 */
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|tel:|\/|#)/i;

/** Attributes that can carry a URL and therefore a scheme. */
const URI_ATTRIBUTES = ["href", "src", "action", "formaction", "xlink:href"];

/**
 * True when any URL attribute smuggles a `data:` scheme past whitespace and
 * control-character padding, which browsers ignore when resolving the scheme.
 *
 * Duck-typed rather than `instanceof Element`: there is no global `Element` in
 * the Node build of isomorphic-dompurify, and this hook runs on both sides.
 */
function hasDataUri(node: unknown): boolean {
  const element = node as { getAttribute?: (name: string) => string | null };
  if (typeof element?.getAttribute !== "function") return false;

  return URI_ATTRIBUTES.some((attribute) => {
    const value = element.getAttribute!(attribute);
    if (!value) return false;
    const normalised = value.replace(/[- ]/g, "");
    return normalised.slice(0, 5).toLowerCase() === "data:";
  });
}

let hookInstalled = false;

/** True for a node that is an <iframe>, duck-typed for the same reason as above. */
function isIframe(node: unknown): boolean {
  const element = node as { tagName?: unknown; nodeName?: unknown };
  const name = element?.tagName ?? element?.nodeName;
  return typeof name === "string" && name.toLowerCase() === "iframe";
}

/**
 * Strips `<script>`, inline `on*` handlers, and iframes pointing anywhere but an
 * approved video host, before the markup reaches `dangerouslySetInnerHTML`.
 *
 * Sanitising happens at render time, so the raw HTML stays in the database and
 * an editor who pasted something risky cannot publish it live.
 */
export function sanitizeArticleHtml(dirty: string): string {
  // The hook mutates shared DOMPurify state, so it is installed exactly once.
  if (!hookInstalled) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      const element = node as {
        getAttribute?: (name: string) => string | null;
        removeAttribute?: (name: string) => void;
        remove?: () => void;
      };

      if (isIframe(node)) {
        // An iframe is only kept when it frames a known video player over https.
        // Anything else is unwrapped, which drops the element and keeps the text
        // inside it.
        const src = element.getAttribute?.("src") ?? "";
        if (!isAllowedVideoEmbed(src.trim())) {
          element.removeAttribute?.("src");
          element.remove?.();
        }
        return;
      }

      if (!hasDataUri(node)) return;
      for (const attribute of URI_ATTRIBUTES) {
        element.removeAttribute?.(attribute);
      }
    });
    hookInstalled = true;
  }

  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP,
    FORBID_TAGS: ["script", "style", "object", "embed", "form", "input"],
    // `formaction` can re-introduce a script URL on a stripped <form>; srcset is
    // excluded because the editor does not emit it.
    FORBID_ATTR: ["formaction", "srcset", "xlink:href"],
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });
}
