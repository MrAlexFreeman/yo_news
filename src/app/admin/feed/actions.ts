"use server";

import { revalidatePath } from "next/cache";

import { syncFeeds } from "@/lib/feed-sync";
import { ignoreFeedItem, restoreFeedItem } from "@/lib/feed-store";

/**
 * Actions behind the wire desk.
 *
 * Two of them, and both are about the desk's own state rather than about articles: an
 * item is hidden when it is not for this publication, and put back when that turns out
 * to be wrong. Creating a draft is a link into the article form, not an action here —
 * the editor should see the form before anything is written.
 *
 * The writes live in feed-store.ts so the check suite can exercise them; these wrap them
 * with the revalidation a Server Action needs.
 */

export type FeedActionResult = { ok: boolean; message: string };

/** Hides an item. Reversible, which is why it is a status rather than a delete. */
export async function ignoreFeedItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await ignoreFeedItem(id);

  revalidatePath("/admin/feed");
  revalidatePath("/admin");
}

/** Puts a hidden item back into the new list. */
export async function restoreFeedItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;

  await restoreFeedItem(id);

  revalidatePath("/admin/feed");
  revalidatePath("/admin");
}

/**
 * Manual sync, as a server action rather than a fetch to the route.
 *
 * The route exists for anything outside the page — the cron, a script, curl. The button
 * is inside a React tree that already has a server round trip available, and an action
 * keeps the result in the same render as the list it changed, which is what makes the
 * new items appear without a manual reload.
 */
export async function syncFeedAction(): Promise<FeedActionResult> {
  try {
    const summary = await syncFeeds();

    revalidatePath("/admin/feed");
    revalidatePath("/admin");

    const failed = summary.sources.filter((source) => source.error);
    const parts = summary.sources.map((source) =>
      source.error ? `${source.source}: ошибка` : `${source.source}: +${source.inserted}`,
    );

    return {
      ok: failed.length === 0,
      message:
        summary.inserted > 0
          ? `Добавлено ${summary.inserted}. ${parts.join(", ")}.`
          : `Новых материалов нет. ${parts.join(", ")}.`,
    };
  } catch (error) {
    console.error("[feed] синхронизация из админки не выполнена", error);
    return { ok: false, message: "Не удалось выполнить синхронизацию. Подробности в логе." };
  }
}