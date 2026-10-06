/**
 * Result shape returned by the forum form actions.
 *
 * In its own file, and for the reason the article editor's types are: a `"use server"`
 * module may only export async functions, so a stray `export const` there makes
 * Turbopack drop every export from the module. Types are erased and cost nothing, so
 * they live beside the actions rather than inside them.
 */
export type ForumFormResult = {
  ok: boolean;
  message: string;
  fieldErrors?: {
    authorName?: string;
    title?: string;
    content?: string;
  };
  /** Seconds until the visitor may post again; present only when rate limited. */
  retryAfter?: number;
};

export const INITIAL_FORUM_FORM: ForumFormResult = { ok: false, message: "" };