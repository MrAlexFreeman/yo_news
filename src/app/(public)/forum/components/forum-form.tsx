"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";

import { createForumPostAction, createForumTopicAction } from "@/app/(public)/forum/actions";
import {
  INITIAL_FORUM_FORM,
  type ForumFormResult,
} from "@/app/(public)/forum/types";
import {
  FORUM_HONEYPOT_FIELD,
  FORUM_NAME_MAX_LENGTH,
  FORUM_POST_MAX_LENGTH,
  FORUM_TITLE_MAX_LENGTH,
} from "@/lib/forum-text";
import { cn } from "@/lib/utils";

type ForumFormProps =
  | {
      mode: "topic";
      categorySlug: string;
      categoryTitle: string;
    }
  | {
      mode: "reply";
      categorySlug: string;
      topicSlug: string;
      topicTitle: string;
    };

/**
 * The two public forum forms.
 *
 * One component rather than two because they share the whole submission contract —
 * the name field, the honeypot, the length limits, the result banner — and the only
 * differences are the title field and which action runs. Two copies would drift.
 */
export function ForumForm(props: ForumFormProps) {
  const isTopic = props.mode === "topic";

  // The action is chosen and called, rather than given to `useActionState` by
  // reference: React invokes the callback as `(prevState, formData)`, so a server
  // action with a single `formData` parameter cannot be passed straight in. Note the
  // wrapper carries no `"use server"` of its own — that directive belongs on a form
  // action, and having it here is one thing Turbopack refuses to build.
  const action = isTopic ? createForumTopicAction : createForumPostAction;
  const [state, formAction, pending] = useActionState<ForumFormResult, FormData>(
    async (_previous, formData) => action(formData),
    INITIAL_FORUM_FORM,
  );

  const errors = state.fieldErrors ?? {};

  return (
    <form
      action={formAction}
      className="space-y-3 rounded border border-rule bg-paper-dim/40 p-4"
    >
      <input type="hidden" name="categorySlug" value={props.categorySlug} />
      {props.mode === "reply" ? (
        <input type="hidden" name="topicSlug" value={props.topicSlug} />
      ) : null}

      {/*
        The honeypot.

        Off-screen rather than `display: none`: a bot that inspects visibility will
        skip a hidden input, whereas one that walks the form's fields fills in
        whatever it finds. `tabIndex={-1}` keeps it out of the tab order and
        `aria-hidden` keeps it out of the accessibility tree — together they also stop
        it being the kind of focusable-but-invisible control that trips an a11y audit.
      */}
      <input
        type="text"
        name={FORUM_HONEYPOT_FIELD}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-px w-px opacity-0"
      />

      {isTopic ? (
        <div className="space-y-1">
          <label htmlFor="forum-title" className="text-sm font-medium text-ink">
            Заголовок темы
          </label>
          <input
            id="forum-title"
            name="title"
            maxLength={FORUM_TITLE_MAX_LENGTH}
            required
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "forum-title-error" : undefined}
            className={cn(
              "w-full rounded-sm border bg-white px-3 py-2 text-sm outline-none",
              "focus-visible:border-yo focus-visible:ring-1 focus-visible:ring-yo",
              errors.title ? "border-red-500" : "border-rule",
            )}
          />
          {errors.title ? (
            <p id="forum-title-error" className="text-xs text-red-600">
              {errors.title}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="forum-author" className="text-sm font-medium text-ink">
          Ваше имя
        </label>
        <input
          id="forum-author"
          name="authorName"
          maxLength={FORUM_NAME_MAX_LENGTH}
          required
          placeholder="Как вас подписать"
          aria-invalid={Boolean(errors.authorName)}
          aria-describedby={errors.authorName ? "forum-author-error" : undefined}
          className={cn(
            "w-full rounded-sm border bg-white px-3 py-2 text-sm outline-none sm:max-w-xs",
            "focus-visible:border-yo focus-visible:ring-1 focus-visible:ring-yo",
            errors.authorName ? "border-red-500" : "border-rule",
          )}
        />
        {errors.authorName ? (
          <p id="forum-author-error" className="text-xs text-red-600">
            {errors.authorName}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <label htmlFor="forum-content" className="text-sm font-medium text-ink">
          {isTopic ? "Первое сообщение" : "Сообщение"}
        </label>
        <textarea
          id="forum-content"
          name="content"
          rows={isTopic ? 6 : 4}
          required
          placeholder="Пустая строка разделяет абзацы, строка с «>» в начале — цитата."
          aria-invalid={Boolean(errors.content)}
          aria-describedby={errors.content ? "forum-content-error" : undefined}
          className={cn(
            "w-full rounded-sm border bg-white px-3 py-2 text-sm leading-relaxed outline-none",
            "focus-visible:border-yo focus-visible:ring-1 focus-visible:ring-yo",
            errors.content ? "border-red-500" : "border-rule",
          )}
        />
        {errors.content ? (
          <p id="forum-content-error" className="text-xs text-red-600">
            {errors.content}
          </p>
        ) : (
          <p className="text-xs text-ink-soft">
            До {FORUM_POST_MAX_LENGTH} символов. Ссылки и картинки вставлять не нужно —
            их можно написать обычным текстом.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-sm bg-ink px-3.5 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          <Send className="size-4" aria-hidden />
          {pending
            ? "Отправляем…"
            : isTopic
              ? "Создать тему"
              : "Ответить"}
        </button>
        <span className="text-xs text-ink-soft">
          {isTopic ? `Раздел «${props.categoryTitle}»` : `Тема «${props.topicTitle}»`}
        </span>
      </div>

      {/*
        The result banner.

        `status` for a field-level complaint and `alert` for a refusal. A rate-limit
        rejection is the one message that must interrupt: the visitor has done nothing
        wrong and needs to know the wait is not their typing failing.
      */}
      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={cn(
            "flex items-center gap-1.5 text-sm font-medium",
            state.ok ? "text-ink-soft" : "text-red-600",
          )}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}