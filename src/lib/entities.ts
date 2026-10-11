import "server-only";

import { prisma } from "@/lib/prisma";
import {
  ENTITY_LEGACY_URL_PREFIX,
  ENTITY_URL_PREFIX,
  parseEntityImages,
  type EntityCardInput,
  type EntityCardView,
} from "@/lib/entity-card";

/**
 * Reading and writing entity cards.
 *
 * The one place that knows these rows exist. The public article page must reach a card by
 * slug on every render, so the lookup is the single indexed hit on `slug` and everything
 * else about the card comes with it — there is no second query for the pictures, which are
 * a column on the same row rather than a table to join.
 */

/** The row, as the database holds it. */
type Row = {
  slug: string;
  title: string;
  category: string | null;
  summary: string;
  location: string | null;
  foundedYear: string | null;
  websiteUrl: string | null;
  images: string;
};

/**
 * What a reader is shown, and nothing else.
 *
 * `createdAt` and `updatedAt` are deliberately absent: they are editorial bookkeeping and
 * would tell a reader when the newsroom last corrected a description. Built through this
 * one function so a field cannot reach a popover by being added to the query later.
 */
function toView(row: Row): EntityCardView {
  return {
    slug: row.slug,
    title: row.title,
    category: row.category,
    summary: row.summary,
    location: row.location,
    foundedYear: row.foundedYear,
    websiteUrl: row.websiteUrl,
    images: parseEntityImages(row.images),
  };
}

const SELECT = {
  slug: true,
  title: true,
  category: true,
  summary: true,
  location: true,
  foundedYear: true,
  websiteUrl: true,
  images: true,
} as const;

/** One card by slug, or null. */
export async function getEntityCard(slug: string): Promise<EntityCardView | null> {
  const row = await prisma.entityCard.findUnique({ where: { slug }, select: SELECT });
  return row ? toView(row) : null;
}

/** Several cards by slug, in the order asked for. Missing ones are simply absent. */
export async function getEntityCards(slugs: readonly string[]): Promise<EntityCardView[]> {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return [];

  const rows = await prisma.entityCard.findMany({
    where: { slug: { in: unique } },
    select: SELECT,
  });

  const bySlug = new Map(rows.map((row) => [row.slug, toView(row)]));
  // The request order, so the popover shows the card for the link that was hovered rather
  // than whichever row the database happened to return first.
  return unique.map((slug) => bySlug.get(slug)).filter((card): card is EntityCardView => !!card);
}

/**
 * The picker list, newest name first.
 *
 * SQLite's `LIKE` and `LOWER()` fold ASCII only — the measured reason `Tag` carries a
 * `nameKey` — so a search for "музей" would never match "Музей". The fold happens in JS
 * here, over the (small) editorial list, for the same reason.
 */
export async function listEntityCards(search?: string): Promise<EntityCardView[]> {
  const rows = await prisma.entityCard.findMany({
    select: SELECT,
    orderBy: { title: "asc" },
  });

  const needle = (search ?? "").trim().toLowerCase();

  return rows
    .map(toView)
    .filter((card) => {
      if (!needle) return true;
      return (
        card.title.toLowerCase().includes(needle) ||
        card.slug.includes(needle) ||
        (card.category ?? "").toLowerCase().includes(needle)
      );
    });
}

/** Creates a card. Throws on a duplicate slug, which the route turns into a 409. */
export async function createEntityCard(input: EntityCardInput) {
  return prisma.entityCard.create({
    data: { ...input, images: JSON.stringify(input.images) },
    select: SELECT,
  });
}

/** Updates a card. `where.slug` is the identity: a slug may be corrected in place. */
export async function updateEntityCard(slug: string, input: EntityCardInput) {
  return prisma.entityCard.update({
    where: { slug },
    data: { ...input, images: JSON.stringify(input.images) },
    select: SELECT,
  });
}

/** Removes a card, or null when it was not there. */
export async function deleteEntityCard(slug: string): Promise<EntityCardView | null> {
  const existing = await prisma.entityCard.findUnique({ where: { slug }, select: SELECT });
  if (!existing) return null;

  await prisma.entityCard.delete({ where: { slug } });
  return toView(existing);
}

/** How many articles link to a card, by counting its address in the stored bodies. */
export async function countEntityCardUsages(slug: string): Promise<number> {
  return prisma.article.count({ where: mentioningEntityWhere(slug) });
}

/**
 * The filter that finds articles linking a card.
 *
 * Both prefixes, because a card's address moved and the bodies were deliberately not
 * rewritten: a story published last month says `/entities/<slug>`, one published today says
 * `/wiki/<slug>`, and both are links to the same card. Counting only the current prefix
 * would under-report the references — and this number is what the delete confirmation shows
 * an editor before they remove a card that twelve published stories point at.
 *
 * `contains` on the prefix rather than the whole href, so a link carrying a fragment or a
 * query still counts. It is not exact: a body mentioning the address in prose would match
 * too. The alternative is parsing every body's HTML, and the cost of the false positive is
 * one extra line in a confirmation dialog.
 */
function mentioningEntityWhere(slug: string) {
  return {
    deletedAt: null,
    OR: [
      { contentHtml: { contains: `${ENTITY_URL_PREFIX}${slug}` } },
      { contentHtml: { contains: `${ENTITY_LEGACY_URL_PREFIX}${slug}` } },
    ],
  };
}

/**
 * The published stories that link to a card — «Материалы по теме».
 *
 * The other half of what a card is for. The card explains a place; these are the stories
 * that mention it, and a reader who arrived at the card from one of them can see the rest.
 * Listed newest first and capped, because a well-known landmark can appear in dozens of
 * stories and the block is a way onward rather than a second archive.
 */
export async function getArticlesMentioningEntity(
  slug: string,
  take = 12,
): Promise<
  { id: string; slug: string; title: string; lead: string | null; publishedAt: Date | null }[]
> {
  return prisma.article.findMany({
    where: { ...mentioningEntityWhere(slug), status: "published" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take,
    select: { id: true, slug: true, title: true, lead: true, publishedAt: true },
  });
}

/** How many published stories link to a card; the count shown on its page. */
export async function countPublishedMentions(slug: string): Promise<number> {
  return prisma.article.count({
    where: { ...mentioningEntityWhere(slug), status: "published" },
  });
}