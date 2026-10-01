"use client";

import { cn } from "@/lib/utils";

type CharCounterProps = {
  value: string;
  /** Mirrors the title's soft limit; counters without one never turn red. */
  limit?: number;
  label?: string;
};

/**
 * Live "Знаков: X" readout. When a limit is given it also tracks how many
 * characters remain, so the editor sees the budget shrink.
 */
export function CharCounter({ value, limit, label = "Знаков" }: CharCounterProps) {
  const count = value.trim().length;
  const over = limit !== undefined && count > limit;

  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        over ? "font-medium text-red-600" : "text-neutral-400",
      )}
    >
      {label}: {count}
      {limit !== undefined && !over ? (
        <span className="text-neutral-300"> / {limit}</span>
      ) : null}
    </span>
  );
}
