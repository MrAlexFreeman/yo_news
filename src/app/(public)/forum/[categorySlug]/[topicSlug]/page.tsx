import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye, Lock, MessageSquare } from "lucide-react";

import { ForumForm } from "@/app/(public)/forum/components/forum-form";
import { formatDate, formatTime, plural } from "@/lib/date";
import { getForumTopic, incrementForumTopicViews } from "@/lib/forum";
import { cn } from "@/lib/utils";

type PageParams = { categorySlug: string; topicSlug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { categorySlug, topicSlug } = await params;
  const topic = await getForumTopic(categorySlug, topicSlug);

  if (!topic) {
    return { title: "Тема не найдена", robots: { index: false, follow: false } };
  }

  const description = topic.posts[0]?.content
    ? `${topic.posts[0].content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 150)}`
    : `Обсуждение «${topic.title}» на форуме издания.`;

  const url = `/forum/${topic.category.slug}/${topic.slug}`;

  return {
    title: topic.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      title: topic.title,
      description,
      publishedTime: topic.createdAt.toISOString(),
    },
  };
}

/**
 * A thread.
 *
 * Dynamic, not prerendered: threads are created by readers, so a static path would
 * miss every new one, and the view counter has to be written on each read anyway.
 */
export const dynamic = "force-dynamic";

export default async function ForumTopicPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { categorySlug, topicSlug } = await params;
  const topic = await getForumTopic(categorySlug, topicSlug);
  if (!topic) notFound();

  // Counted on render, so the number tracks reads rather than requests that were
  // never followed — including prefetches of the link on the previous page.
  await incrementForumTopicViews(topic.id);

  const href = `/forum/${topic.category.slug}/${topic.slug}`;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <Link
        href={`/forum/${topic.category.slug}`}
        className="inline-flex items-center gap-1 text-xs text-ink-soft transition-colors hover:text-accent-ink"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {topic.category.title}
      </Link>

      <header className="mt-3 border-b border-rule pb-4">
        <h1 className="font-serif text-2xl leading-snug tracking-tight text-ink sm:text-3xl">
          {topic.title}
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <MessageSquare className="size-3.5" aria-hidden />
            {topic.posts.length} {plural(topic.posts.length, "сообщение", "сообщения", "сообщений")}
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Eye className="size-3.5" aria-hidden />
            {topic.viewsCount} {plural(topic.viewsCount, "просмотр", "просмотра", "просмотров")}
          </span>
          {topic.isClosed ? (
            <span className="inline-flex items-center gap-1">
              <Lock className="size-3.5" aria-hidden />
              Закрыта
            </span>
          ) : null}
        </p>
      </header>

      <ol className="divide-y divide-rule">
        {topic.posts.map((post, index) => (
          <li
            key={post.id}
            className={cn("py-5", index > 0 && "border-t border-rule")}
          >
            <article>
              <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-sm font-medium text-ink">{post.authorName}</h2>
                <time
                  dateTime={post.createdAt.toISOString()}
                  className="text-xs tabular-nums text-ink-soft"
                >
                  {formatDate(post.createdAt)}, {formatTime(post.createdAt)}
                </time>
              </header>

              {/*
                The only `dangerouslySetInnerHTML` a reader can reach, and it is
                behind `sanitizeForumHtml`, which allows seven text tags and no
                attributes at all. See src/lib/sanitize.ts.
              */}
              <div
                className="forum-post mt-2 text-[0.9375rem] leading-relaxed text-ink"
                dangerouslySetInnerHTML={{ __html: post.content }}
              />
            </article>
          </li>
        ))}
      </ol>

      <section className="mt-8" id="reply">
        <h2 className="mb-3 text-sm font-medium tracking-[0.08em] text-ink-soft uppercase">
          {topic.isClosed ? "Тема закрыта" : "Ответить"}
        </h2>

        {topic.isClosed ? (
          <p className="rounded border border-rule bg-paper-dim/40 p-4 text-sm text-ink-soft">
            Модерация закрыл эту тему: новые ответы не принимаются. Прежние сообщения
            остаются доступными.
          </p>
        ) : (
          <ForumForm
            mode="reply"
            categorySlug={topic.category.slug}
            topicSlug={topic.slug}
            topicTitle={topic.title}
          />
        )}
      </section>

      <p className="mt-6 text-xs text-ink-soft">
        <a href={href} className="hover:text-accent-ink hover:underline">
          Постоянная ссылка на тему
        </a>
      </p>
    </div>
  );
}