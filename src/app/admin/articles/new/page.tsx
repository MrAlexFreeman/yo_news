import type { Metadata } from "next";

import { ArticleForm } from "@/app/admin/articles/components/article-form";
import { FALLBACK_CATEGORIES } from "@/app/admin/articles/types";
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

  return <ArticleForm categories={categories} />;
}
