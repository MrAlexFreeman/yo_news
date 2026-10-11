/**
 * The rules of an entity card: its slug, its address in an article, and its pictures.
 *
 * Pure — no Prisma, no `server-only`, no credentials — so the security suite can assert
 * that a slug is safe to put in an `href` and that a card's images are safe to render,
 * which are the two places this feature can do damage.
 */

/**
 * Where an entity card lives, and therefore where a link to one must point.
 *
 * `/wiki/`, and the address is the whole feature: a card is a real page inside a published
 * article's text, so a reader without JavaScript, a crawler and every syndicated copy of the
 * story all follow an ordinary link rather than a dead anchor.
 */
export const ENTITY_URL_PREFIX = "/wiki/";

/**
 * The prefix this feature used before it was called a wiki.
 *
 * Articles published under the old address are still out there with `/entities/<slug>` in
 * their bodies, and they are not rewritten: the stored HTML is what the editor wrote, and
 * silently editing published prose to keep a route rename tidy is the wrong trade. So the
 * old prefix is still *recognised* — a link to either address is a card link, and the page
 * at the old address answers with a permanent redirect to the new one.
 */
export const ENTITY_LEGACY_URL_PREFIX = "/entities/";

/** Every prefix an entity link may carry. Ordered: the current one first. */
export const ENTITY_HREF_PREFIXES = [ENTITY_URL_PREFIX, ENTITY_LEGACY_URL_PREFIX] as const;

/**
 * The attribute a rendered card link carries its slug in.
 *
 * The client uses it to find links to upgrade, which is cheaper and clearer than parsing
 * hrefs in the browser — and it is the markup the brief asks for. It is *stamped by the
 * sanitiser hook* rather than written by the editor, for the same reason the class is: the
 * hook already parses the slug out of the href, so a hand-written body and one the toolbar
 * produced cannot come to disagree about which card a link points at.
 *
 * `ALLOW_DATA_ATTR` is off site-wide, and this attribute does **not** need to be added to
 * the allowlist for it to appear. That was measured rather than assumed: an earlier version
 * named it in `ALLOWED_ATTR` and a mutation removing the entry still passed every check,
 * because DOMPurify's attribute filtering runs before `afterSanitizeAttributes` and the hook
 * writes the attribute afterwards. The entry was removed — configuration that looks
 * load-bearing and is not is worse than none, because the next person keeps it working for
 * a reason that does not exist. What actually matters is asserted: an author-supplied
 * `data-entity-slug` is stripped, then replaced with the one derived from the href.
 */
export const ENTITY_SLUG_ATTRIBUTE = "data-entity-slug";

/**
 * The class a rendered card link carries.
 *
 * Lives here rather than beside the sanitiser hook that forces it, because two callers need
 * it and only one of them may import DOMPurify: the hook writes it at render time, and the
 * editor's own mark writes it so a card looks like a card while it is being written.
 * Importing the hook's module into a client component would pull the sanitiser into the
 * browser bundle for the sake of a string.
 *
 * The hook remains the authority — it *replaces* the class on every anchor, so whatever the
 * editor wrote cannot survive a render if the two ever disagree.
 */
export const ENTITY_LINK_CLASS = "entity-wiki-link";

/**
 * The editor's picker searches by this.
 *
 * `ENTITY_MAX_SUMMARY` has moved twice, both times because it was shorter than the writing
 * it was supposed to permit. 600 was a paragraph, and an editor pasting a prepared
 * description lost the tail of it. 3000 was still a *card*; a wiki entry is not — a
 * reference article about a geopark or a person is allowed to be a page long, and the
 * popover that usually shows it prints two or three sentences while the page itself prints
 * everything.
 *
 * 10000 rather than no limit at all: the column has no ceiling of its own (SQLite `TEXT`),
 * so this is a guard against a pasted document, not a constraint on writing. It is high
 * enough that nobody composing an entry in the form will meet it by accident.
 */
export const ENTITY_MAX_TITLE = 120;
export const ENTITY_MAX_SUMMARY = 10000;
export const ENTITY_MAX_CATEGORY = 60;
export const ENTITY_MAX_LOCATION = 160;
export const ENTITY_MAX_FOUNDED = 80;
export const ENTITY_MAX_URL = 300;

/**
 * Characters that look like a space but are not one.
 *
 * Pasting from Word, Google Docs or a newsroom CMS brings these along, and they are the
 * reason a card can look right in the form and wrong on the page: a non-breaking space
 * prevents a line break where the layout needs one, and a zero-width space is invisible
 * while still counting towards the length and breaking a search for the words around it.
 *
 * Written as escapes rather than as literal characters, because a literal here would be
 * indistinguishable from the defect it exists to remove — the same trap the encoding check
 * documents about itself.
 */
const ODD_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;

/**
 * Removes the characters a paste drags in, without touching the editor's own typing.
 *
 * Safe to run on every keystroke — it only ever replaces an odd space with an ordinary one,
 * so an editor typing real spaces sees exactly what they typed. That is what makes it
 * usable in the form as well as on the server, and it is why collapsing runs of spaces is
 * *not* part of it: doing that while someone types makes the second press of the space bar
 * appear to do nothing.
 */
export function cleanEntityWhitespace(value: string): string {
  return value.replace(ZERO_WIDTH, "").replace(ODD_SPACES, " ").replace(/\r\n?/g, "\n");
}

/**
 * What actually gets stored.
 *
 * `cleanEntityWhitespace` plus the tidying that would be annoying during typing: runs of
 * spaces collapsed, blank-line runs reduced to one, both ends trimmed. Applied on the
 * server only, so the length an editor sees in the counter and the length the rule is
 * checked against can differ by a space or two — never by enough to matter, and never in
 * the direction of a card that passes the form and is rejected on save.
 */
export function normalizeEntityText(value: string): string {
  return cleanEntityWhitespace(value)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * How many pictures one card may carry.
 *
 * The popover shows a single frame at a time with dots, so this is a reading budget
 * rather than a storage one — but it is also what stops a form post from writing a
 * thousand-entry JSON array into a column every article page that links the card reads.
 */
export const ENTITY_MAX_IMAGES = 8;

/**
 * Cyrillic → Latin, for slugs.
 *
 * Transliteration rather than dropping the letters: `urlify("Янга-Тау")` would leave
 * "-", which is not a slug, and an editor naming a card after a place they write about in
 * Russian would otherwise get an empty slug and a card nothing can link to.
 *
 * Only unambiguous pairs are expanded — ж→zh, ш→sh, щ→sch — because the goal is a stable
 * and readable address, not a reversible encoding. `ё` folds to `e` like `е`, so «Ёлки» and
 * «Елки» cannot become two different cards of the same name.
 */
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh",
  щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * A slug from a title, for the editor to accept or correct.
 *
 * Advisory by design — the field is editable afterwards, because transliteration is a
 * guess ("Берёзовский" becomes `berezovskiy` here and `berehovskiy` in somebody's URL bar)
 * and an editor who knows the address their readers will see should win.
 */
export function slugify(title: string): string {
  const transliterated = [...title.toLowerCase()]
    .map((char) => (TRANSLIT[char] ?? char))
    .join("");

  return transliterated
    // Anything that is not a latin letter or a digit becomes a separator, including
    // Cyrillic that survived because it is not in the table above.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** A slug this project will store and publish. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 80;

export function isValidEntitySlug(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_SLUG_LENGTH &&
    SLUG_PATTERN.test(trimmed)
  );
}

/**
 * The address a card is linked by inside an article body.
 *
 * **A site-relative path, not `entity://`.** Three measured reasons, the first of which
 * is the one that would have shipped broken:
 *
 * 1. The article sanitiser's `ALLOWED_URI_REGEXP` is `/^(?:https?:|mailto:|tel:|\/|#)/i`.
 *    A custom scheme fails it, so DOMPurify strips the href and the editor's careful
 *    insertion becomes plain text in the published story — silently.
 * 2. `ALLOW_DATA_ATTR: false`, so the `<span data-entity="…">` form is cut the same way.
 *    Turning data attributes on to accommodate one feature would widen every article body
 *    on the site.
 * 3. The Dzen feed absolutises relative URLs, and refuses anything it cannot resolve.
 *    A syndicated story would carry a dead `entity://` to a platform that has no idea
 *    what it means.
 *
 * A real path is also the only choice that survives the popover script not running, which
 * is why `/wiki/<slug>` has a page of its own rather than being a shortcut to nowhere.
 */
export function entityHref(slug: string): string {
  return `${ENTITY_URL_PREFIX}${slug.trim()}`;
}

/**
 * The slug an href refers to, or null when it is not an entity link.
 *
 * Deliberately strict: the whole string must be the link, the segment must be a valid
 * slug, and it is decoded once so an encoded `/` cannot smuggle a second segment in. The
 * client uses this to decide which links to upgrade into cards, and treating
 * `/entities/../admin` as a card would put a popover on a link that goes somewhere else.
 *
 * Both prefixes are accepted. A card published before the route was renamed carries
 * `/entities/<slug>` in its stored body and that body is not rewritten — see
 * `ENTITY_LEGACY_URL_PREFIX`. The slug, not the prefix, is what a card is.
 */
export function slugFromEntityHref(href: string | null | undefined): string | null {
  if (!href) return null;

  let value: string;
  try {
    value = decodeURIComponent(href.trim());
  } catch {
    // A malformed escape sequence is not a card link; it is a broken attribute.
    return null;
  }

  const prefix = ENTITY_HREF_PREFIXES.find((candidate) => value.startsWith(candidate));
  if (!prefix) return null;

  const slug = value.slice(prefix.length);
  if (!slug || slug.includes("/")) return null;

  return isValidEntitySlug(slug) ? slug : null;
}

/** Whether a href points at an entity card. */
export function isEntityHref(href: string | null | undefined): boolean {
  return slugFromEntityHref(href) !== null;
}

/**
 * The card's pictures, from the JSON column, or an empty list.
 *
 * A column that holds anything a hand-written script might have put in it, so it is
 * parsed defensively and filtered rather than cast: only site-relative image paths that
 * the upload directory can serve survive, and everything else is dropped instead of being
 * handed to an `<img src>`.
 */
export function parseEntityImages(raw: unknown): string[] {
  let value: unknown = raw;

  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const images: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") continue;

    const trimmed = entry.trim();
    // Site-relative only: an absolute URL here would be an editor pointing the card at a
    // third-party tracker, and a data: URI would be a way past the next blocklist.
    if (!trimmed.startsWith("/uploads/")) continue;
    if (trimmed.includes("..") || trimmed.includes("\0")) continue;
    if (seen.has(trimmed)) continue;

    seen.add(trimmed);
    images.push(trimmed);
    if (images.length >= ENTITY_MAX_IMAGES) break;
  }

  return images;
}

/** The column value for a list of pictures. */
export function formatEntityImages(images: readonly string[]): string {
  return JSON.stringify(parseEntityImages(images));
}

/**
 * A website URL for the card, or null when there is nothing usable.
 *
 * https-only for the same reason the Telegram API root is: this value is rendered into an
 * `href` a reader clicks, and `javascript:` or a userinfo form is a phishing or an
 * exfiltration vector that a field an editor fills in by copy-pasting should not carry.
 * A bare domain is rejected rather than guessed at — the editor can add `https://`, and
 * a wrong guess that turns into a broken link is worse than an error at save time.
 */
export function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;

  return parsed.toString().slice(0, ENTITY_MAX_URL);
}

/** One field's error, or null. Field names match the admin form's inputs. */
export type EntityFieldErrors = Partial<Record<string, string>>;

/**
 * Validates a submitted card, returning the errors and the cleaned values.
 *
 * The values come back normalised rather than only the errors, so the route cannot save a
 * field that failed a rule it thought it passed — the same reason `validateApiKeyField`
 * returns the message rather than a boolean.
 */
export function validateEntityCard(input: {
  slug?: unknown;
  title?: unknown;
  category?: unknown;
  summary?: unknown;
  location?: unknown;
  foundedYear?: unknown;
  websiteUrl?: unknown;
  images?: unknown;
}): { errors: EntityFieldErrors; value: EntityCardInput | null } {
  const errors: EntityFieldErrors = {};

  /*
    Every field goes through the same normalisation, not only the long one.
    A non-breaking space in a category or a location is the same defect as one in the
    summary — it looks correct and behaves wrongly — and the slug computation reads the
    title, so normalising there keeps a pasted title from producing a slug with a stray
    separator in it.
  */
  const text = (raw: unknown): string =>
    typeof raw === "string" ? normalizeEntityText(raw) : "";

  const title = text(input.title);
  if (!title) {
    errors.title = "Укажите название объекта.";
  } else if (title.length > ENTITY_MAX_TITLE) {
    errors.title = `Не длиннее ${ENTITY_MAX_TITLE} символов.`;
  }

  const summary = text(input.summary);
  if (!summary) {
    errors.summary = "Нужно краткое описание — именно оно показывается в карточке.";
  } else if (summary.length > ENTITY_MAX_SUMMARY) {
    errors.summary = `Не длиннее ${ENTITY_MAX_SUMMARY} символов.`;
  }

  const slug = text(input.slug);
  if (!slug) {
    errors.slug = "Укажите адрес карточки.";
  } else if (!isValidEntitySlug(slug)) {
    errors.slug =
      "Только латиница в нижнем регистре, цифры и дефисы. Пример: yangantau.";
  }

  const bounded = (raw: unknown, max: number): string => text(raw).slice(0, max);

  const websiteUrl = text(input.websiteUrl);
  if (websiteUrl && !normalizeWebsiteUrl(websiteUrl)) {
    errors.websiteUrl =
      "Нужен полный адрес с https:// и без логина с паролем в ссылке.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors, value: null };
  }

  return {
    errors,
    value: {
      slug,
      title,
      summary,
      category: bounded(input.category, ENTITY_MAX_CATEGORY) || null,
      location: bounded(input.location, ENTITY_MAX_LOCATION) || null,
      foundedYear: bounded(input.foundedYear, ENTITY_MAX_FOUNDED) || null,
      websiteUrl: normalizeWebsiteUrl(websiteUrl),
      images: parseEntityImages(input.images),
    },
  };
}

/** A card as stored and as edited. */
export type EntityCardInput = {
  slug: string;
  title: string;
  summary: string;
  category: string | null;
  location: string | null;
  foundedYear: string | null;
  websiteUrl: string | null;
  images: string[];
};

/** What the public endpoint answers, and all a reader is shown. */
export type EntityCardView = {
  slug: string;
  title: string;
  category: string | null;
  summary: string;
  location: string | null;
  foundedYear: string | null;
  websiteUrl: string | null;
  images: string[];
};