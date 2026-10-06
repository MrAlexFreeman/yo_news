import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ForumForm } from "@/app/(public)/forum/components/forum-form";
import { formatDate, formatTime, plural } from "@/lib/date";
import {
  countForumTopics,
  getForumCategories,
  getForumCategoryBySlug,
  getForumTopics,
} from "@/lib/forum";
import { forumPageHref, totalPages } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type PageParams = { categorySlug: string; page?: string };
type ListingProps = { categorySlug: string; page: number };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { categorySlug } = await params;
  const category = await getForumCategoryBySlug(categorySlug);

  if (!category) {
    return { title: "Раздел не найден", robots: { index: false, follow: false } };
  }

  const description =
    category.description ?? `Темы и ответы в разделе «${category.title}».`;
  const url = `/forum/${category.slug}`;

  return {
    title: `${category.title} — форум`,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, title: category.title, description },
  };
}

/** All sections are prerendered; deeper pages add their own. */
export async function generateStaticParams() {
  const categories = await getForumCategories();
  return categories.map((category) => ({ categorySlug: category.slug }));
}

const PAGE_SIZE = 20;

/**
 * One section's thread list.
 *
 * Split out of the page module so `/page/[n]` can render the same thing with a
 * different page number — the pattern every other listing on this site uses, and the
 * reason deeper pages stay statically generated.
 */
export async function ForumCategoryListing({ categorySlug, page }: ListingProps) {
  const category = await getForumCategoryBySlug(categorySlug);
  // notFound() rather than rendering nothing: a null page answers 200 with an empty
  // body, which tells a crawler the section exists and has no threads. That is worse
  // than an error for a URL nobody linked to on purpose.
  if (!category) notFound();

  const total = await countForumTopics(category.id);
  const pages = totalPages(total, PAGE_SIZE);
  // Clamp rather than 404: a thread deleted since a link was printed would otherwise
  // turn page 7 of a 6-page list into an error for whoever had the link open.
  const currentPage = Math.min(Math.max(1, page), pages);

  const topics = await getForumTopics(
    category.id,
    PAGE_SIZE,
    (currentPage - 1) * PAGE_SIZE,
  );

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Link
        href="/forum"
        className="inline-flex items-center gap-1 text-xs text-ink-soft transition-colors hover:text-accent-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Все разделы
      </Link>

      <header className="mt-3 border-b border-rule pb-4">
        <h1 className="font-serif text-3xl tracking-tight text-ink">
          {category.title}
        </h1>
        {category.description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
            {category.description}
          </p>
        ) : null}
      </header>

      {topics.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">
          В этом разделе ещё нет тем. Начните первую.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-rule border-b border-rule">
          {topics.map((topic) => (
            <li key={topic.id}>
              <Link
                href={`/forum/${category.slug}/${topic.slug}`}
                className="flex flex-col gap-1.5 px-1 py-3.5 transition-colors hover:bg-paper-dim/60 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    {topic.isPinned ? (
                      <Badge tone="accent">Закреплено</Badge>
                    ) : null}
                    {topic.isClosed ? <Badge tone="muted">Закрыто</Badge> : null}
                    <span className="text-base font-medium text-ink">
                      {topic.title}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-ink-soft">
                    {topic.authorName} · создано {formatDate(topic.createdAt)},{" "}
                    {formatTime(topic.createdAt)}
                  </span>
                </span>

                <span className="flex shrink-0 items-center gap-4 text-xs tabular-nums text-ink-soft">
                  <span>
                    {topic.replies} {plural(topic.replies, "ответ", "ответа", "ответов")}
                  </span>
                  <span>{topic.viewsCount} просм.</span>
                  <span>{formatDate(topic.updatedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 ? (
        <nav
          aria-label="Постраничная навигация"
          className="mt-8 flex items-center justify-between gap-4 border-t border-rule pt-4 text-sm"
        >
          {currentPage > 1 ? (
            <Link
              rel="prev"
              href={forumPageHref(category.slug, currentPage - 1)}
              className="text-accent-ink hover:underline"
            >
              ← Предыдущая
            </Link>
          ) : (
            <span />
          )}

          <span className="text-ink-soft">
            Страница {currentPage} из {pages}
          </span>

          {currentPage < pages ? (
            <Link
              rel="next"
              href={forumPageHref(category.slug, currentPage + 1)}
              className="text-accent-ink hover:underline"
            >
              Следующая →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-medium tracking-[0.08em] text-ink-soft uppercase">
          Новая тема
        </h2>
        <ForumForm mode="topic" categorySlug={category.slug} categoryTitle={category.title} />
      </section>
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "accent" | "muted";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-[0.6875rem] font-medium tracking-wide uppercase",
        tone === "accent"
          ? "border-accent/40 bg-accent/10 text-accent-ink"
          : "border-rule bg-paper-dim text-ink-soft",
      )}
    >
      {children}
    </span>
  );
}

export default async function ForumCategoryPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { categorySlug } = await params;
  return (
    <ForumCategoryListing categorySlug={categorySlug} page={1} />
  );
}