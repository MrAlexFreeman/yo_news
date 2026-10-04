import type { ArticleStatus } from "@/lib/article-status";
import type { MediaItem } from "@/lib/article-media";

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
  vkQueued?: boolean;
  /** VK post id when the repost succeeded; null when it was skipped or failed. */
  vkPostId?: string | null;
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
  categoryId: string;
  status: ArticleStatus;
  publishedAt: string;
  isDzen: boolean;
  isVk: boolean;
  isExclusive: boolean;
  is18plus: boolean;
  /** Editorial metadata overrides; empty means "derive it on the page". */
  seoTitle: string;
  seoDescription: string;
  seoCanonicalUrl: string;
  noIndex: boolean;
  /** Tag names, already split from the comma-separated submission. */
  tags: string[];
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
 */
export const FALLBACK_CATEGORIES: CategoryOption[] = [
  { id: "politics", name: "Политика" },
  { id: "science", name: "Наука" },
  { id: "sport", name: "Спорт" },
  { id: "economy", name: "Экономика" },
  { id: "tech", name: "Технологии" },
  { id: "culture", name: "Культура" },
  { id: "society", name: "Общество" },
  { id: "incident", name: "Происшествия" },
];

/**
 * Editorial soft limit for headlines; past this the editor is warned, never
 * blocked. Long investigative headlines are normal and the server does not
 * truncate, so a warning is the only honest signal. It used to sit at 70, which
 * editors kept hitting on ordinary stories.
 */
export const TITLE_SOFT_LIMIT = 250;

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
