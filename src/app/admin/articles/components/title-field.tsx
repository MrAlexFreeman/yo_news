"use client";

import { useId } from "react";

import { CharCounter } from "@/app/admin/articles/components/char-counter";
import { TITLE_SOFT_LIMIT } from "@/app/admin/articles/types";
import { cn } from "@/lib/utils";

type TitleFieldProps = {
  value: string;
  onChange: (value: string) => void;
  error?: string;
};

/**
 * Required headline input with a live character counter. Past
 * TITLE_SOFT_LIMIT the border turns red and a warning appears — editors rely on
 * this to keep headlines from wrapping into three lines on the site.
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
        name="title"
        type="text"
        required
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
            ? "border-red-500 bg-red-50 focus:ring-red-200"
            : "border-neutral-300 bg-white focus:border-neutral-500 focus:ring-neutral-200",
        )}
      />

      {over ? (
        <p role="alert" className="text-sm font-medium text-red-600">
          ⚠ В заголовке больше 70 символов!
        </p>
      ) : null}

      {!over && remaining <= 10 ? (
        <p className="text-xs text-neutral-400">
          Осталось {remaining} символов до рекомендуемого лимита.
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
