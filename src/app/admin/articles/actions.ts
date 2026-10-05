"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { Prisma } from "@/generated/prisma/client";
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
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slugify";
import { parseTagsField, syncArticleTags } from "@/lib/tags";
import { buildVideoEmbed, unsupportedVideoMessage } from "@/lib/video-embed";
import { publishArticleToVk, setVkTokenSource } from "@/lib/vk-publisher";
import { renameVkVideoForArticle } from "@/lib/vk-video";

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
 * to `new Date(...)`, which would read it in the *server's* zone вЂ” UTC on the
 * VPS вЂ” and silently shift every scheduled post by three hours.
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
 * Appends `-2`, `-3`, вЂ¦ until the slug is free. `excludeId` lets an article
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
 * Two buttons submit this action. "РЎРѕС…СЂР°РЅРёС‚СЊ" (intent=save) redirects to the
 * article list; "РџСЂРёРјРµРЅРёС‚СЊ" (intent=apply) returns the result so the editor
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
  if (!title) fieldErrors.title = "Р—Р°РіРѕР»РѕРІРѕРє РѕР±СЏР·Р°С‚РµР»РµРЅ.";
  if (!contentHtml) fieldErrors.contentHtml = "РўРµРєСЃС‚ РјР°С‚РµСЂРёР°Р»Р° РѕР±СЏР·Р°С‚РµР»РµРЅ.";

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

  // The sidebar owns the status. "РџСЂРёРјРµРЅРёС‚СЊ" used to force `published` here,
  // which silently published drafts the editor had deliberately left as drafts,
  // and made the segmented control in the sidebar a lie. Only the explicit
  // "РћРїСѓР±Р»РёРєРѕРІР°С‚СЊ" button sets the status, and it does so by submitting one.
  const requested = isArticleStatus(rawStatus) ? rawStatus : "draft";
  const status = intent === "publish" ? "published" : requested;

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      message: "РџСЂРѕРІРµСЂСЊС‚Рµ РІС‹РґРµР»РµРЅРЅС‹Рµ РїРѕР»СЏ.",
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
      message: "РњР°С‚РµСЂРёР°Р» РЅРµ РЅР°Р№РґРµРЅ вЂ” РІРѕР·РјРѕР¶РЅРѕ, РѕРЅ Р±С‹Р» СѓРґР°Р»С‘РЅ.",
    };
  }

  const slugBase = slugify(str(formData, "slug") || title);
  const slug = await uniqueSlug(slugBase, id || undefined);

  // Editorial rule: the Dzen experiment flag may only be granted at the moment of
  // first publication. Enforced here, not in the form вЂ” a disabled checkbox is a
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
    seoTitle: optional(str(formData, "seoTitle")),
    seoDescription: optional(str(formData, "seoDescription")),
    seoCanonicalUrl: optional(str(formData, "seoCanonicalUrl")),
    noIndex: checkbox(formData, "noIndex"),
    categoryId,
    isDzen: checkbox(formData, "isDzen"),
    isVk: checkbox(formData, "isVk"),
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
        console.warn(`[vk] СЂРµРїРѕСЃС‚ РЅРµ РІС‹РїРѕР»РЅРµРЅ: ${vk.error}`);
      }
    } catch (error) {
      console.error("[vk] РЅРµРѕР±СЂР°Р±РѕС‚Р°РЅРЅР°СЏ РѕС€РёР±РєР° СЂРµРїРѕСЃС‚Р°:", error);
    }
  }

  // Renaming a VK video is a nice-to-have on top of a publish that has already
  // happened, so it can only ever report. Wrapped twice: the helper never throws,
  // and this catch also covers a programming error in it, because losing the
  // publish would be a far worse outcome than a video with a stale name.
  //
  // Only on the transition into published: re-running on every edit would rewrite
  // an already-published video each time somebody corrected a typo.
  const enteringPublished = article.status === "published" && previousStatus !== "published";
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
        vkVideoWarning = `Р’РёРґРµРѕ РІ Р’Рљ РЅРµ РїРµСЂРµРёРјРµРЅРѕРІР°РЅРѕ: ${renamed.error}`;
        console.warn(`[vk-video] ${vkVideoWarning}`);
      }
    } catch (error) {
      console.error("[vk-video] РЅРµРѕР±СЂР°Р±РѕС‚Р°РЅРЅР°СЏ РѕС€РёР±РєР° РїРµСЂРµРёРјРµРЅРѕРІР°РЅРёСЏ", error);
    }
  }

  // The reposter reads the token through the settings service so a token pasted in
// /admin/settings takes effect without a restart. The source is installed here
// rather than imported inside vk-publisher so that module stays importable from
// the vk:check suite, which stubs VK's HTTP layer.
setVkTokenSource();

revalidatePath("/admin/articles");
  // The public storefront is statically rendered with ISR, so a newly published
  // story (or an edited one) is invisible until those paths are revalidated.
  // Without this the editor hits "РћРїСѓР±Р»РёРєРѕРІР°С‚СЊ" and sees no change on the site.
  revalidatePath("/");
  revalidatePath(`/news/${article.slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/api/feed/dzen.xml");

  if (categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: { slug: true },
    });
    if (category) revalidatePath(`/category/${category.slug}`);
  }

  // Tag listings show this story, so they go stale the moment it gains or loses a
  // tag вЂ” including the ones it just lost, which still list it.
  revalidatePath("/tags");
  for (const slug of tagSlugs) {
    revalidatePath(`/tags/${slug}`);
  }

  // "РЎРѕС…СЂР°РЅРёС‚СЊ" leaves the editor; "РџСЂРёРјРµРЅРёС‚СЊ" reports back in place.
  if (intent === "save") {
    redirect("/admin/articles");
  }

  // Echoed back so the editor sees *why* the checkbox is locked and whether their
  // submitted value was accepted. Silently ignoring a checked box is the one
  // outcome that would leave an editor believing an experiment is running.
  const experimentRejected = dzenExperimentLocked && checkbox(formData, "dzenExperiment");

  return {
    ok: true,
    message: [
      id ? "РњР°С‚РµСЂРёР°Р» РѕР±РЅРѕРІР»С‘РЅ." : "РњР°С‚РµСЂРёР°Р» СЃРѕР·РґР°РЅ.",
      experimentRejected
        ? `Р­РєСЃРїРµСЂРёРјРµРЅС‚ СЃ Р”Р·РµРЅ РЅРµ РІРєР»СЋС‡С‘РЅ: ${DZEN_EXPERIMENT_LOCKED_HINT}.`
        : "",
      vkVideoWarning ?? "",
    ]
      .filter(Boolean)
      .join(" "),
    id: article.id,
    slug: article.slug,
    dzenQueued: article.status === "published" && article.isDzen,
    dzenExperiment: article.dzenExperiment,
    dzenExperimentLocked,
    vkQueued: article.status === "published" && article.isVk,
    vkPostId,
  };
}

/** Removes an article. Used by the "РЈРґР°Р»РёС‚СЊ" button. */
export async function deleteArticleAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const id = str(formData, "id");
  if (!id) {
    return { ok: false, message: "РќРµС‡РµРіРѕ СѓРґР°Р»СЏС‚СЊ: РјР°С‚РµСЂРёР°Р» РµС‰С‘ РЅРµ СЃРѕС…СЂР°РЅС‘РЅ." };
  }

  try {
    await prisma.article.delete({ where: { id } });
  } catch {
    return { ok: false, message: "РњР°С‚РµСЂРёР°Р» РЅРµ РЅР°Р№РґРµРЅ вЂ” РІРѕР·РјРѕР¶РЅРѕ, РѕРЅ СѓР¶Рµ СѓРґР°Р»С‘РЅ." };
  }

  revalidatePath("/admin/articles");

  if (str(formData, "intent") === "save") {
    redirect("/admin/articles");
  }

  return { ok: true, message: "РњР°С‚РµСЂРёР°Р» СѓРґР°Р»С‘РЅ." };
}
