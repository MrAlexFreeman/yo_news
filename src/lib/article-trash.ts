import { rm } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { resolveUploadPath, UPLOAD_URL_PREFIX } from "@/lib/upload-dir";

/**
 * Trash rules for articles: what a soft delete writes, what putting it back writes, and
 * which files may be unlinked when a trashed story is destroyed for good.
 *
 * Deliberately free of `next/cache` and `next/navigation`. The actions in
 * `app/admin/articles/actions.ts` are thin wrappers that add revalidation; everything
 * with a consequence lives here, so `trash:check` can call the destructive path against a
 * real database and a real file. A module that only a React request handler can reach is
 * a module nobody tests, and this is the one that unlinks files.
 */

/** The columns the trash needs to do its job. */
export type TrashableArticle = {
  id: string;
  slug: string;
  coverImage: string | null;
};

/**
 * Resolves a stored cover value to a path inside the upload directory, or null.
 *
 * Null covers everything a blank field does, plus the two cases that would otherwise
 * be destructive: a remote URL, which belongs to somebody else, and a relative path
 * that resolves outside the directory — the same guard the /uploads route and the VK
 * cover upload use, applied here to a *write* rather than a read.
 */
export function localCoverPath(coverImage: string | null): string | null {
  if (!coverImage) return null;

  const trimmed = coverImage.trim();
  if (!trimmed.startsWith(UPLOAD_URL_PREFIX)) return null;
  if (/^https?:\/\//i.test(trimmed)) return null;

  return resolveUploadPath(trimmed.slice(UPLOAD_URL_PREFIX.length));
}

/**
 * Picks the covers that may be unlinked when these articles are destroyed for good.
 *
 * `stillReferenced` is the set of cover values used by articles that are *surviving* —
 * the ones the caller is not deleting. Two stories pointing at one uploaded file is
 * ordinary: an editor reuses a photo for a follow-up, and the deletion would otherwise
 * leave the survivor with a broken image and no way to tell why.
 *
 * Returning values rather than paths keeps the caller's existence check and unlink in
 * one place, and lets the test assert the decision without a filesystem.
 */
export function coversToRemove(
  articles: readonly TrashableArticle[],
  stillReferenced: readonly (string | null)[],
): string[] {
  const shared = new Set(
    stillReferenced
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  );

  const paths = new Set<string>();
  for (const article of articles) {
    const target = localCoverPath(article.coverImage);
    // Present among the survivors, so somebody else is still showing it.
    if (!target || shared.has(article.coverImage?.trim() ?? "")) continue;
    paths.add(target);
  }

  return [...paths];
}

/**
 * Every cached path whose contents change when these stories are trashed, restored or
 * destroyed.
 *
 * The collection paths are listed unconditionally and the per-story paths are added
 * from the slugs the caller already has, because a bulk delete can touch a dozen
 * articles and revalidating one shared list by hand is exactly the omission that
 * leaves a deleted headline on the front page for five minutes.
 *
 * A restored story needs its own page rebuilt too: while it was trashed the slug
 * resolved to a 404, and that 404 is the cached answer.
 */
export function revalidateArticlePaths(
  slugs: readonly string[],
  categorySlugs: readonly string[] = [],
  tagSlugs: readonly string[] = [],
): string[] {
  const paths = new Set<string>([
    "/",
    "/news",
    "/admin/articles",
    "/sitemap.xml",
    "/api/feed/dzen.xml",
    "/tags",
  ]);

  for (const slug of slugs) {
    if (slug) paths.add(`/news/${slug}`);
  }
  for (const slug of categorySlugs) {
    if (slug) paths.add(`/category/${slug}`);
  }
  for (const slug of tagSlugs) {
    if (slug) paths.add(`/tags/${slug}`);
  }

  return [...paths];
}

/** Human-readable summary for the admin notice. */
export function pluralArticles(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} материал`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} материала`;
  }
  return `${count} материалов`;
}

/** Ids arrive from a form, so empties, duplicates and non-strings are all possible. */
export function cleanIds(ids: readonly unknown[]): string[] {
  return [
    ...new Set(
      ids.filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
}

export type TrashOutcome = {
  /** False when there was nothing to do — the ids were empty, or already in that state. */
  ok: boolean;
  /** Rows actually written. Zero is what "уже в корзине" reports back to the editor. */
  count: number;
  /** Slug of every article the operation landed on, for revalidation. */
  slugs: string[];
  /** Rubric and tag listings those articles appeared in. */
  categorySlugs: string[];
  tagSlugs: string[];
};

/**
 * Moves articles to the trash.
 *
 * `deletedAt: null` in the filter, not only in the data: a second press of the button
 * must not restamp the deletion time, or the row would claim to have been removed later
 * than it was and the dates in the bin would disagree with the count on its tab.
 */
export async function markTrashed(
  ids: readonly unknown[],
): Promise<TrashOutcome> {
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return empty();

  const { count } = await prisma.article.updateMany({
    where: { id: { in: wanted }, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  if (count === 0) return empty();

  const affected = await describe(wanted);
  return { ok: true, count, ...affected };
}

/**
 * Puts articles back.
 *
 * The row is left exactly as it was — status, dates, views, tags — so restoring a
 * published story puts it straight back on the front page instead of as a draft. That is
 * the whole point of soft delete, and it is why this is not
 * `updateMany({ data: { status: "published" } })`.
 */
export async function restoreFromTrash(
  ids: readonly unknown[],
): Promise<TrashOutcome> {
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return empty();

  const { count } = await prisma.article.updateMany({
    where: { id: { in: wanted }, deletedAt: { not: null } },
    data: { deletedAt: null },
  });

  if (count === 0) return empty();

  const affected = await describe(wanted);
  return { ok: true, count, ...affected };
}

export type DestroyOutcome = TrashOutcome & {
  /** Basenames of the cover files that were unlinked, for the editor's notice. */
  removedFiles: string[];
};

/**
 * Drops trashed rows, and the files only they were using.
 *
 * The one irreversible operation in the admin, so both things that make it survivable
 * happen before a row is written: the ids are read from the trash — a published id
 * arriving here means a hand-made POST, and it must not be a shortcut past the confirm —
 * and every cover is checked against the survivors before anything is unlinked.
 */
export async function destroyForGood(
  ids: readonly unknown[],
): Promise<DestroyOutcome> {
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return { ...empty(), removedFiles: [] };

  const doomed = await prisma.article.findMany({
    where: { id: { in: wanted }, deletedAt: { not: null } },
    select: { id: true, slug: true, coverImage: true },
  });

  if (doomed.length === 0) return { ...empty(), removedFiles: [] };

  const doomedIds = doomed.map((article) => article.id);

  /*
    Covers still referenced by *any* article that is not being destroyed — and
    "not being destroyed" deliberately includes the ones sitting in the bin.

    An earlier version counted only published survivors, and `trash:check` caught it: it
    removed a picture that a trashed story was still pointing at, which is exactly the
    state a trash is supposed to prevent. Restoring that story would have brought back
    the article with a cover that no longer exists, and there is no way for an editor to
    tell that from an upload that failed years ago. A file is only orphaned once the last
    reference of any kind is gone.
  */
  const survivors = await prisma.article.findMany({
    where: { id: { notIn: doomedIds } },
    select: { coverImage: true },
  });

  const paths = coversToRemove(
    doomed,
    survivors.map((row) => row.coverImage),
  );
  const affected = await describe(doomedIds);

  await prisma.article.deleteMany({ where: { id: { in: doomedIds } } });

  /*
    Rows first, then files. In that order on purpose: a file removed first would leave a
    live story pointing at nothing if the database write then failed, while an orphaned
    file is harmless — it is only disk.

    Each unlink is reported on its own and never fatal. A permission problem on one
    picture must not leave a dozen rows in a state where the editor is told nothing
    happened.
  */
  const removedFiles: string[] = [];
  for (const target of paths) {
    try {
      await rm(target, { force: true });
      removedFiles.push(path.basename(target));
    } catch (error) {
      console.error("[trash] не удалось удалить файл обложки:", target, error);
    }
  }

  return {
    ok: true,
    count: doomed.length,
    slugs: doomed.map((article) => article.slug),
    categorySlugs: affected.categorySlugs,
    tagSlugs: affected.tagSlugs,
    removedFiles,
  };
}

/** How many articles are sitting in the bin, for the tab badge. */
export async function countTrashed(): Promise<number> {
  return prisma.article.count({ where: { deletedAt: { not: null } } });
}

function empty(): TrashOutcome {
  return { ok: false, count: 0, slugs: [], categorySlugs: [], tagSlugs: [] };
}

/** Slugs, rubric and tags of a set of articles — what has to be revalidated. */
async function describe(ids: string[]): Promise<{
  slugs: string[];
  categorySlugs: string[];
  tagSlugs: string[];
}> {
  const rows = await prisma.article.findMany({
    where: { id: { in: ids } },
    select: {
      slug: true,
      category: { select: { slug: true } },
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });

  const tagSlugs = new Set<string>();
  const categorySlugs = new Set<string>();
  for (const row of rows) {
    if (row.category) categorySlugs.add(row.category.slug);
    for (const link of row.tags) tagSlugs.add(link.tag.slug);
  }

  return {
    slugs: rows.map((row) => row.slug),
    categorySlugs: [...categorySlugs],
    tagSlugs: [...tagSlugs],
  };
}
