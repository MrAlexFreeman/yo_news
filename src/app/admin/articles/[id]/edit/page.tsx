import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ArticleForm } from "@/app/admin/articles/components/article-form";
import { FALLBACK_CATEGORIES } from "@/app/admin/articles/types";
import { isArticleStatus } from "@/lib/article-status";
import { parseMedia } from "@/lib/article-media";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Редактирование — Админка",
};

/** Live DB read on both counts, so the page must not be prerendered. */
export const dynamic = "force-dynamic";

type EditPageProps = {
  params: Promise<{ id: string }>;
};

/** "YYYY-MM-DDTHH:mm" in Moscow, the format `datetime-local` expects. */
function toMoscowInputValue(date: Date | null): string {
  if (!date) return "";

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/**
 * Edit an existing article.
 *
 * This route did not exist, which is why editors could not flip a draft to
 * published: there was no way to open a saved article at all, only to create
 * new ones. The form takes its initial values from here and switches to update
 * mode on the hidden `id` field.
 */
export default async function EditArticlePage({ params }: EditPageProps) {
  const { id } = await params;

  const [article, categories] = await Promise.all([
    prisma.article.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        subtitle: true,
        slug: true,
        lead: true,
        contentHtml: true,
        coverImage: true,
        photoAuthor: true,
        photoSource: true,
        seoTitle: true,
        seoDescription: true,
        seoCanonicalUrl: true,
        noIndex: true,
        media: true,
        videoUrl: true,
        categoryId: true,
        status: true,
        publishedAt: true,
        isDzen: true,
        isVk: true,
        isExclusive: true,
        is18plus: true,
        tags: { select: { tag: { select: { name: true } } } },
      },
    }),
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (!article) notFound();

  return (
    <ArticleForm
      categories={categories.length > 0 ? categories : FALLBACK_CATEGORIES}
      initial={{
        id: article.id,
        slug: article.slug,
        title: article.title,
        subtitle: article.subtitle ?? "",
        lead: article.lead ?? "",
        contentHtml: article.contentHtml,
        coverImage: article.coverImage ?? "",
        photoAuthor: article.photoAuthor ?? "",
        photoSource: article.photoSource ?? "",
        seoTitle: article.seoTitle ?? "",
        seoDescription: article.seoDescription ?? "",
        seoCanonicalUrl: article.seoCanonicalUrl ?? "",
        noIndex: article.noIndex,
        tags: article.tags.map((entry) => entry.tag.name),
        media: parseMedia(article.media),
        videoUrl: article.videoUrl ?? "",
        categoryId: article.categoryId ?? "",
        status: isArticleStatus(article.status) ? article.status : "draft",
        publishedAt: toMoscowInputValue(article.publishedAt),
        isDzen: article.isDzen,
        isVk: article.isVk,
        isExclusive: article.isExclusive,
        is18plus: article.is18plus,
      }}
    />
  );
}