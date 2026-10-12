"use client";

import { Send } from "lucide-react";
import { useActionState } from "react";

import { proposeStoryAction } from "@/app/(public)/forum/actions";
import { INITIAL_FORUM_FORM, type ForumFormResult } from "@/app/(public)/forum/types";
import {
  FORUM_HONEYPOT_FIELD,
  FORUM_NAME_MAX_LENGTH,
  FORUM_POST_MAX_LENGTH,
} from "@/lib/forum-text";
import { cn } from "@/lib/utils";

/**
 * What replaces the "обсудить на форуме" button at the end of a story.
 *
 * The button asked the reader to go somewhere and start a thread; this asks them to write down
 * what they know, and files it in the section the desk already reads. Two fields and no title:
 * the headline comes from the first sentence of what they wrote (see `proposalTitle`), because
 * a reader with something to tell should not have to summarise it first.
 *
 * The submission contract is the forum's own — the honeypot, the same limits, the same server
 * action — so an anonymous form on the most-visited page is not a new kind of thing to keep
 * safe. `useActionState` is what makes the validation errors visible without losing the text
 * the reader typed.
 */
export function ReaderStoryForm() {
  const [state, formAction, pending] = useActionState<ForumFormResult, FormData>(
    // The wrapper is needed because React calls the callback as `(prevState, formData)` and a
    // server action takes `formData` alone. It carries no `"use server"` of its own — that
    // directive belongs on a form action, and having it here is one thing Turbopack refuses.
    async (_previous: ForumFormResult, formData: FormData) => proposeStoryAction(formData),
    INITIAL_FORUM_FORM,
  );

  const errors = state.fieldErrors ?? {};

  return (
    <section
      aria-labelledby="reader-story-heading"
      className="mt-10 border-t-2 border-ink pt-5"
    >
      <h2
        id="reader-story-heading"
        className="font-[family-name:var(--font-lora)] text-xl font-bold text-ink sm:text-2xl"
      >
        Оставляйте свои комментарии и делитесь историями
      </h2>

      <p className="mt-2 text-sm text-ink-soft">
        Что происходит у вас во дворе, на работе, на дороге? Напишите — редакция прочитает
        каждое сообщение и свяжется, если история требует проверки.
      </p>

      <form action={formAction} className="mt-5 space-y-3">
        {/* The honeypot: hidden from people, filled by anything walking the inputs. */}
        <div className="hidden" aria-hidden>
          <label htmlFor="reader-honeypot">Не заполняйте</label>
          <input id="reader-honeypot" name={FORUM_HONEYPOT_FIELD} type="text" tabIndex={-1} />
        </div>

        <div className="space-y-1">
          <label htmlFor="reader-name" className="text-sm font-medium text-ink-soft">
            Как вас подписать
          </label>
          <input
            id="reader-name"
            name="authorName"
            maxLength={FORUM_NAME_MAX_LENGTH}
            autoComplete="name"
            placeholder="Имя"
            aria-invalid={Boolean(errors.authorName)}
            className={cn(
              "w-full rounded-sm border px-3 py-2 text-sm outline-none focus:ring-2 sm:max-w-xs",
              errors.authorName
                ? "border-red-400 bg-red-50 focus:ring-red-200"
                : "border-rule bg-paper focus:border-ink-soft focus:ring-rule",
            )}
          />
          {errors.authorName ? (
            <p role="alert" className="text-xs text-red-600">
              {errors.authorName}
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <label htmlFor="reader-story" className="text-sm font-medium text-ink-soft">
            Предложить новость / рассказать историю редакции
          </label>
          <textarea
            id="reader-story"
            name="content"
            rows={6}
            maxLength={FORUM_POST_MAX_LENGTH}
            placeholder="Расскажите, что произошло: где, когда и что вы видели."
            aria-invalid={Boolean(errors.content)}
            className={cn(
              "w-full rounded-sm border px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2",
              errors.content
                ? "border-red-400 bg-red-50 focus:ring-red-200"
                : "border-rule bg-paper focus:border-ink-soft focus:ring-rule",
            )}
          />
          {errors.content ? (
            <p role="alert" className="text-xs text-red-600">
              {errors.content}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-10 items-center gap-2 rounded-sm bg-ink px-4 py-2 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Send className="size-4" aria-hidden />
            {pending ? "Отправляем…" : "Отправить в редакцию"}
          </button>
          <span className="text-xs text-ink-soft">
            Сообщение появится в разделе «Новости и события» на форуме.
          </span>
        </div>
      </form>

      {state.message && !state.ok ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
