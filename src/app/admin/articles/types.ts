import type { ArticleStatus } from "@/lib/article-status";
import type { MediaItem } from "@/lib/article-media";
import { CATEGORIES } from "@/lib/categories";

/**
 * Types shared between the article editor and its Server Actions.
 *
 * They live outside `actions.ts` because a `"use server"` module may only
 * export async functions — a stray `export const` makes Turbopack drop the
 * whole module's exports.
 */

/** Ids of the form fields the server can reject, for inline error display. */
export type ArticleField =
  | "title"
  | "subtitle"
  | "lead"
  | "slug"
  | "contentHtml"
  | "coverImage"
  | "photoAuthor"
  | "photoSource"
  | "categoryId"
  | "videoUrl";

/** Shape returned to the client after every save attempt. */
export type SaveArticleResult = {
  ok: boolean;
  message: string;
  /** Present once the article exists, so the client can switch to update mode. */
  id?: string;
  slug?: string;
  fieldErrors?: Partial<Record<ArticleField, string>>;
  /** Set on success so the client can surface distribution state. */
  dzenQueued?: boolean;
  /** What was actually stored for the Dzen experiment flag. */
  dzenExperiment?: boolean;
  /** True when the publication moment is past, so the flag can no longer change. */
  dzenExperimentLocked?: boolean;
  /** True only when this save actually put the story on the wall. */
  vkQueued?: boolean;
  /** VK post id when the repost succeeded; null when it was skipped or failed. */
  vkPostId?: string | null;
  /**
   * Why the VK repost did not happen, in the provider's own words.
   *
   * Added because `vkQueued` only restates the checkbox: it is true whether the post
   * reached the wall or failed at the API, so a failed repost looked exactly like a
   * successful one in the editor's form. Without this field the only trace was a line
   * in the server console, which is why a repost that never worked went unnoticed.
   */
  vkError?: string | null;
  /**
   * Why the VK repost was deliberately skipped, as opposed to having failed.
   *
   * The third state, and the one an editor hits most: a story that is already on the wall.
   * It is not an error and it is not a success — nothing went wrong and nothing went out —
   * and reporting it as either makes the duplicate-protection look like a failure or makes
   * a re-save look like it posted again.
   */
  vkSkipNote?: string | null;
  /**
   * One line per messenger about what actually happened on publication.
   *
   * The same reasoning as `vkError`, applied twice: a repost can fail while the save
   * succeeds, and "nothing happened" is indistinguishable from "it worked" unless the
   * server says which. Keyed by messenger so one does not overwrite the other.
   */
  messengerNotes?: Record<"telegram" | "max", string | null>;
};

/** Form state mirrored between the client inputs and the action payload. */
export type ArticleFormValues = {
  id: string | null;
  title: string;
  subtitle: string;
  lead: string;
  contentHtml: string;
  coverImage: string;
  photoAuthor: string;
  photoSource: string;
  /**
   * The Unsplash credit, kept apart from `photoSource`.
   *
   * `photoSource` is the plain text the datalist offers and the feed prints; these four
   * carry the two links Unsplash's attribution rules require. Empty when the cover did not
   * come from Unsplash, which is the normal case and not an error.
   */
  stockPhotoId: string;
  stockAuthorName: string;
  stockAuthorUrl: string;
  stockPhotoUrl: string;
  categoryId: string;
  status: ArticleStatus;
  publishedAt: string;
  isDzen: boolean;
  isVk: boolean;
  /**
   * Whether the page places a "read also" plate by itself.
   *
   * True by default, matching the column: the flag is about taking the decision away from
   * the site, and a story that says nothing about it should keep the behaviour it has
   * always had.
   */
  autoRelatedArticle: boolean;
  /** Repost into Telegram on first publication. */
  isTelegram: boolean;
  /** Repost into MAX on first publication. */
  isMax: boolean;
  isExclusive: boolean;
  is18plus: boolean;
  /** Editorial metadata overrides; empty means "derive it on the page". */
  seoTitle: string;
  seoDescription: string;
  seoCanonicalUrl: string;
  noIndex: boolean;
  /** Tag names, already split from the comma-separated submission. */
  tags: string[];
  /** Dzen syndication experiment; editable only at first publication. */
  dzenExperiment: boolean;
  /** Publish straight to Dzen rather than holding for review. */
  dzenDirect: boolean;
  /** Whether the experiment checkbox is locked for this article. */
  dzenExperimentLocked: boolean;
  /** Gallery attached to the story, parsed out of the hidden JSON mirror. */
  media: MediaItem[];
  /** Link to the main video; empty when the story has none. */
  videoUrl: string;
};

/** Search-engine lengths above which the field is usually truncated anyway. */
export const SEO_TITLE_SOFT_LIMIT = 60;
export const SEO_DESCRIPTION_SOFT_LIMIT = 160;

/** Hard ceilings, comfortably above the soft limits so the warning comes first. */
export const SEO_TITLE_MAX_LENGTH = 120;
export const SEO_DESCRIPTION_MAX_LENGTH = 320;

export type CategoryOption = { id: string; name: string };

/**
 * Rubric options used when the database has no categories yet, so a fresh
 * checkout still renders a usable dropdown.
 *
 * Derived from the one rubric list rather than copied: when the two were separate, a
 * rework of the editorial grid left this dropdown offering rubrics the database no
 * longer had.
 */
export const FALLBACK_CATEGORIES: CategoryOption[] = CATEGORIES.map((category) => ({
  id: category.slug,
  name: category.name,
}));

/**
 * Editorial soft limit for headlines; past this the editor is warned, never
 * blocked. Long investigative headlines are normal and the server does not
 * truncate, so a warning is the only honest signal. It used to sit at 70, which
 * editors kept hitting on ordinary stories.
 */
export const TITLE_SOFT_LIMIT = 250;

/**
 * Dzen's documented ceiling for a headline, and the reason the counter has an
 * amber band rather than only a red one.
 *
 * The editorial soft limit stays at 250 — a long investigative headline is normal
 * on the site — but past this length Dzen truncates the title in its own feed
 * with no warning, so an editor who does not know that will be surprised by a
 * different headline in the syndication. Advisory only; nothing is blocked.
 */
export const DZEN_TITLE_LIMIT = 200;

/**
 * Hard ceiling, enforced by the input and again on the server. Set above the
 * soft limit so the warning is the thing editors see, not a silent truncation.
 */
export const TITLE_MAX_LENGTH = 300;

/**
 * Everything the editor needs to render an existing article back into the form.
 * The shape is deliberately identical to `ArticleFormValues` so switching
 * between create and edit is a single prop difference.
 */
export type ArticleInitialValues = ArticleFormValues & {
  id: string;
  slug: string;
};
