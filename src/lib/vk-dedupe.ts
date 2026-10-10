/**
 * When a story may go to the community wall, and how a second attempt loses.
 *
 * Two different races are handled here, and they need different answers.
 *
 * **The ordinary one** is an editor saving twice. The repost used to fire on
 * `status === "published"` where Telegram and MAX correctly fired on the transition into
 * published, so every save put the same headline on the wall again — the two-to-three
 * copies that prompted this. That half is a missing condition and needs no machinery.
 *
 * **The real one** is two submits at once: a double-clicked button, a retry after a
 * timeout, two tabs left open on the same story. Both requests read the row before
 * either has written to it, and both conclude they are first. Checking a flag in Node
 * does not help — the check and the claim have to be the same statement, which is what
 * `claimVkPost` does with a conditional UPDATE.
 *
 * The claim is a row value rather than a mutex because it outlives the process. pm2
 * reloads, a deploy, or a crashed request all leave an in-memory lock behind nothing,
 * whereas the row is the same claim the next process reads.
 */

import type { ArticleStatus } from "@/lib/article-status";

/**
 * The value written to `vkPostId` while the post is being made.
 *
 * Deliberately not a valid post id. VK returns small integers, and a claim that could be
 * confused with one would let a later reader mistake "in flight" for "posted" and refuse
 * a retry that should have happened. A rejected claim clears it back to null, so this
 * only ever appears while a request is actually running.
 */
export const VK_POST_CLAIM = "__claiming__";

/** True for the in-flight claim, false for a real post id or for nothing. */
export function isVkPostClaimed(value: string | null | undefined): boolean {
  return value === VK_POST_CLAIM;
}

/**
 * True when the story is demonstrably on the wall.
 *
 * The claim does not count: it means somebody is publishing, not that it worked. A failed
 * post releases the claim precisely so the next save can try again, and treating the claim
 * as proof would make that retry impossible.
 */
export function isVkPosted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0 && !isVkPostClaimed(value);
}

export type VkRepostDecision =
  /** Nobody has the story and it is going live now. */
  | "publish"
  /** The story is already on the wall, or this save is not the first. */
  | "already-posted"
  /** The editor did not ask for it, or the story is not public. */
  | "not-publishable";

/**
 * Whether this save may put the story on the wall.
 *
 * `previousStatus` is the part that was missing, and it is the part that does the work.
 * Without it a story stays eligible on every subsequent save, which is the duplication.
 * `storedPostId` covers the case the transition check cannot: a story published from the
 * feed desk, or by a process that died between posting and writing the id down.
 *
 * The claim counts as neither. It is deliberately not listed here — a decision made from a
 * stale read that includes "someone is publishing" would block a legitimate retry after a
 * crash. The row-level `claimVkPost` is the authority on that race, and this function
 * answers the cheaper question.
 */
export function decideVkRepost(input: {
  /** Status before this save. */
  previousStatus: ArticleStatus;
  /** Status being saved. */
  status: ArticleStatus;
  /** The editor's checkbox. */
  isVk: boolean;
  /** `vkPostId` as read before this save. */
  storedPostId?: string | null;
}): VkRepostDecision {
  if (!input.isVk || input.status !== "published") return "not-publishable";
  if (isVkPosted(input.storedPostId)) return "already-posted";
  if (input.previousStatus === "published") return "already-posted";

  return "publish";
}

/**
 * The result of trying to take the row.
 *
 * `claimed: false` means somebody else got there first — a genuine double submit, or the
 * same story being published from two tabs — and the caller must not post. `alreadyPosted`
 * separates that from the benign case, where the other writer finished and left a real id
 * behind, so the editor can be told the story did go out rather than that something failed.
 */
export type VkClaimOutcome = {
  claimed: boolean;
  alreadyPosted: boolean;
};

/**
 * Turns the row count from a conditional UPDATE into the decision.
 *
 * Pure, and therefore assertable without a database. `count` of 1 means the WHERE clause
 * matched, which — because the clause required the column to still be null — can only be
 * true if no one else had written first.
 */
export function interpretVkClaim(
  count: number,
  /** The value in the column afterwards, for the losing case. */
  storedAfter: string | null | undefined,
): VkClaimOutcome {
  if (count > 0) return { claimed: true, alreadyPosted: false };
  return { claimed: false, alreadyPosted: isVkPosted(storedAfter) };
}