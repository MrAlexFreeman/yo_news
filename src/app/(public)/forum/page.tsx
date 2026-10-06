import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare, Pin, Users } from "lucide-react";

import { getForumCategories } from "@/lib/forum";
import { plural } from "@/lib/date";

/**
 * Board metadata.
 *
 * The title is a plain "Форум" so the root layout's template turns it into
 * «Форум - Ё-новости» — the same shape every other page on the site gets, and one
 * template to keep correct. Spelling the site name out here as well would produce
 * «Форум - eartnews.ru - Ё-новости».
 *
 * The description names what a reader finds here rather than repeating the word
 * "форум": a search engine reads a meta description as a summary of the queries the
 * page answers, and «обсуждение новостей региона, городских тем, авто и дорог» says
 * more about this page than «форум издания» does.
 */
export const metadata: Metadata = {
  title: "Форум",
  description:
    "Форум eartnews.ru — обсуждение новостей региона, городских тем, авто и дорог.",
  alternates: { canonical: "/forum" },
  openGraph: {
    type: "website",
    url: "/forum",
    title: "Форум",
    description:
      "Форум eartnews.ru — обсуждение новостей региона, городских тем, авто и дорог.",
  },
};

/**
 * The board index.
 *
 * `revalidate` rather than `force-dynamic`: a forum is read far more than it is
 * written to, and a new reply showing up within the revalidation window is the right
 * trade for a page that is on the site's main navigation. The pages that change on a
 * post call `revalidatePath("/forum")` themselves.
 */
export const revalidate = 120;

/**
 * The board.
 *
 * Rendered from `getForumCategories`, which seeds the starter sections on first
 * call — so a fresh deployment has a working board without a separate seed step.
 */
export default async function ForumPage() {
  const categories = await getForumCategories();

  const totalTopics = categories.reduce((sum, category) => sum + category.topics, 0);
  const totalPosts = categories.reduce((sum, category) => sum + category.posts, 0);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <header className="border-b border-rule pb-4">
        <h1 className="font-serif text-3xl tracking-tight text-ink">Форум</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft">
          Здесь обсуждают материалы издания и то, что происходит в городе. Темы и
          ответы пишут читатели — модерация убирает явный спам и рекламу.
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
          <span className="inline-flex items-center gap-1">
            <Pin className="size-3.5" aria-hidden />
            {totalTopics} {plural(totalTopics, "тема", "темы", "тем")}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3.5" aria-hidden />
            {totalPosts} {plural(totalPosts, "ответ", "ответа", "ответов")}
          </span>
        </p>
      </header>

      {categories.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">Разделы форума появятся позже.</p>
      ) : (
        <ul className="mt-6 divide-y divide-rule border-b border-rule">
          {categories.map((category) => (
            <li key={category.id}>
              <Link
                href={`/forum/${category.slug}`}
                className="group flex flex-col gap-2 px-1 py-4 transition-colors hover:bg-paper-dim/60 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <span className="min-w-0">
                  <span className="block text-base font-medium text-ink group-hover:text-accent-ink">
                    {category.title}
                  </span>
                  {category.description ? (
                    <span className="mt-1 block text-sm leading-relaxed text-ink-soft">
                      {category.description}
                    </span>
                  ) : null}
                </span>

                <span className="flex shrink-0 items-center gap-4 text-xs text-ink-soft sm:justify-end">
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <MessageSquare className="size-3.5" aria-hidden />
                    {category.topics} {plural(category.topics, "тема", "темы", "тем")}
                  </span>
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <Users className="size-3.5" aria-hidden />
                    {category.posts} {plural(category.posts, "ответ", "ответа", "ответов")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}