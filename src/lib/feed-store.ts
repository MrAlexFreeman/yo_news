import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * The wire desk's own state changes, apart from the actions that trigger them.
 *
 * Extracted for the same reason `article-trash.ts` is a module rather than three lines
 * inside `actions.ts`: a Server Action runs under the request machinery, so a check
 * suite cannot call one — `revalidatePath` throws outside a request — and a behaviour
 * that cannot be exercised is a behaviour nobody re-checks. The actions keep the
 * revalidation; this keeps the writes.
 */

/** The three states an item can be in. Modelled as a union because SQLite has no enum. */
export const FEED_STATUSES = ["NEW", "DRAFTED", "IGNORED"] as const;
export type FeedStatus = (typeof FEED_STATUSES)[number];

/**
 * Hides an item. Returns how many rows changed, so a caller can tell "hidden" from
 * "there was nothing to hide" — an id from a stale page hits the second case.
 */
export async function ignoreFeedItem(id: string): Promise<number> {
  const result = await prisma.newsFeedItem.updateMany({
    where: { id, status: { not: "IGNORED" } },
    data: { status: "IGNORED" satisfies FeedStatus },
  });
  return result.count;
}

/** Puts a hidden item back into the new list. */
export async function restoreFeedItem(id: string): Promise<number> {
  const result = await prisma.newsFeedItem.updateMany({
    where: { id, status: "IGNORED" satisfies FeedStatus },
    data: { status: "NEW" satisfies FeedStatus },
  });
  return result.count;
}

/**
 * Marks the item a draft was written from.
 *
 * Only from `NEW`: an editor who opens a hidden item and writes a story from it has not
 * asked for it to come back to the working list, and moving it would lose the hiding.
 */
export async function takeFeedItem(id: string): Promise<number> {
  const result = await prisma.newsFeedItem.updateMany({
    where: { id, status: "NEW" satisfies FeedStatus },
    data: { status: "DRAFTED" satisfies FeedStatus },
  });
  return result.count;
}

/** How many items are still waiting for a decision, for the navigation badge. */
export async function countNewFeedItems(): Promise<number> {
  return prisma.newsFeedItem.count({ where: { status: "NEW" satisfies FeedStatus } });
}
