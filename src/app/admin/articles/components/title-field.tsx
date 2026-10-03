"use client";

import { useId } from "react";

import { CharCounter } from "@/app/admin/articles/components/char-counter";
import {
  TITLE_MAX_LENGTH,
  TITLE_SOFT_LIMIT,
} from "@/app/admin/articles/types";
import { cn } from "@/lib/utils";

type TitleFieldProps = {
  value: string;
  onChange: (value: string) => void;
  error?: string;
};

/**
 * Required headline input with a live character counter.
 *
 * The counter is advisory, not a gate: `maxLength` sits far above the editorial
 * soft limit, so a long headline produces a warning rather than a headless stop.
 * Editors were previously blocked at 70 characters, which is shorter than plenty
 * of ordinary Russian headlines.
 */
export function TitleField({ value, onChange, error }: TitleFieldProps) {
  const id = useId();
  const length = value.trim().length;
  const over = length > TITLE_SOFT_LIMIT;
  const remaining = TITLE_SOFT_LIMIT - length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium text-neutral-700">
          Заголовок{" "}
          <span aria-hidden className="text-red-600">
            *
          </span>
        </label>
        <CharCounter value={value} limit={TITLE_SOFT_LIMIT} />
      </div>

      <input
        id={id}
        type="text"
        required
        maxLength={TITLE_MAX_LENGTH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Заголовок материала"
        aria-invalid={over || Boolean(error)}
        aria-required="true"
        className={cn(
          "w-full rounded-md border px-3 py-2 text-base outline-none transition-colors",
          "placeholder:text-neutral-400",
          "focus:ring-2",
          over || error
            ? "border-amber-500 bg-amber-50 focus:ring-amber-200"
            : "border-neutral-300 bg-white focus:border-neutral-500 focus:ring-neutral-200",
        )}
      />

      {over ? (
        <p role="status" className="text-sm text-amber-700">
          Заголовок длиннее {TITLE_SOFT_LIMIT} символов — на сайте он может
          занять несколько строк.
        </p>
      ) : null}

      {!over && remaining <= 25 ? (
        <p className="text-xs text-neutral-400">
          Осталось {remaining} символов до рекомендуемой длины.
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
