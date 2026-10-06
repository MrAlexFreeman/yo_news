"use client";

import { useActionState } from "react";
import { Lock, LockOpen, Pin, PinOff, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * One moderation button.
 *
 * A client component because the action's result has to be shown. `<form action>`
 * types the handler as returning `void | Promise<void>`, so passing an action that
 * answers `{ ok, message }` straight to it is a type error — and wrapping it in an
 * arrow function that discards the value would compile while leaving the moderator
 * with a button that fails silently. `useActionState` keeps the answer.
 *
 * Each button owns its own state, so only the one that was clicked reports back and a
 * board of forty rows stays quiet. It also means two moderators clicking different
 * buttons cannot overwrite each other's message with one shared form.
 *
 * The icon arrives as a name, not a component: this component is rendered on the
 * client and a server component cannot pass a function across that boundary.
 */
const ICONS = {
  pin: Pin,
  pinOff: PinOff,
  lock: Lock,
  lockOpen: LockOpen,
  trash: Trash2,
} as const;

export type ForumActionIcon = keyof typeof ICONS;

type ForumActionProps = {
  action: (formData: FormData) => Promise<{ ok: boolean; message: string }>;
  id: number;
  /** Explicit "1"/"0" values, so a toggle sends the state it is moving to. */
  flag?: Record<string, string>;
  label: string;
  icon: ForumActionIcon;
  tone?: "neutral" | "danger";
  /** Asked in the browser, because a server action cannot raise a dialog. */
  confirm?: string;
};

export function ForumAction({
  action,
  id,
  flag,
  label,
  icon: iconName,
  tone = "neutral",
  confirm,
}: ForumActionProps) {
  const [state, formAction, pending] = useActionState(
    async (_previous: { ok: boolean; message: string }, formData: FormData) =>
      action(formData),
    { ok: false, message: "" },
  );

  const Icon = ICONS[iconName];

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // React runs this before the action. Cancelling the submit is all it takes to
        // stop it, and there is no server-side equivalent — a server action cannot
        // raise a dialog, so a hard delete has to ask here or not at all.
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      className="inline-flex flex-col items-start gap-0.5"
    >
      <input type="hidden" name="id" value={id} />
      {flag
        ? Object.entries(flag).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      <button
        type="submit"
        disabled={pending}
        title={label}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60",
          tone === "danger"
            ? "border-red-300 bg-white text-red-700 hover:border-red-400 hover:bg-red-50"
            : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-100",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {label}
      </button>

      {/*
        `status` rather than `alert`: clicking pin on a topic is routine housekeeping,
        and a screen reader announcing an alert for it would interrupt whatever the
        moderator was reading. The message is short and adjacent to the control that
        produced it.
      */}
      {state.message ? (
        <span
          role="status"
          className={cn(
            "text-[0.6875rem]",
            state.ok ? "text-neutral-500" : "text-red-600",
          )}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}