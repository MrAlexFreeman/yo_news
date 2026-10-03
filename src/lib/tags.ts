import { slugify } from "@/lib/slugify";

/**
 * Tag normalisation and persistence.
 *
 * Two things make this more than a loop over the input:
 *
 * - Case-insensitive uniqueness. The design asked for COLLATE NOCASE, but
 *   SQLite's built-in NOCASE folds ASCII only. Measured: it rejects
 *   "artificial intelligence" as a duplicate of "Artificial Intelligence" and
 *   accepts both "Искусственный интеллект" and "искусственный интеллект".
 *   Every tag on this site is Russian, so uniqueness lives on `nameKey`, a
 *   lowercased copy computed here.
 *
 * - Slug collisions. Transliteration collapses «Искусственный интеллект» and
 *   «Искусственый интеллект» onto the same slug, and slug is unique, so a
 *   second tag with the same slug has to get a suffix rather than throw.
 */

/** Long enough for a phrase, short enough to stay a slug. */
const MAX_TAG_LENGTH = 50;
const MAX_TAGS_PER_ARTICLE = 12;

export type TagInput = {
  id: number;
  name: string;
  slug: string;
};

/** Trims and collapses inner whitespace without changing the editor's casing. */
export function normalizeTagName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
}

/** The dedup key: same letters, same key, whatever the casing. */
export function tagKey(value: string): string {
  return normalizeTagName(value).toLowerCase();
}

/** Drops blanks and duplicates by key, keeping the first spelling seen. */
export function normalizeTagList(values: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const value of values) {
    const name = normalizeTagName(value);
    const key = tagKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names.slice(0, MAX_TAGS_PER_ARTICLE);
}

/** Splits the comma-separated form field the editor submits. */
export function parseTagsField(raw: string): string[] {
  return normalizeTagList(raw.split(","));
}

export { MAX_TAGS_PER_ARTICLE, MAX_TAG_LENGTH };

type TagDelegate = {
  findUnique(args: { where: { nameKey: string } }): Promise<TagInput | null>;
  create(args: { data: { name: string; nameKey: string; slug: string } }): Promise<TagInput>;
  findMany(args: { where: { slug: { in: string[] } } }): Promise<TagInput[]>;
};

type JoinDelegate = {
  deleteMany(args: { where: { articleId: string } }): Promise<unknown>;
  createMany(args: { data: { articleId: string; tagId: number }[] }): Promise<unknown>;
};

/**
 * Makes the database agree with `names` for this article.
 *
 * Runs inside the caller's transaction so a failed save cannot leave the article
 * pointing at a tag set that was half-written. Returns the tags now attached,
 * which the caller needs to revalidate their public pages.
 *
 * `tx` is the transaction client; typing it structurally keeps this module free
 * of a Prisma import that would drag the generated client into the client
 * bundle when the tag input renders.
 */
export async function syncArticleTags(
  tx: { tag: TagDelegate; articleTag: JoinDelegate },
  articleId: string,
  names: string[],
): Promise<TagInput[]> {
  const wanted = normalizeTagList(names);
  const resolved: TagInput[] = [];

  for (const name of wanted) {
    const key = tagKey(name);
    const existing = await tx.tag.findUnique({ where: { nameKey: key } });
    if (existing) {
      resolved.push(existing);
      continue;
    }

    // Try the preferred slug; on a transliteration collision, suffix it.
    const base = slugify(name);
    let slug = base;
    for (let attempt = 2; attempt < 200; attempt += 1) {
      const taken = await tx.tag.findMany({ where: { slug: { in: [slug] } } });
      if (taken.length === 0) break;
      slug = `${base}-${attempt}`;
    }

    resolved.push(await tx.tag.create({ data: { name, nameKey: key, slug } }));
  }

  await tx.articleTag.deleteMany({ where: { articleId } });

  if (resolved.length > 0) {
    await tx.articleTag.createMany({
      data: resolved.map((tag) => ({ articleId, tagId: tag.id })),
    });
  }

  return resolved;
}