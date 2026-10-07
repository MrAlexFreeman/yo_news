import { FORUM_SEED_CATEGORIES } from "@/lib/forum";

/**
 * Where a story's discussion belongs on the forum.
 *
 * The article rubric and the forum sections are separate taxonomies — the news desk
 * has Культура, Наука, Спорт, Технологии, the forum has four broader sections — so the
 * "discuss this" button needs a decision. Guessing at the moment of click is not an
 * option: the button is a link, and a link cannot ask.
 *
 * The mapping is explicit rather than derived, because the honest answer for most
 * rubrics is "Новости и события" and a rule that produced something cleverer would be
 * wrong more often than right. An unmapped rubric falls back to the news section rather
 * than hiding the button: a reader who wants to discuss a story should always land
 * somewhere, and a wrong-but-open section is a smaller failure than a missing link.
 *
 * Measured against the eight rubrics actually in the database — culture, science,
 * society, politics, incident, sport, tech, economy. Of those only `society` maps
 * anywhere but the news section: it is where readers take civic complaints, which is
 * exactly what "Городские проблемы и ЖКХ" is for. There is no transport rubric on the
 * site today, so the roads section currently has no inbound links from the article
 * pages — which is worth knowing rather than discovering later.
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

/**
 * Article rubric slug → forum section slug.
 *
 * Checked against `FORUM_SEED_CATEGORIES` by the checks: a typo here would otherwise
 * produce a link to a 404 on every article in that rubric, and the only symptom would
 * be a forum nobody arrives at.
 */
const CATEGORY_TO_FORUM: Record<string, string> = {
  society: "gorodskie-problemy-i-zhkh",
};

export type ForumSection = { slug: string; title: string };

/**
 * The forum section a story belongs to, with the title to print on the button.
 *
 * The title comes back because a link labelled "обсудить" that silently drops the
 * reader into a differently-named section is worse than one that says where it goes.
 */
export function forumSectionForArticle(
  rubricSlug: string | null | undefined,
): ForumSection {
  const slug = (rubricSlug && CATEGORY_TO_FORUM[rubricSlug]) || NEWS;
  const title = FORUM_SLUGS[slug] ?? FORUM_SLUGS[NEWS]!;
  return { slug, title };
}

/** The slugs the mapping points at, for the checks that guard against a typo. */
export function forumSlugsInRubricMap(): string[] {
  return [...new Set([NEWS, ...Object.values(CATEGORY_TO_FORUM)])];
}