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

export default async function NewArticlePage() {
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

  return (
    <ArticleForm
      categories={categories}
      messengerDefaults={{
        telegram: parseEnabled(telegramEnabled, DEFAULT_SYNDICATION_ENABLED.telegram),
        max: parseEnabled(maxEnabled, DEFAULT_SYNDICATION_ENABLED.max),
      }}
    />
  );
}