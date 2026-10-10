/**
 * The row-level claim that makes one wall post per story.
 *
 * `lib/vk-dedupe.ts` decides *whether* a repost is allowed; this decides *who gets to do
 * it*. The two are separate because the cheap decision cannot close a race: two requests
 * both read the row, both see no post id, and both conclude they are first. The only thing
 * that separates them is making the check and the write the same statement.
 *
 * So this does not read-then-write. It issues one conditional UPDATE — `WHERE id = ? AND
 * vkPostId IS NULL` — and looks at how many rows it touched. SQLite serialises writes, so
 * of two such statements exactly one matches: the second sees the value the first wrote.
 * That property is what makes a double-clicked publish button safe, and it holds across
 * processes, so it also survives a pm2 reload or a crash mid-publish in a way an in-memory
 * lock would not.
 */

import { VK_POST_CLAIM, interpretVkClaim, type VkClaimOutcome } from "@/lib/vk-dedupe";

/**
 * The slice of Prisma this module uses.
 *
 * Structural rather than the concrete client type, so the claim can be exercised against a
 * hand-written fake as well as against the real database — the atomicity argument is worth
 * more if it is tested both ways.
 */
export type VkClaimStore = {
  article: {
    /**
     * One method, both statements. The two differ only in the `where`: the take-it matches
     * `vkPostId: null` and writes the claim, the settle matches the claim and writes either
     * the real id or null. Widening the field here keeps this assignable from the generated
     * client — a separate named method would not exist on it.
     */
    updateMany(args: {
      where: { id: string; vkPostId: string | null };
      data: { vkPostId: string | null };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: string };
      select: { vkPostId: true };
    }): Promise<{ vkPostId: string | null } | null>;
  };
};

/** The settle statement, so neither settle path can drift into a blind write. */
function settle(
  store: VkClaimStore,
  articleId: string,
  data: { vkPostId: string | null },
): Promise<{ count: number }> {
  return store.article.updateMany({
    where: { id: articleId, vkPostId: VK_POST_CLAIM },
    data,
  });
}

/**
 * Takes the story, or reports that somebody else already has it.
 *
 * The follow-up read only happens on the losing path, to tell "another request is
 * publishing right now" apart from "the other request finished and it did go out" — a
 * difference the editor can see and that decides whether anything is reported as an error.
 */
export async function claimVkPost(
  store: VkClaimStore,
  articleId: string,
): Promise<VkClaimOutcome> {
  const { count } = await store.article.updateMany({
    where: { id: articleId, vkPostId: null },
    data: { vkPostId: VK_POST_CLAIM },
  });

  if (count > 0) return interpretVkClaim(count, VK_POST_CLAIM);

  const current = await store.article.findUnique({
    where: { id: articleId },
    select: { vkPostId: true },
  });

  return interpretVkClaim(count, current?.vkPostId);
}

/**
 * Replaces the claim with the id VK returned.
 *
 * A conditional UPDATE again: it must not overwrite a claim another request somehow took
 * afterwards. A post that VK never made would leave the story barred from the wall forever,
 * and a stale claim is the worse of the two failures.
 */
export async function finishVkPost(
  store: VkClaimStore,
  articleId: string,
  postId: string | null,
): Promise<void> {
  if (!postId) {
    // VK accepted the post but would not say which one. That is not a reason to leave the
    // claim sitting there: the post exists, and the claim would otherwise block every retry
    // while looking like something still in flight.
    await releaseVkPost(store, articleId);
    return;
  }

  await settle(store, articleId, { vkPostId: postId });
}

/**
 * Hands the story back, so a later save can try again.
 *
 * Used when the post failed — most often because VK was unavailable, which is not a reason
 * to bar the story from the wall permanently. Only the claim is released: a real post id
 * means the story is on the wall and must stay marked, whatever a retry decides.
 */
export async function releaseVkPost(
  store: VkClaimStore,
  articleId: string,
): Promise<void> {
  await settle(store, articleId, { vkPostId: null });
}