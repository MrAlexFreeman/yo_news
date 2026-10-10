"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
import {
  destroyForGood,
  markTrashed,
  pluralArticles,
  restoreFromTrash,
  revalidateArticlePaths,
} from "@/lib/article-trash";
import type { SaveArticleResult } from "@/app/admin/articles/types";
import { normalizeArticleHtml } from "@/lib/article-html";
import { isArticleStatus } from "@/lib/article-status";
import { buildSearchText } from "@/lib/article-search";
import { parseMediaField } from "@/lib/article-media";
import {
  DZEN_EXPERIMENT_LOCKED_HINT,
  canSetDzenExperiment,
  resolveDzenExperiment,
} from "@/lib/dzen-experiment";
import { takeFeedItem } from "@/lib/feed-store";
import { prisma } from "@/lib/prisma";
import { saveMessage } from "@/lib/save-message";
import { slugify } from "@/lib/slugify";
import { stockCreditColumns } from "@/lib/stock-credit";
import { parseTagsField, syncArticleTags } from "@/lib/tags";
import { buildVideoEmbed, unsupportedVideoMessage } from "@/lib/video-embed";
import { publishArticleToVk, setVkTokenSource } from "@/lib/vk-publisher";
import { decideVkRepost } from "@/lib/vk-dedupe";
import { claimVkPost, finishVkPost, releaseVkPost } from "@/lib/vk-claim";
import { renameVkVideoForArticle } from "@/lib/vk-video";
import {
  publishArticleToTelegram,
  setTelegramConfigSource,
} from "@/lib/telegram-publisher";
import { publishArticleToMax, setMaxConfigSource } from "@/lib/max-publisher";

/** Absolute base for links handed to a third party, e.g. the VK video description. */
function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (configured && configured.length > 0 ? configured : "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

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
 * Turns the gallery mirror into what goes in the `media` column.
 *
 * SQL NULL rather than `[]` for an empty gallery: a story with no photos should
 * be indistinguishable in the database from one written before the column
 * existed, and every read path already treats both as "no gallery".
 */
function mediaColumn(raw: string): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const items = parseMediaField(raw);
  if (items.length === 0) return Prisma.JsonNull;
  return items as unknown as Prisma.InputJsonValue;
}

/**
 * `datetime-local` sends "2026-10-01T12:30" with no timezone. That is the
 * editor's wall clock in Moscow, so it is converted explicitly rather than left
 * to `new Date(...)`, which would read it in the *server's* zone — UTC on the
 * VPS — and silently shift every scheduled post by three hours.
 */
const EDITOR_TIME_ZONE = "Europe/Moscow";

function publicationDate(formData: FormData): Date | null {
  const raw = str(formData, "publishedAt");
  if (!raw) return null;

  // "YYYY-MM-DDTHH:mm" read as UTC, then re-read in Moscow: if the wall-clock
  // fields survive the round trip, the offset applied is the Moscow one.
  const asUtc = Date.parse(`${raw}:00Z`);
  if (Number.isNaN(asUtc)) return null;

  const wallClock = new Date(asUtc);
  const offsetMinutes = moscowOffsetMinutes(wallClock);
  return new Date(asUtc - offsetMinutes * 60_000);
}

/**
 * Moscow's UTC offset in minutes for the given instant, DST included.
 * `Intl` is asked rather than hardcoding +180 so the published dates stay right
 * across a future change to Russia's timezone rules.
 */
function moscowOffsetMinutes(at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: EDITOR_TIME_ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  // `hour` comes back as 24 at midnight under hour12:false in some ICU builds.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    parts.minute,
    parts.second,
  );

  return (asUtc - at.getTime()) / 60_000;
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

  // Validated here rather than trusted from the form: the same hidden mirror that
  // makes the field survive a tab switch is also a plain text field an editor can
  // edit by hand, and a link we cannot turn into a player is a dead field that
  // looks fine in the list.
  const rawVideoUrl = str(formData, "videoUrl");
  let videoUrl: string | null = null;
  if (rawVideoUrl) {
    if (buildVideoEmbed(rawVideoUrl)) {
      videoUrl = rawVideoUrl;
    } else {
      fieldErrors.videoUrl = unsupportedVideoMessage(rawVideoUrl);
    }
  }

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

  // The sidebar owns the status. "Применить" used to force `published` here,
  // which silently published drafts the editor had deliberately left as drafts,
  // and made the segmented control in the sidebar a lie. Only the explicit
  // "Опубликовать" button sets the status, and it does so by submitting one.
  const requested = isArticleStatus(rawStatus) ? rawStatus : "draft";
  const status = intent === "publish" ? "published" : requested;

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

  // Loaded only on update, to keep the original publishedAt intact. The current
  // tag slugs come along too: they are the paths whose cached pages have to be
  // revalidated if this save moves a tag on or off the story.
  const existing = id
    ? await prisma.article.findUnique({
        where: { id },
        select: {
          id: true,
          publishedAt: true,
          status: true,
          dzenExperiment: true,
          vkPostId: true,
          tags: { select: { tag: { select: { slug: true } } } },
        },
      })
    : null;

  /** Status before this save, so a transition into published can be detected. */
  const previousStatus = isArticleStatus(existing?.status) ? existing.status : "draft";

  if (id && !existing) {
    // No id echoed back: the record is gone, so the next save must create anew.
    return {
      ok: false,
      message: "Материал не найден — возможно, он был удалён.",
    };
  }

  const slugBase = slugify(str(formData, "slug") || title);
  const slug = await uniqueSlug(slugBase, id || undefined);

  // Editorial rule: the Dzen experiment flag may only be granted at the moment of
  // first publication. Enforced here, not in the form — a disabled checkbox is a
  // UI convention, and this handler is reachable by any POST that carries the
  // Basic Auth header.
  const chosenDate = publicationDate(formData);
  const dzenExperimentLocked = !canSetDzenExperiment({
    storedPublishedAt: existing?.publishedAt ?? null,
    chosenPublishedAt: chosenDate,
  });
  const dzenExperiment = resolveDzenExperiment({
    submitted: checkbox(formData, "dzenExperiment"),
    stored: existing?.dzenExperiment ?? false,
    storedPublishedAt: existing?.publishedAt ?? null,
    chosenPublishedAt: chosenDate,
  });

  const data = {
    title,
    subtitle: optional(str(formData, "subtitle")),
    slug,
    lead: optional(str(formData, "lead")),
    contentHtml: normalizeArticleHtml(contentHtml),
    coverImage: optional(str(formData, "coverImage")),
    photoAuthor: optional(str(formData, "photoAuthor")),
    photoSource: optional(str(formData, "photoSource")),
    // The four stock fields, taken together or not at all.
    //
    // They come out of the same `FormData` as everything else, so they are as editable
    // as any other hidden field — which is why they are re-checked here rather than
    // trusted. `stockCreditLinks` is the same function the public caption uses, so what is
    // stored and what is rendered cannot come to disagree, and a hand-written value that
    // is not an Unsplash https address is dropped rather than printed as a credit.
    ...stockCreditColumns(formData),
    seoTitle: optional(str(formData, "seoTitle")),
    seoDescription: optional(str(formData, "seoDescription")),
    seoCanonicalUrl: optional(str(formData, "seoCanonicalUrl")),
    noIndex: checkbox(formData, "noIndex"),
    categoryId,
    isDzen: checkbox(formData, "isDzen"),
    isVk: checkbox(formData, "isVk"),
    isTelegram: checkbox(formData, "isTelegram"),
    isMax: checkbox(formData, "isMax"),
    isExclusive: checkbox(formData, "isExclusive"),
    is18plus: checkbox(formData, "is18plus"),
    videoUrl,
    media: mediaColumn(str(formData, "media")),
    // Maintained on every write, not backfilled once: the editor's search box is the
    // only reader, and a stale index would quietly return the wrong story.
    searchText: buildSearchText(title, str(formData, "lead")),
    dzenExperiment,
    dzenDirect: checkbox(formData, "dzenDirect"),
    status,
  };

  // The date is kept for drafts too, so an editor can schedule a story ahead of
  // time and simply flip the status to publish later. Visibility is decided by
  // `status`, never by this column, so a scheduled draft stays off the site.
  const tagNames = parseTagsField(str(formData, "tags"));

  // The row write and the tag sync share one transaction: a tag set half-written
  // against a saved article is exactly the state nobody wants to debug later.
  const article = await prisma.$transaction(async (tx) => {
    const row = id
      ? await tx.article.update({
          where: { id },
          data: {
            ...data,
            publishedAt: chosenDate ?? existing?.publishedAt ?? new Date(),
          },
        })
      : await tx.article.create({
          data: {
            ...data,
            publishedAt: chosenDate ?? new Date(),
          },
        });

    await syncArticleTags(tx, row.id, tagNames);
    return row;
  });

  // The tag pages that changed: the ones this story now carries, plus the ones it
  // used to carry and no longer does.
  const attachedTags = await prisma.tag.findMany({
    where: { articles: { some: { articleId: article.id } } },
    select: { slug: true },
  });

  const tagSlugs = new Set(attachedTags.map((tag) => tag.slug));
  for (const previous of existing?.tags ?? []) {
    if (!tagSlugs.has(previous.tag.slug)) tagSlugs.add(previous.tag.slug);
  }

  /*
    The wire item this draft came from is marked as taken, so «Предложка» stops
    offering it. Wrapped and guarded: a failure here would cost the editor the article
    they just wrote, and the worst case without it is an item appearing twice on a list.

    Only on create, and only from NEW — opening a hidden item and writing a story from it
    is not a reason to move it out of the hidden tab.
  */
  const feedId = str(formData, "feedId");
  if (feedId && !id) {
    try {
      await takeFeedItem(feedId);
      revalidatePath("/admin/feed");
    } catch (error) {
      console.warn("[feed] не удалось отметить инфоповод как использованный", error);
    }
  }

  /*
    The rubric name, read once and used for two things: revalidating the category page
    below, and the closing hashtag in a messenger post. A post tagged with the rubric
    it actually carries is what makes a channel searchable, and fetching it here rather
    than inside each publisher keeps both of them free of database access.
  */
  const category = categoryId
    ? await prisma.category.findUnique({
        where: { id: categoryId },
        select: { slug: true, name: true },
      })
    : null;

  // True only on the transition into published. The messengers post a *story*, not a
  // revision of one: reposting on every save would put the same headline in a channel
  // each time somebody fixed a typo. The checkboxes therefore also arrive unchecked
  // when an already-published story is opened for editing — see [id]/edit/page.tsx —
  // but this is the guarantee, and the checkboxes are only the courtesy.
  const enteringPublished = article.status === "published" && previousStatus !== "published";

  /*
    Repost to the VK community wall, guarded twice.

    The first guard is `decideVkRepost`, and it is the fix for the duplicates. This branch
    used to ask only `article.status === "published" && article.isVk` where Telegram and MAX
    ask whether the story is *entering* published — so a story stayed eligible on every
    later save and each one put the headline on the wall again.

    The second guard is the row. Two saves at once — a double-clicked button, a retry after
    a timeout, two tabs on one story — both read the row before either writes, and both
    decide they are first. So the check and the claim are the same statement: an UPDATE
    that only matches while `vkPostId` is still null, of which exactly one can succeed.

    Wrapped so nothing VK does can roll back the database write.
  */
  const vkDecision = decideVkRepost({
    previousStatus,
    status,
    isVk: article.isVk,
    storedPostId: existing?.vkPostId ?? null,
  });

  let vkPostId: string | null = null;
  /** True only when this request actually put something on the wall. */
  let vkPosted = false;
  /** Reported back so a failed repost is visible to the editor instead of only to the console. */
  let vkError: string | null = null;
  /** Shown when the story was already on the wall and this save deliberately skipped it. */
  let vkSkipNote: string | null = null;

  if (vkDecision === "already-posted") {
    vkPostId = existing?.vkPostId ?? null;
    vkSkipNote = vkPostId
      ? "Уже было в ВК — повторно не публикуем."
      : "Материал уже опубликован; репост в ВК делается только при первой публикации.";
  } else if (vkDecision === "publish") {
    const outcome = await claimVkPost(prisma, article.id);

    if (!outcome.claimed) {
      // Somebody else won the race. Their post may already be recorded, in which case this
      // story did go out and the editor should not be told anything failed.
      vkPostId = outcome.alreadyPosted ? (existing?.vkPostId ?? null) : null;
      vkSkipNote = outcome.alreadyPosted
        ? "Уже было в ВК — повторно не публикуем."
        : "Публикация в ВК уже выполняется другим запросом — повторно не публикуем.";
    } else {
      try {
        const vk = await publishArticleToVk({
          title: article.title,
          lead: article.lead,
          slug: article.slug,
          coverImage: article.coverImage,
        });

        if (vk.ok) {
          vkPosted = true;
          vkPostId = vk.postId ?? null;
          // Recorded before anything else: this id is the only thing that stops the next
          // save from posting again, so it is written the moment VK confirms.
          await finishVkPost(prisma, article.id, vkPostId);
          if (vk.warning) console.warn(`[vk] ${vk.warning}`);
        } else {
          vkError = vk.error ?? "ВК не принял публикацию.";
          // The claim goes back so the next save can try again. A story that failed because
          // VK was down should not be permanently barred from the wall by its own outage.
          await releaseVkPost(prisma, article.id);
          console.warn(`[vk] репост не выполнен: ${vkError}`);
        }
      } catch (error) {
        vkError = error instanceof Error ? error.message : "непредвиденная ошибка репоста";
        await releaseVkPost(prisma, article.id).catch(() => {});
        console.error("[vk] необработанная ошибка репоста:", error);
      }
    }
  }

  /*
    Telegram and MAX, both on first publication only and both wrapped so nothing they
    do can fail the save.

    Sequential rather than parallel on purpose: both upload the same cover, and two
    concurrent reads of one file from two providers is a way to make a publish slow for
    no gain. Each call is seconds at most.

    A "not configured" result is not an error to shout about. `maxEnabled` defaults to
    off and `telegramEnabled` to on, so the common case on an install that has set up
    neither is that one messenger is quietly skipped and the other reports what it did.
    That distinction is preserved in the note rather than flattened into "failed".
  */
  const messengerNotes: Record<"telegram" | "max", string | null> = {
    telegram: null,
    max: null,
  };

  if (enteringPublished && (article.isTelegram || article.isMax)) {
    const shared = {
      title: article.title,
      contentHtml: article.contentHtml,
      slug: article.slug,
      categoryName: category?.name ?? null,
      coverImage: article.coverImage,
    };

    if (article.isTelegram) {
      try {
        const telegram = await publishArticleToTelegram(shared);
        messengerNotes.telegram = telegram.ok
          ? (telegram.summary ?? "опубликовано.")
          : `не ушло: ${telegram.error ?? "причина неизвестна"}`;
        if (telegram.warning) console.warn(`[telegram] ${telegram.warning}`);
      } catch (error) {
        messengerNotes.telegram = `необработанная ошибка: ${
          error instanceof Error ? error.message : "неизвестная ошибка"
        }`;
        console.error("[telegram] необработанная ошибка репоста:", error);
      }
    }

    if (article.isMax) {
      try {
        const max = await publishArticleToMax(shared);
        messengerNotes.max = max.ok
          ? (max.summary ?? "опубликовано.")
          : `не ушло: ${max.error ?? "причина неизвестна"}`;
        if (max.warning) console.warn(`[max] ${max.warning}`);
      } catch (error) {
        messengerNotes.max = `необработанная ошибка: ${
          error instanceof Error ? error.message : "неизвестная ошибка"
        }`;
        console.error("[max] необработанная ошибка репоста:", error);
      }
    }
  }

  // Renaming a VK video is a nice-to-have on top of a publish that has already
  // happened, so it can only ever report. Wrapped twice: the helper never throws,
  // and this catch also covers a programming error in it, because losing the
  // publish would be a far worse outcome than a video with a stale name.
  let vkVideoWarning: string | undefined;

  if (enteringPublished) {
    try {
      const renamed = await renameVkVideoForArticle({
        videoUrl: article.videoUrl,
        title: article.title,
        lead: article.lead,
        slug: article.slug,
        baseUrl: siteUrl(),
      });
      if (!renamed.ok && renamed.error) {
        vkVideoWarning = `Видео в ВК не переименовано: ${renamed.error}`;
        console.warn(`[vk-video] ${vkVideoWarning}`);
      }
    } catch (error) {
      console.error("[vk-video] необработанная ошибка переименования", error);
    }
  }

  /*
    The three reposters read their tokens through the settings service, so a token
    pasted in /admin/settings takes effect without a restart. The sources are installed
    here rather than imported inside the publishers, because those modules have to stay
    importable from a test suite that stubs the HTTP layer — and `@/lib/settings` is
    `server-only`, which throws the moment it is loaded outside a Server Component.
  */
  setVkTokenSource();
  setTelegramConfigSource();
  setMaxConfigSource();
  revalidatePath("/admin/articles");
  // The public storefront is statically rendered with ISR, so a newly published
  // story (or an edited one) is invisible until those paths are revalidated.
  // Without this the editor hits "Опубликовать" and sees no change on the site.
  revalidatePath("/");
  revalidatePath(`/news/${article.slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/api/feed/dzen.xml");

  if (category) revalidatePath(`/category/${category.slug}`);

  // Tag listings show this story, so they go stale the moment it gains or loses a
  // tag — including the ones it just lost, which still list it.
  revalidatePath("/tags");
  for (const slug of tagSlugs) {
    revalidatePath(`/tags/${slug}`);
  }

  // "Сохранить" leaves the editor; "Применить" reports back in place.
  if (intent === "save") {
    redirect("/admin/articles");
  }

  // Echoed back so the editor sees *why* the checkbox is locked and whether their
  // submitted value was accepted. Silently ignoring a checked box is the one
  // outcome that would leave an editor believing an experiment is running.
  const experimentRejected = dzenExperimentLocked && checkbox(formData, "dzenExperiment");

  return {
    ok: true,
    message: saveMessage({
      isUpdate: Boolean(id),
      experimentRejected,
      experimentHint: DZEN_EXPERIMENT_LOCKED_HINT,
      vkVideoWarning,
    }),
    id: article.id,
    slug: article.slug,
    dzenQueued: article.status === "published" && article.isDzen,
    dzenExperiment: article.dzenExperiment,
    dzenExperimentLocked,
    /*
      True only if this save put the story on the wall.
      Was `article.status === "published" && article.isVk`, which reported "queued" for a
      post that had been skipped as a duplicate, had failed, or had never been attempted —
      an editor reading it had no way to tell any of those apart.
    */
    vkQueued: vkPosted,
    vkPostId,
    vkError,
    vkSkipNote,
    messengerNotes,
  };
}

/** Removes an article. Used by the "В корзину" button. */
export async function deleteArticleAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const id = str(formData, "id");
  if (!id) {
    return { ok: false, message: "Нечего удалять: материал ещё не сохранён." };
  }

  /*
    Moves to the trash rather than deleting the row.

    This used to be `prisma.article.delete`, and the button promised "без возможности
    восстановления". With a trash on the list page that promise is a trap: an editor who
    meant "this is not going out today" would lose the story, its tags and its slug, and
    the only route back would be the database. The irreversible version still exists — it
    lives in the trash tab, behind a second confirmation, where the button says exactly
    that.
  */
  const result = await softDeleteArticles([id]);
  if (!result.ok) return result;

  if (str(formData, "intent") === "save") {
    redirect("/admin/articles");
  }

  return { ok: true, message: "Материал перемещён в корзину." };
}

/**
 * Moves articles to the trash.
 *
 * `ids` is `string[]` and not the `number[]` a reader might expect: `Article.id` is a
 * `cuid()`, not a row number, so there is no integer to pass. The list is treated as
 * untrusted anyway — it arrives from a form — and cleaned in the store.
 */
export async function softDeleteArticles(
  ids: string[],
): Promise<{ ok: boolean; message: string }> {
  const result = await markTrashed(ids);
  if (!result.ok) {
    return { ok: false, message: "Нечего удалять: материалы уже в корзине." };
  }

  revalidateTrashed(result);
  return { ok: true, message: `В корзину: ${pluralArticles(result.count)}.` };
}

/** Puts articles back, whole and exactly as they were. */
export async function restoreArticles(
  ids: string[],
): Promise<{ ok: boolean; message: string }> {
  const result = await restoreFromTrash(ids);
  if (!result.ok) {
    return { ok: false, message: "Нечего восстанавливать: материалы не в корзине." };
  }

  revalidateTrashed(result);
  return { ok: true, message: `Восстановлено: ${pluralArticles(result.count)}.` };
}

/**
 * Destroys trashed articles for good, together with the cover files only they used.
 *
 * The wording in the confirm dialog is the real guard against a mistake here; this
 * handler's own protection is that it refuses any id that is not already in the bin, so
 * a crafted POST cannot turn the trash tab into a shortcut past the live list.
 */
export async function hardDeleteArticles(
  ids: string[],
): Promise<{ ok: boolean; message: string }> {
  const result = await destroyForGood(ids);
  if (!result.ok) {
    return {
      ok: false,
      message: "Ни один из выбранных материалов не лежит в корзине.",
    };
  }

  revalidateTrashed(result);

  return {
    ok: true,
    message: [
      `Удалено навсегда: ${pluralArticles(result.count)}.`,
      result.removedFiles.length > 0
        ? `Файлов обложек удалено: ${result.removedFiles.length}.`
        : "Файлы обложек удалять было нечего.",
    ].join(" "),
  };
}

/** Invalidates every cached copy whose contents just changed. */
function revalidateTrashed(result: {
  slugs: string[];
  categorySlugs: string[];
  tagSlugs: string[];
}): void {
  for (const path of revalidateArticlePaths(
    result.slugs,
    result.categorySlugs,
    result.tagSlugs,
  )) {
    revalidatePath(path);
  }
}
