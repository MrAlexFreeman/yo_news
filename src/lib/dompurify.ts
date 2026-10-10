import DOMPurify from "isomorphic-dompurify";

import { ensureNoVkAutoplay } from "@/lib/video-embed";
import { slugFromEntityHref } from "@/lib/entity-card";
import { siteUrl } from "@/lib/site";

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

export type Policy = "article" | "forum" | "dzen";

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
 * The styling a link to an entity card carries, in a body.
 *
 * Forced here for the same reason `ARTICLE_LINK_CLASS` is, and by the same mechanism:
 * this hook *replaces* the class on every anchor, so whatever distinguishes a card from a
 * normal link has to come from this file. Deciding it in CSS instead would mean trusting a
 * `class` that has already been overwritten.
 *
 * The dashed underline is the tell. A reader who has learned it in one story recognises a
 * card in the next without being told again, and it survives print and high-contrast mode,
 * where an accent colour alone does not.
 */
export const ENTITY_LINK_CLASS = "entity-link";

/** The hostname `NEXT_PUBLIC_SITE_URL` names, or null when it is not a URL. */
export function hostOf(url: string): string | null {
  try {
    const hostname = new URL(url.trim()).hostname.toLowerCase();
    return hostname === "" ? null : hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Whether a link leaves the site, and so needs a new tab.
 *
 * **The rule:** internal = a site-relative path, a bare fragment, or the site's own host.
 * Everything else — another domain, a protocol-relative address, `mailto:`, a bare word —
 * is external.
 *
 * `//example.com/x` is the case that decides how this is written. It passes
 * `ALLOWED_URI_REGEXP`, because that expression accepts anything starting with `/`, and it
 * was measured passing the sanitiser intact — so treating "starts with a slash" as internal
 * would strip `target="_blank"` from a link pointing at another site entirely. The
 * protocol-relative form is therefore checked *before* the relative one, and that ordering
 * is the whole reason the two are separate tests rather than one `startsWith("/")`.
 *
 * `www.` is folded away on both sides so `https://www.eartnews.ru/news/x` and
 * `https://eartnews.ru/news/x` are the same site. A subdomain is *not* folded: `m.news…`
 * would be a different site, and one this publication does not run.
 *
 * The host is a parameter rather than read from the environment here, because this module
 * is shared with the RSS feed and the rule is worth asserting directly for a given pair of
 * addresses.
 */
export function isInternalHref(href: string, siteHost?: string | null): boolean {
  const value = href.trim();
  if (!value) return false;

  // Before the "/" test: this one names a different origin.
  if (value.startsWith("//")) return false;

  // A fragment stays on the page the reader is already on.
  if (value.startsWith("#")) return true;

  if (value.startsWith("/")) return true;

  const own = siteHost === undefined ? hostOf(siteUrl) : siteHost;
  if (own === null) return false;

  const target = hostOf(value);
  // null for a non-URL such as `mailto:` or a bare word — neither is this site, and both
  // are already handled by the scheme allowlist upstream.
  return target !== null && target === own;
}

/**
 * Article-page rules.
 *
 * No base URL is needed: the body is rendered relative to the page, so a
 * site-relative link stays relative and only a data URI is dangerous.
 */
function applyArticlePolicy(node: unknown) {
  const element = node as Node;

  if (tagOf(node) === "a") {
    const href = element.getAttribute?.("href") ?? "";
    // A card link keeps the ordinary link colour and adds the dashed underline, rather
    // than becoming its own colour: the reader is still following a link, and the popover
    // is an addition to it. A different hue would read as a different kind of destination
    // — a category, say — which is not what it is.
    const isEntity = slugFromEntityHref(href) !== null;

    element.setAttribute?.("class", isEntity ? ENTITY_LINK_CLASS : ARTICLE_LINK_CLASS);

    if (isEntity) {
      /*
        The popover opens on click and offers the page as a link, so the anchor must not
        also navigate. Removing `href` would leave a card looking like a link to a
        screen reader that cannot navigate it, and `tabindex="-1"` would hide it from the
        keyboard — the opposite of what either is for. What is kept is the address, so the
        link still works for a reader whose script has not run.
      */
      return;
    }

    /*
      The target is a default, and only for links that leave the site.

      An internal link gets nothing: a reader who clicks «Читайте также» — or any
      cross-reference between two stories — expects to arrive on that page, and a new tab
      for it is the difference between one window and eleven. External links keep
      `target="_blank"` so a reader comparing a source with the article does not lose
      their place, and `rel` travels with the target we set ourselves.

      An author's own `target` still wins, in either direction. The link dialog expresses
      "same tab" as `target="_self"` precisely so this default does not undo it, and an
      editor who deliberately sent a link to a new tab keeps that choice.
    */
    if (element.getAttribute?.("target")) return;

    if (isInternalHref(href)) return;

    element.setAttribute?.("target", "_blank");
    element.setAttribute?.("rel", "noopener noreferrer");
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
      return;
    }

    // A kept VK player gets its playback pinned, whatever produced the markup. The
    // toolbar builds the player through buildVideoEmbed and already sets these, but
    // an editor can paste a finished <iframe> straight into the body HTML, and the
    // article normaliser preserves those blocks verbatim. Without this the no-next
    // guarantee would hold only for players we built ourselves.
    const pinned = ensureNoVkAutoplay(src.trim());
    if (pinned !== src.trim()) element.setAttribute?.("src", pinned);
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

/**
 * Forum-post rules.
 *
 * Much narrower than the article policy, and deliberately so. An article body is
 * written by the editorial desk; a forum post is typed by an anonymous visitor into
 * a public form, so the markup has to be assumed hostile. The tag and attribute
 * allowlists in sanitize.ts already exclude links, images, players, `class` and
 * `style` — this hook is the second layer, so that widening a list there by mistake
 * cannot hand an anonymous poster the article page's privileges.
 *
 * Anything carrying a URL or a style is stripped outright rather than corrected. A
 * link in a forum post is a phishing target with no editorial review behind it, and
 * a `style` attribute is both a defacement vector and a way to hide text.
 */
function applyForumPolicy(node: unknown) {
  const element = node as Node;

  for (const attribute of URI_ATTRIBUTES) element.removeAttribute?.(attribute);
  element.removeAttribute?.("style");
  element.removeAttribute?.("class");

  // The tags below have no business in a post at all. They are not in the
  // allowlist, so this only fires if that list is ever widened.
  if (["a", "img", "iframe", "object", "embed", "form", "input", "button", "style", "script"].includes(tagOf(node))) {
    element.remove?.();
    return;
  }

  if (hasDataUri(node)) {
    for (const attribute of URI_ATTRIBUTES) element.removeAttribute?.(attribute);
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
      else if (policy === "forum") applyForumPolicy(node);
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