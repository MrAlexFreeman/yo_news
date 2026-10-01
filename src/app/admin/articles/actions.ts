"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { SaveArticleResult } from "@/app/admin/articles/types";
import { isArticleStatus } from "@/lib/article-status";
import { prisma } from "@/lib/prisma";
import { publishArticleToVk } from "@/lib/vk-publisher";

function str(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optional(value: string): string | null {
  return value.length > 0 ? value : null;
}

function checkbox(formData: FormData, key: string): boolean {
  const value = formData.get(key);
  return value === "on" || value === "true" || value === "1";
}

/**
 * `datetime-local` sends "2026-10-01T12:30" with no timezone. `new Date`
 * parses that in the server's local zone, which is what the editor expects —
 * the same wall-clock time they typed.
 */
function publicationDate(formData: FormData): Date | null {
  const raw = str(formData, "publishedAt");
  if (!raw) return null;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

/**
 * Turns a Russian title into a URL slug. Falls back to a stable placeholder
 * when the title is entirely non-Latin, since `slug` is required and unique.
 */
function slugify(title: string): string {
  const transliterated = title
    .toLowerCase()
    .replace(/[Ѐ-ӿ]/g, (char) => TRANSLIT[char] ?? "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return transliterated || "material";
}

/**
 * Appends `-2`, `-3`, … until the slug is free. `excludeId` lets an article
 * keep its own slug when re-saved after a title edit.
 */
async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let suffix = 1;

  for (;;) {
    const clash = await prisma.article.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash || clash.id === excludeId) return candidate;

    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

/**
 * Creates the article, or updates it when `id` is present.
 *
 * Two buttons submit this action. "Сохранить" (intent=save) redirects to the
 * article list; "Применить" (intent=apply) returns the result so the editor
 * stays on the page.
 */
export async function createArticleAction(
  formData: FormData,
): Promise<SaveArticleResult> {
  const id = str(formData, "id");
  const intent = str(formData, "intent");

  const title = str(formData, "title");
  const contentHtml = str(formData, "contentHtml");
  const rawStatus = str(formData, "status");

  const fieldErrors: SaveArticleResult["fieldErrors"] = {};
  if (!title) fieldErrors.title = "Заголовок обязателен.";
  if (!contentHtml) fieldErrors.contentHtml = "Текст материала обязателен.";

  const rawCategoryId = str(formData, "categoryId");
  let categoryId: string | null = null;
  if (rawCategoryId) {
    // The dropdown falls back to synthetic ids when the table is empty; those
    // never match a real row, so treat an unknown id as "no rubric" instead of
    // blocking the save.
    const category = await prisma.category.findUnique({
      where: { id: rawCategoryId },
      select: { id: true },
    });
    categoryId = category?.id ?? null;
  }

  const status =
    intent === "apply"
      ? "published"
      : isArticleStatus(rawStatus)
        ? rawStatus
        : "draft";

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: "Проверьте выделенные поля.",
      fieldErrors,
      // Echoed back so the client keeps submitting an update, not a fresh
      // create, after a rejected save.
      ...(id ? { id } : {}),
    };
  }

  // Loaded only on update, to keep the original publishedAt intact.
  const existing = id
    ? await prisma.article.findUnique({
        where: { id },
        select: { id: true, publishedAt: true },
      })
    : null;

  if (id && !existing) {
    // No id echoed back: the record is gone, so the next save must create anew.
    return {
      ok: false,
      message: "Материал не найден — возможно, он был удалён.",
    };
  }

  const slugBase = slugify(str(formData, "slug") || title);
  const slug = await uniqueSlug(slugBase, id || undefined);

  const data = {
    title,
    subtitle: optional(str(formData, "subtitle")),
    slug,
    lead: optional(str(formData, "lead")),
    contentHtml,
    coverImage: optional(str(formData, "coverImage")),
    categoryId,
    isDzen: checkbox(formData, "isDzen"),
    isVk: checkbox(formData, "isVk"),
    isExclusive: checkbox(formData, "isExclusive"),
    is18plus: checkbox(formData, "is18plus"),
    status,
  };

  const chosenDate = publicationDate(formData);

  const article = id
    ? await prisma.article.update({
        where: { id },
        data: {
          ...data,
          // publishedAt records the first publication and must survive re-saves
          // unless the editor explicitly moves the date.
          ...(status === "published"
            ? { publishedAt: chosenDate ?? existing?.publishedAt ?? new Date() }
            : {}),
        },
      })
    : await prisma.article.create({
        data: {
          ...data,
          // A draft keeps a null date so it can be scheduled later.
          ...(status === "published" ? { publishedAt: chosenDate ?? new Date() } : {}),
        },
      });

  // Repost to VK when the article goes live with the flag on. Wrapped so a
  // missing token or a VK outage never rolls back the database write.
  let vkPostId: string | null = null;
  if (article.status === "published" && article.isVk) {
    try {
      const vk = await publishArticleToVk({
        title: article.title,
        lead: article.lead,
        slug: article.slug,
        coverImage: article.coverImage,
      });

      if (vk.ok) {
        vkPostId = vk.postId ?? null;
        if (vk.warning) console.warn(`[vk] ${vk.warning}`);
      } else {
        console.warn(`[vk] репост не выполнен: ${vk.error}`);
      }
    } catch (error) {
      console.error("[vk] необработанная ошибка репоста:", error);
    }
  }

  revalidatePath("/admin/articles");
  revalidatePath("/");

  // "Сохранить" leaves the editor; "Применить" reports back in place.
  if (intent === "save") {
    redirect("/admin/articles");
  }

  return {
    ok: true,
    message: id ? "Материал обновлён." : "Материал создан.",
    id: article.id,
    slug: article.slug,
    dzenQueued: article.status === "published" && article.isDzen,
    vkQueued: article.status === "published" && article.isVk,
    vkPostId,
  };
}

/** Removes an article. Used by the "Удалить" button. */
export async function deleteArticleAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const id = str(formData, "id");
  if (!id) {
    return { ok: false, message: "Нечего удалять: материал ещё не сохранён." };
  }

  try {
    await prisma.article.delete({ where: { id } });
  } catch {
    return { ok: false, message: "Материал не найден — возможно, он уже удалён." };
  }

  revalidatePath("/admin/articles");

  if (str(formData, "intent") === "save") {
    redirect("/admin/articles");
  }

  return { ok: true, message: "Материал удалён." };
}
