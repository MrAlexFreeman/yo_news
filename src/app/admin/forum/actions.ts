"use server";

import { revalidatePath } from "next/cache";

import {
  deleteForumPost,
  deleteForumTopic,
  getForumPostLocation,
  getForumTopicLocation,
  setForumTopicClosed,
  setForumTopicPinned,
} from "@/lib/forum";

/**
 * Moderation for /admin/forum.
 *
 * Every action revalidates the board, the admin page, and — where it is known — the
 * section and the thread. Deleting a post changes all four, and a moderator who clicks
 * "удалить" and then still sees the message on /forum has lost trust in the button for
 * good. The location lookups happen *before* the delete, because afterwards the slug
 * is unrecoverable and there is nothing left to revalidate.
 *
 * Only async functions are exported: a `"use server"` module that also exports a value
 * makes Turbopack drop the module's exports entirely.
 */

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function int(formData: FormData, key: string): number | null {
  const parsed = Number.parseInt(str(formData, key), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Tri-state flag: the form sends "1" for on, "0" for off, nothing for unchanged. */
function flag(formData: FormData, key: string): boolean {
  return str(formData, key) === "1";
}

function revalidateForum(topicSlug?: string, categorySlug?: string): void {
  revalidatePath("/forum");
  revalidatePath("/admin/forum");
  if (categorySlug) revalidatePath(`/forum/${categorySlug}`);
  if (categorySlug && topicSlug) revalidatePath(`/forum/${categorySlug}/${topicSlug}`);
}

export async function toggleForumTopicPinnedAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const id = int(formData, "id");
  if (!id) return { ok: false, message: "Тема не найдена." };

  const isPinned = flag(formData, "pinned");

  try {
    await setForumTopicPinned(id, isPinned);
  } catch {
    return { ok: false, message: "Не удалось изменить закрепление — тема уже удалена?" };
  }

  revalidateForum();
  return { ok: true, message: isPinned ? "Тема закреплена." : "Закрепление снято." };
}

export async function toggleForumTopicClosedAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const id = int(formData, "id");
  if (!id) return { ok: false, message: "Тема не найдена." };

  const isClosed = flag(formData, "closed");

  try {
    await setForumTopicClosed(id, isClosed);
  } catch {
    return { ok: false, message: "Не удалось закрыть тему — она уже удалена?" };
  }

  revalidateForum();
  return {
    ok: true,
    message: isClosed ? "Тема закрыта для новых ответов." : "Тема снова открыта.",
  };
}

/**
 * Deletes one message for good.
 *
 * There is no "hidden" flag on a post, so this is a hard delete and the button says
 * so. The confirmation lives in the page: a server action cannot raise a native
 * `confirm`, and omitting it would make one click irreversible.
 */
export async function deleteForumPostAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const id = int(formData, "id");
  if (!id) return { ok: false, message: "Сообщение не найдено." };

  const location = await getForumPostLocation(id);
  const count = await deleteForumPost(id);
  if (count === 0) return { ok: false, message: "Сообщение уже удалено." };

  revalidateForum(location?.topicSlug, location?.categorySlug);
  return { ok: true, message: "Сообщение удалено." };
}

/**
 * Deletes a thread and, by cascade in the schema, every message in it.
 *
 * One button for the whole discussion, because the alternative — deleting messages
 * one at a time from a list of the latest forty — would mean a hundred clicks and
 * still leave the tail behind.
 */
export async function deleteForumTopicAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const id = int(formData, "id");
  if (!id) return { ok: false, message: "Тема не найдена." };

  const location = await getForumTopicLocation(id);

  try {
    await deleteForumTopic(id);
  } catch {
    return { ok: false, message: "Не удалось удалить тему — она уже удалена?" };
  }

  revalidateForum(location?.topicSlug, location?.categorySlug);
  return { ok: true, message: "Тема и все её сообщения удалены." };
}