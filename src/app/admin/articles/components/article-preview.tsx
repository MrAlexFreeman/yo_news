"use client";

import { Eye, EyeOff } from "lucide-react";

import { sanitizeArticleHtml } from "@/lib/sanitize";

type ArticlePreviewProps = {
  /** Sanitised on the client with the same allowlist the public page uses. */
  html: string;
  open: boolean;
  onToggle: () => void;
};

/**
 * Renders the article body through the same sanitiser as the public page.
 *
 * The editor asked for this to check paragraph breaks and links before
 * publishing, which is exactly the class of problem that is invisible in the
 * source textarea and obvious on the site.
 */
export function ArticlePreview({ html, open, onToggle }: ArticlePreviewProps) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium text-neutral-700">Предпросмотр</h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 rounded-sm border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50"
        >
          {open ? (
            <EyeOff className="size-3.5" aria-hidden />
          ) : (
            <Eye className="size-3.5" aria-hidden />
          )}
          {open ? "Скрыть" : "Показать"}
        </button>
      </div>

      {open ? (
        html.trim() ? (
          <div className="rounded border border-neutral-300 bg-white p-4">
            <div
              className="article-body prose prose-slate max-w-none text-sm"
              dangerouslySetInnerHTML={{ __html: sanitizeArticleHtml(html) }}
            />
          </div>
        ) : (
          <p className="rounded border border-dashed border-neutral-300 p-4 text-sm text-neutral-400">
            Текст материала пуст — предпросматривать пока нечего.
          </p>
        )
      ) : (
        <p className="text-xs text-neutral-400">
          Показывает текст так, как его увидит читатель: с абзацами, ссылками и
          встроенными видео.
        </p>
      )}
    </section>
  );
}