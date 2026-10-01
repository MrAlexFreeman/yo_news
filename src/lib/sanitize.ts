import DOMPurify from "isomorphic-dompurify";

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
];

const ALLOWED_ATTR = [
  "href", "title", "target", "rel",
  "src", "alt", "width", "height", "loading",
  "colspan", "rowspan", "scope",
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

/**
 * Strips `<script>`, inline `on*` handlers, iframes and other injection vectors
 * from editor-supplied HTML before it reaches `dangerouslySetInnerHTML`.
 *
 * Sanitising happens at render time, so the raw HTML stays in the database and
 * an editor who pasted something risky cannot publish it live.
 */
export function sanitizeArticleHtml(dirty: string): string {
  // The hook mutates shared DOMPurify state, so it is installed exactly once.
  if (!hookInstalled) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (!hasDataUri(node)) return;
      const element = node as { removeAttribute?: (name: string) => void };
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
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    // `formaction` can re-introduce a script URL on a stripped <form>; srcset is
    // excluded because the editor does not emit it.
    FORBID_ATTR: ["formaction", "srcset", "xlink:href"],
    ALLOW_DATA_ATTR: false,
    KEEP_CONTENT: true,
  });
}
