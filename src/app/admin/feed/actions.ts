"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { enrichStoredItem } from "@/lib/feed-fulltext";
import { syncFeeds } from "@/lib/feed-sync";
import { ignoreFeedItem, restoreFeedItem } from "@/lib/feed-store";

/**
 * Actions behind the wire desk.
 *
 * Three of them: an item is hidden when it is not for this publication, put back when
 * that turns out to be wrong, and opened into the article form. The first two are about
 * the desk's own state; the third does the one piece of real work — it upgrades the
 * stored teaser to the story behind it before handing the editor a form.
 *
 * The writes live in feed-store.ts and feed-fulltext.ts so the check suite can exercise
 * them; these wrap them with the revalidation and navigation a Server Action needs.
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
 * «Создать материал»: fetch the story behind the teaser, then open the form on it.
 *
 * A Server Action rather than a link, because it writes. The Next guide on data security
 * is explicit — "updating databases ... should never be a side-effect" of rendering — and
 * a plain `<a>` would make the write happen inside the GET that paints the form, which a
 * link prefetch can trigger on its own. As an action it is a POST, which is also what
 * keeps a cross-origin page from driving it.
 *
 * The fetch can take a second or two; the button shows a spinner for the wait (see
 * feed-list.tsx). `enrichStoredItem` never throws and degrades to the teaser, so a dead
 * outlet costs the editor nothing but the wait.
 */
export async function openFeedItemAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  if (!id) redirect("/admin/feed");

  const found = await enrichStoredItem(id);
  if (!found) redirect("/admin/feed");

  // The list preview shows the stored text, and it just changed.
  revalidatePath("/admin/feed");

  redirect(`/admin/articles/new?feed=${encodeURIComponent(id)}`);
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