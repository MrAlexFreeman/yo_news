import type { ArticleStatus } from "@/lib/article-status";

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
  | "categoryId";

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
  categoryId: string;
  status: ArticleStatus;
  isDzen: boolean;
  isVk: boolean;
  isExclusive: boolean;
  is18plus: boolean;
};

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

/** Editorial soft limit for headlines; past this the editor warns. */
export const TITLE_SOFT_LIMIT = 70;
