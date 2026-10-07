import { FORUM_SEED_CATEGORIES } from "@/lib/forum";

/**
 * Where a story's discussion belongs on the forum.
 *
 * The article rubric and the forum sections are separate taxonomies — the news desk
 * has Культура, Наука, Спорт, Технологии, the forum has four broader sections — so the
 * "discuss this" button needs a decision. Guessing at the moment of click is not an
 * option: the button is a link, and a link cannot ask.
 *
 * Tags first, rubric second.
 *
 * That order is the whole design. "Авто и дороги" is about a subject, and a subject is
 * what a tag records; a rubric only records where the desk filed the piece. A story
 * about a fatal crash on the ring road is filed under «Происшествия» or «Общество» and
 * is still, unmistakably, a road story — and routing it by rubric would drop it in
 * "Городские проблемы и ЖКХ", where nobody follows traffic. Measured against the eight
 * rubrics actually in the database: `society` and `incident` do carry plenty of road
 * material, and that is exactly the case tags catch and rubrics cannot.
 *
 * The rubric is still the fallback, because a reader who wants to discuss a story
 * should always land somewhere, and a wrong-but-open section is a smaller failure than
 * a missing link.
 *
 * Keyed on the slug, not the display name, so an editor renaming "Общество" in the CMS
 * does not quietly move the button. A new rubric needs an entry here to be routed
 * anywhere but the news section.
 */

/** Forum section slugs, taken from the seed list so the two cannot drift apart. */
const FORUM_SLUGS = Object.fromEntries(
  FORUM_SEED_CATEGORIES.map((category) => [category.slug, category.title]),
);

const NEWS = "novosti-i-sobytiya";
const CITY = "gorodskie-problemy-i-zhkh";
const ROADS = "avto-i-dorogi";

/**
 * Tag stems that put a story in "Авто и дороги".
 *
 * Stems rather than whole words, matched as a prefix so one entry covers the inflected
 * forms — «дороги», «дорожная», «дорожное» all match.
 *
 * The `дорог`/`дорож` pair is not redundant. A single `дорог` stem silently misses
 * «Дорожный ремонт», which is arguably the most road-shaped tag there is, and a check
 * written by the same person who wrote the list is what caught it.
 *
 * Deliberately short: a tag that fits no section falls through to the rubric, and an
 * over-broad list would quietly misroute stories about something the section is not
 * about. «авиация» and «железная дорога» match nothing here on purpose.
 */
const ROAD_TAG_STEMS = [
  "авто",
  "транспорт",
  "дорог",
  "дорож",
  "дтп",
  "пробк",
  "парковк",
  "метро",
  "троллейбус",
];

/**
 * Article rubric slug → forum section slug, for the fallback.
 *
 * Checked against `FORUM_SEED_CATEGORIES` by the checks: a typo here would otherwise
 * produce a link to a 404 on every article in that rubric, and the only symptom would
 * be a forum nobody arrives at.
 */
const CATEGORY_TO_FORUM: Record<string, string> = {
  society: CITY,
  incident: CITY,
};

export type ForumSection = { slug: string; title: string };

/** Lowercases and folds ё to е, so «ДТП» and «дтп» compare equal. */
function fold(value: string): string {
  return value.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

/**
 * The forum section a story belongs to, with the title to print on the button.
 *
 * `tags` are the article's own tag names. The title comes back because a link labelled
 * "обсудить" that silently drops the reader into a differently-named section is worse
 * than one that says where it goes.
 */
export function forumSectionForArticle(input: {
  rubricSlug?: string | null;
  tags?: readonly string[];
}): ForumSection {
  const slug = sectionSlugFor(input);
  return { slug, title: FORUM_SLUGS[slug] ?? FORUM_SLUGS[NEWS]! };
}

/** Just the slug, for callers that do not need the label. */
export function sectionSlugFor(input: {
  rubricSlug?: string | null;
  tags?: readonly string[];
}): string {
  const tags = input.tags ?? [];
  if (tags.some((tag) => looksLikeRoads(tag))) return ROADS;

  return (input.rubricSlug && CATEGORY_TO_FORUM[input.rubricSlug]) || NEWS;
}

/** True when a tag names a road, traffic or transport subject. */
function looksLikeRoads(tag: string): boolean {
  const folded = fold(tag);
  return ROAD_TAG_STEMS.some((stem) => folded.startsWith(stem));
}

/** The slugs the mapping can return, for the checks that guard against a typo. */
export function forumSlugsInRubricMap(): string[] {
  return [...new Set([NEWS, ...Object.values(CATEGORY_TO_FORUM), ROADS])];
}

/** The tag stems that route to "Авто и дороги", exposed for the checks. */
export function roadTagStems(): readonly string[] {
  return ROAD_TAG_STEMS;
}