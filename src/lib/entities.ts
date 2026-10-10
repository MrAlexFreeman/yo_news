import "server-only";

import { prisma } from "@/lib/prisma";
import {
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
  return prisma.article.count({ where: { contentHtml: { contains: `/entities/${slug}` } } });
}