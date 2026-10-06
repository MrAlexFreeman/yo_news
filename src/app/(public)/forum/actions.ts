"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  createForumPost,
  createForumTopic,
  getForumCategoryBySlug,
  getForumTopic,
} from "@/lib/forum";
import {
  FORUM_NAME_MAX_LENGTH,
  FORUM_POST_MAX_LENGTH,
  FORUM_TITLE_MAX_LENGTH,
  clampForumText,
  forumTextToHtml,
  isHoneypotFilled,
} from "@/lib/forum-text";
import { clientIp, retryAfterSeconds, take } from "@/lib/forum-rate-limit";
import { sanitizeForumHtml } from "@/lib/sanitize";
import type { ForumFormResult } from "@/app/(public)/forum/types";

/**
 * Creating a topic or a reply, from the public pages.
 *
 * Both actions share the same gate, in the same order, because the order is what
 * makes it meaningful:
 *
 *   honeypot → rate limit → validate → store
 *
 * The honeypot comes first so a scripted flood is dropped before it touches the
 * limiter, and the rate limit before validation so a flood of empty or malformed
 * submissions is throttled exactly like a flood of real ones. Reversing any two of
 * those either lets a bot bypass the cooldown by sending invalid data, or lets it
 * exhaust other visitors' allowance faster.
 */

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Rejection shared by both actions, including the wait the visitor actually has. */
async function rateLimited(): Promise<ForumFormResult> {
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  if (take(ip)) return { ok: true, message: "" };

  const retryAfter = retryAfterSeconds(ip);
  return {
    ok: false,
    retryAfter,
    message: retryAfter
      ? `Слишком часто. Попробуйте ещё раз через ${retryAfter} с.`
      : "Слишком часто. Попробуйте позже.",
  };
}

/** True when the shared gate refused the submission. */
function isRejection(result: ForumFormResult): boolean {
  return result.message !== "";
}

/**
 * Text as it will be stored: converted to the allowed HTML and then sanitised.
 *
 * `forumTextToHtml` escapes as it builds, so the sanitiser normally finds nothing to
 * remove. It still runs — a second gate costs nothing, and it means a future change to
 * the converter cannot silently become the only thing standing between an anonymous
 * visitor and `dangerouslySetInnerHTML`.
 */
function toStoredHtml(text: string): string {
  return sanitizeForumHtml(forumTextToHtml(text));
}

export async function createForumTopicAction(
  formData: FormData,
): Promise<ForumFormResult> {
  if (isHoneypotFilled(formData)) {
    return { ok: false, message: "Заявка отклонена." };
  }

  const limited = await rateLimited();
  if (isRejection(limited)) return limited;

  const categorySlug = str(formData, "categorySlug");
  const authorName = clampForumText(str(formData, "authorName"), FORUM_NAME_MAX_LENGTH);
  const title = clampForumText(str(formData, "title"), FORUM_TITLE_MAX_LENGTH);
  const content = str(formData, "content");

  const fieldErrors: NonNullable<ForumFormResult["fieldErrors"]> = {};
  if (!authorName) fieldErrors.authorName = "Укажите имя.";
  if (!title) fieldErrors.title = "Укажите заголовок темы.";
  if (!content) {
    fieldErrors.content = "Напишите первое сообщение.";
  } else if (content.length > FORUM_POST_MAX_LENGTH) {
    fieldErrors.content = `Не больше ${FORUM_POST_MAX_LENGTH} символов.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: "Проверьте выделенные поля.", fieldErrors };
  }

  const category = await getForumCategoryBySlug(categorySlug);
  if (!category) {
    return { ok: false, message: "Раздел не найден — возможно, он удалён." };
  }

  const created = await createForumTopic({
    categoryId: category.id,
    title,
    authorName,
    contentHtml: toStoredHtml(content),
  });

  revalidatePath("/forum");
  revalidatePath(`/forum/${category.slug}`);

  // Post/redirect/get, so a refresh of the topic page does not repost. Called
  // outside any try/catch: redirect signals by throwing, and swallowing it would
  // turn a successful post into a silent no-op.
  redirect(`/forum/${category.slug}/${created.slug}`);
}

export async function createForumPostAction(
  formData: FormData,
): Promise<ForumFormResult> {
  if (isHoneypotFilled(formData)) {
    return { ok: false, message: "Заявка отклонена." };
  }

  const limited = await rateLimited();
  if (isRejection(limited)) return limited;

  const categorySlug = str(formData, "categorySlug");
  const topicSlug = str(formData, "topicSlug");
  const authorName = clampForumText(str(formData, "authorName"), FORUM_NAME_MAX_LENGTH);
  const content = str(formData, "content");

  const fieldErrors: NonNullable<ForumFormResult["fieldErrors"]> = {};
  if (!authorName) fieldErrors.authorName = "Укажите имя.";
  if (!content) {
    fieldErrors.content = "Напишите сообщение.";
  } else if (content.length > FORUM_POST_MAX_LENGTH) {
    fieldErrors.content = `Не больше ${FORUM_POST_MAX_LENGTH} символов.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, message: "Проверьте выделенные поля.", fieldErrors };
  }

  const topic = await getForumTopic(categorySlug, topicSlug);
  if (!topic) {
    return { ok: false, message: "Тема не найдена — возможно, она удалена." };
  }

  // Checked after the topic is loaded rather than from a form flag: the form says
  // what it was rendered with, and a moderator may have closed the thread in between.
  if (topic.isClosed) {
    return { ok: false, message: "Тема закрыта для новых ответов." };
  }

  await createForumPost({
    topicId: topic.id,
    authorName,
    contentHtml: toStoredHtml(content),
  });

  revalidatePath(`/forum/${categorySlug}/${topicSlug}`);
  revalidatePath(`/forum/${categorySlug}`);
  revalidatePath("/forum");

  redirect(`/forum/${categorySlug}/${topicSlug}`);
}