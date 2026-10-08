"use client";

import { ExternalLink, Inbox, Loader2, PenLine, RefreshCw, Undo2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import {
  ignoreFeedItemAction,
  openFeedItemAction,
  restoreFeedItemAction,
  syncFeedAction,
} from "@/app/admin/feed/actions";
import { cn } from "@/lib/utils";

/**
 * The wire desk.
 *
 * A list, and four things you can do to a row: open the original, turn it into a draft,
 * hide it, or — in the hidden tab — put it back. Nothing else, because the point of the
 * screen is to get through a morning's wire quickly.
 *
 * Opening a draft and hiding are form submits rather than links or fetches, because both
 * write on the server. A form action is a POST, and Next checks its origin, so a
 * cross-origin page cannot drive either one — which is what the Next guide on data
 * security asks for instead of a side-effecting GET. Each shows a wait while it runs:
 * opening a draft fetches the source article, so its click is not instant.
 */

export type FeedRow = {
  id: string;
  source: string;
  title: string;
  originalUrl: string;
  preview: string;
  dateLabel: string;
  dateIso: string;
  status: string;
};

type FeedListProps = {
  rows: FeedRow[];
  view: "new" | "ignored";
};

/**
 * The submit button for a form wired straight to a Server Action.
 *
 * It has to be a child of the `<form>`: `useFormStatus` reads the pending state of the
 * form it is rendered inside, and that is the only way to show a wait for an action
 * passed as `action={serverAction}`. Opening a draft fetches the source article, so the
 * wait is real and a button that looks inert for two seconds invites a second click.
 */
function PendingSubmit({ className, children }: { className: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {children}
    </button>
  );
}

export function FeedList({ rows, view }: FeedListProps) {
  const [syncing, startSync] = useTransition();
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startAction] = useTransition();

  function sync() {
    setSyncMessage(null);
    startSync(async () => {
      const result = await syncFeedAction();
      setSyncMessage({ ok: result.ok, text: result.message });
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={sync}
          disabled={syncing}
          className="flex items-center gap-2 rounded-sm bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
        >
          {syncing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-4" aria-hidden />
          )}
          {syncing ? "Синхронизируем…" : "Синхронизировать сейчас"}
        </button>

        {syncMessage ? (
          <p
            role="status"
            className={cn(
              "text-sm",
              syncMessage.ok ? "text-green-700" : "text-amber-700",
            )}
          >
            {syncMessage.text}
          </p>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded border border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          {view === "ignored"
            ? "Скрытых инфоповодов нет."
            : "Пока ничего не пришло. Нажмите «Синхронизировать сейчас»."}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded border border-neutral-300 bg-white p-3 transition-colors hover:border-neutral-400"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                        row.source === "URA"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-blue-100 text-blue-800",
                      )}
                    >
                      {row.source}
                    </span>
                    <time
                      dateTime={row.dateIso}
                      className="text-[11px] text-neutral-500 tabular-nums"
                    >
                      {row.dateLabel}
                    </time>
                  </div>

                  <h3 className="mt-1 text-sm font-semibold text-neutral-900">
                    {row.title}
                  </h3>

                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-500">
                    {row.preview}
                  </p>

                  <a
                    href={row.originalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-700 underline hover:text-blue-900"
                  >
                    Оригинал
                    <ExternalLink className="size-3" aria-hidden />
                  </a>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {view === "new" ? (
                    <>
                      <form action={openFeedItemAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <PendingSubmit className="flex items-center gap-1.5 rounded-sm border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60">
                          <PenLine className="size-3.5" aria-hidden />
                          Создать материал
                        </PendingSubmit>
                      </form>

                      <form
                        action={(formData) => {
                          startAction(() => {
                            void ignoreFeedItemAction(formData);
                          });
                        }}
                      >
                        <input type="hidden" name="id" value={row.id} />
                        <button
                          type="submit"
                          disabled={pending}
                          className="flex items-center gap-1.5 rounded-sm border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-500 transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-60"
                        >
                          <X className="size-3.5" aria-hidden />
                          Скрыть
                        </button>
                      </form>
                    </>
                  ) : (
                    <form
                      action={(formData) => {
                        startAction(() => {
                          void restoreFeedItemAction(formData);
                        });
                      }}
                    >
                      <input type="hidden" name="id" value={row.id} />
                      <button
                        type="submit"
                        disabled={pending}
                        className="flex items-center gap-1.5 rounded-sm border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-60"
                      >
                        <Undo2 className="size-3.5" aria-hidden />
                        Вернуть
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {view === "new" && rows.length > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-neutral-400">
          <Inbox className="size-3.5" aria-hidden />
          «Создать материал» подтягивает полный текст статьи и открывает форму с ним —
          дальше там кнопка рерайта через DeepSeek.
        </p>
      ) : null}
    </div>
  );
}
