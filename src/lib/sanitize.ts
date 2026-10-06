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
 * Attributes whose values are not URIs, so the regex above must not judge them.
 *
 * Measured, not guessed: DOMPurify applies `ALLOWED_URI_REGEXP` to the value of
 * *every* allowed attribute, not only to href/src. Without this, `target="_self"`
 * fails the regex and is stripped, and since the shared hook then sees a link with
 * no target it applies its own `_blank` default — which silently overrode the
 * editor's "open in the same tab" choice in the link dialog.
 *
 * `target` and `rel` hold a browsing-context name and a link-type list. Neither is
 * a URL, so neither can smuggle `javascript:`; href still goes through the regex,
 * which is what actually blocks a scripted link.
 */
const URI_SAFE_ATTR = [
  "target",
  "rel",
  // The same trap as above, one level down: the video iframe's player affordances
  // are not URLs either, and every one of them was being stripped, which is why a
  // published video had no fullscreen button. `allow` carries a permissions policy
  // list, not an address — nothing in any of these can execute or fetch.
  "allow",
  "allowfullscreen",
  "referrerpolicy",
  "loading",
];

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
      ADD_URI_SAFE_ATTR: URI_SAFE_ATTR,
      FORBID_TAGS: ["script", "style", "object", "embed", "form", "input"],
      // `formaction` can re-introduce a script URL on a stripped <form>; srcset is
      // excluded because the editor does not emit it.
      FORBID_ATTR: ["formaction", "srcset", "xlink:href"],
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
    }),
  );
}

/**
 * Tags a forum post may contain.
 *
 * Text, line breaks and quotes, and nothing else. No `<a>`, no `<img>`, no
 * `<iframe>`, no `<h*>` — a reader's post is not an article, and a heading in the
 * middle of a thread reads as an attempt to impersonate the moderation desk.
 *
 * `<a>` is excluded rather than merely restricted: `KEEP_CONTENT` unwraps it, so a
 * pasted link keeps its words and loses its href. That is the behaviour a reader
 * pasting a URL wants — the text is still readable — without leaving an unmoderated
 * outbound link on the site.
 */
const FORUM_ALLOWED_TAGS = [
  "p", "br",
  "strong", "b", "em", "i", "u",
  "blockquote", "q", "cite",
];

/**
 * Forum post body, sanitised for an anonymous author.
 *
 * No attributes at all — not an empty `ALLOWED_ATTR` out of caution but because
 * nothing in the tag list needs one. `class` and `style` in particular are absent
 * from a reader's post on purpose: a class is a defacement, and a style is a way to
 * make text invisible to a moderator looking for spam.
 */
export function sanitizeForumHtml(dirty: string): string {
  return withPolicy("forum", () =>
    DOMPurify.sanitize(dirty, {
      ALLOWED_TAGS: FORUM_ALLOWED_TAGS,
      ALLOWED_ATTR: [],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      // A poster's words are the content; stripping a tag must not delete the
      // sentence inside it.
      KEEP_CONTENT: true,
    }),
  );
}