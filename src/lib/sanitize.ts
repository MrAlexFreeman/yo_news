import { DOMPurify, withPolicy } from "@/lib/dompurify";

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
  // Rutube player, and narrowed to approved hosts by the shared hook — an
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

/**
 * Strips `<script>`, inline `on*` handlers, data-URI URLs, iframes pointing
 * anywhere but an approved video host, and normalises every link, before the
 * markup reaches `dangerouslySetInnerHTML`.
 *
 * Sanitising happens at render time, so the raw HTML stays in the database and an
 * editor who pasted something risky cannot publish it live.
 *
 * The hook itself lives in lib/dompurify.ts and is shared with the RSS feed: the
 * two need different rules from one global hook, and two separate hooks would
 * unhook each other.
 */
export function sanitizeArticleHtml(dirty: string): string {
  return withPolicy("article", () =>
    DOMPurify.sanitize(dirty, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOWED_URI_REGEXP,
      FORBID_TAGS: ["script", "style", "object", "embed", "form", "input"],
      // `formaction` can re-introduce a script URL on a stripped <form>; srcset is
      // excluded because the editor does not emit it.
      FORBID_ATTR: ["formaction", "srcset", "xlink:href"],
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
    }),
  );
}