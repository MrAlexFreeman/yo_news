import type { Metadata } from "next";
import Link from "next/link";

import {
  deleteForumPostAction,
  deleteForumTopicAction,
  toggleForumTopicClosedAction,
  toggleForumTopicPinnedAction,
} from "@/app/admin/forum/actions";
import { ForumAction } from "@/app/admin/forum/components/forum-action";
import { formatDate, formatTime } from "@/lib/date";
import { getRecentForumPosts, getRecentForumTopics } from "@/lib/forum";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Форум — модерация" };

/**
 * Moderation board.
 *
 * force-dynamic for the same reason the article list is: every row here reflects a
 * reader's last action, and a prerendered page would show a moderator a board state
 * from build time. A moderation screen that lies is worse than no moderation screen.
 */
export const dynamic = "force-dynamic";

const THEME_LIMIT = 40;
const POST_LIMIT = 40;

export default async function AdminForumPage() {
  const [topics, posts] = await Promise.all([
    getRecentForumTopics(THEME_LIMIT),
    getRecentForumPosts(POST_LIMIT),
  ]);

  return (
    <div className="space-y-8 p-4 lg:p-6">
      <header>
        <h1 className="text-xl font-medium text-neutral-900">Форум</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Закрепление поднимает тему вверх списка, закрытие запрещает новые ответы,
          удаление необратимо.
        </p>
        <Link
          href="/forum"
          className="mt-2 inline-block text-sm text-accent-ink hover:underline"
        >
          Открыть форум на сайте
        </Link>
      </header>

      <section>
        <h2 className="text-sm font-medium tracking-[0.08em] text-neutral-500 uppercase">
          Темы — последние {topics.length}
        </h2>

        {topics.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">Тем пока нет.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded border border-neutral-300 bg-white">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="bg-neutral-100 text-left text-xs text-neutral-600">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Тема</th>
                  <th scope="col" className="px-3 py-2 font-medium">Раздел</th>
                  <th scope="col" className="px-3 py-2 font-medium">Автор</th>
                  <th scope="col" className="px-3 py-2 font-medium">Ответов</th>
                  <th scope="col" className="px-3 py-2 font-medium">Просм.</th>
                  <th scope="col" className="px-3 py-2 font-medium">Обновлена</th>
                  <th scope="col" className="px-3 py-2 font-medium">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {topics.map((topic) => (
                  <tr key={topic.id}>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {topic.isPinned ? <Badge tone="accent">закреплена</Badge> : null}
                        {topic.isClosed ? <Badge tone="muted">закрыта</Badge> : null}
                        <Link
                          href={`/forum/${topic.category.slug}/${topic.slug}`}
                          className="font-medium text-neutral-900 hover:text-accent-ink hover:underline"
                        >
                          {topic.title}
                        </Link>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-neutral-600">{topic.category.title}</td>
                    <td className="px-3 py-2 text-neutral-600">{topic.authorName}</td>
                    <td className="px-3 py-2 tabular-nums text-neutral-600">
                      {topic._count.posts}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-neutral-600">
                      {topic.viewsCount}
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-neutral-600">
                      {formatDate(topic.updatedAt)}, {formatTime(topic.updatedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-start gap-1.5">
                        <ForumAction
                          action={toggleForumTopicPinnedAction}
                          id={topic.id}
                          flag={{ pinned: topic.isPinned ? "0" : "1" }}
                          label={topic.isPinned ? "Открепить" : "Закрепить"}
                          icon={topic.isPinned ? "pinOff" : "pin"}
                        />
                        <ForumAction
                          action={toggleForumTopicClosedAction}
                          id={topic.id}
                          flag={{ closed: topic.isClosed ? "0" : "1" }}
                          label={topic.isClosed ? "Открыть" : "Закрыть"}
                          icon={topic.isClosed ? "lockOpen" : "lock"}
                        />
                        <ForumAction
                          action={deleteForumTopicAction}
                          id={topic.id}
                          label="Удалить"
                          icon="trash"
                          tone="danger"
                          confirm={`Удалить тему «${topic.title}» и все её сообщения? Это необратимо.`}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium tracking-[0.08em] text-neutral-500 uppercase">
          Сообщения — последние {posts.length}
        </h2>

        {posts.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-600">Сообщений пока нет.</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 rounded border border-neutral-300 bg-white">
            {posts.map((post) => {
              const preview = post.content
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
              return (
                <li
                  key={post.id}
                  className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <span className="min-w-0">
                    <span className="block text-xs text-neutral-600">
                      {post.authorName} ·{" "}
                      <time dateTime={post.createdAt.toISOString()}>
                        {formatDate(post.createdAt)}, {formatTime(post.createdAt)}
                      </time>{" "}
                      ·{" "}
                      <Link
                        href={`/forum/${post.topic.category.slug}/${post.topic.slug}`}
                        className="text-accent-ink hover:underline"
                      >
                        {post.topic.title}
                      </Link>
                    </span>
                    <span className="mt-1 block text-sm text-neutral-900">
                      {preview.length > 220 ? `${preview.slice(0, 220)}…` : preview}
                    </span>
                  </span>

                  <ForumAction
                    action={deleteForumPostAction}
                    id={post.id}
                    label="Удалить"
                    icon="trash"
                    tone="danger"
                    confirm="Удалить сообщение безвозвратно?"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-xs text-neutral-500">
        Показаны последние {THEME_LIMIT} тем и {POST_LIMIT} сообщений. Более старые
        удаляются из своего раздела форума или через Prisma Studio.
      </p>
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
          : "border-neutral-300 bg-neutral-100 text-neutral-600",
      )}
    >
      {children}
    </span>
  );
}