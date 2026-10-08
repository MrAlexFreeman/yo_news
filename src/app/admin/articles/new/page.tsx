import type { Metadata } from "next";

import { ArticleForm } from "@/app/admin/articles/components/article-form";
import { FALLBACK_CATEGORIES } from "@/app/admin/articles/types";
import { getSetting } from "@/lib/settings";
import { DEFAULT_SYNDICATION_ENABLED, parseEnabled } from "@/lib/settings-keys";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Новый материал — Админка",
};

/** The rubric list is a live DB read, so the editor must not be prerendered. */
export const dynamic = "force-dynamic";

type PageParams = { searchParams: Promise<{ feed?: string }> };

/**
 * Turns a wire item's plain text into body HTML.
 *
 * The feed's text has already lost its markup — `feed-parse.ts` stores plain text with
 * paragraph breaks — so each blank-line-separated block becomes a `<p>`. Angle brackets
 * are escaped here because this is the one place the text becomes markup; the body is
 * sanitised again on save and on render.
 */
function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return "";

  return paragraphs
    .map(
      (paragraph) =>
        `<p>${paragraph
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</p>`,
    )
    .join("");
}

export default async function NewArticlePage({ searchParams }: PageParams) {
  const { feed } = await searchParams;

  // Rubrics come from the database; the static list keeps the dropdown usable on
  // a fresh checkout where Category is still empty.
  const categories = await prisma.category
    .findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
    .then((rows) => (rows.length > 0 ? rows : FALLBACK_CATEGORIES));

  /*
    Whether each messenger is switched on decides whether its checkbox starts ticked.

    Read here rather than in the browser because it lives in the settings table, and the
    browser never sees a token — only this boolean crosses. Without it the form would
    default both to true, and an editor on an install that has set up neither would see
    two checked boxes that quietly do nothing.
  */
  const [telegramEnabled, maxEnabled] = await Promise.all([
    getSetting("TELEGRAM_ENABLED"),
    getSetting("MAX_ENABLED"),
  ]);

  /*
    Opened from «Предложка»: the item's own headline and text start the form off, so the
    editor works from the source rather than from an empty page. The text goes in
    unchanged — the rewriter is a button, not an automatic step, because nothing should
    be published that nobody has read.
  */
  const item = feed
    ? await prisma.newsFeedItem.findUnique({
        where: { id: feed },
        select: { id: true, title: true, rawText: true },
      })
    : null;

  return (
    <ArticleForm
      categories={categories}
      prefill={item ? { title: item.title, contentHtml: textToHtml(item.rawText) } : undefined}
      messengerDefaults={{
        telegram: parseEnabled(telegramEnabled, DEFAULT_SYNDICATION_ENABLED.telegram),
        max: parseEnabled(maxEnabled, DEFAULT_SYNDICATION_ENABLED.max),
      }}
      feedId={item?.id ?? ""}
    />
  );
}

