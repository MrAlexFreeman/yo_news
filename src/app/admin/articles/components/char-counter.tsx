"use client";

import { cn } from "@/lib/utils";

type CharCounterProps = {
  value: string;
  /** Mirrors the field's soft limit; counters without one never turn red. */
  limit?: number;
  /**
   * Advisory threshold below `limit`. Passing one adds a middle state: over this
   * the readout goes amber, over `limit` it goes red. Used where a third party's
   * rules bite before the editorial limit does.
   */
  warnAt?: number;
  label?: string;
};

/**
 * Live "Знаков: X" readout. When a limit is given it also tracks how many
 * characters remain, so the editor sees the budget shrink.
 */
export function CharCounter({
  value,
  limit,
  warnAt,
  label = "Знаков",
}: CharCounterProps) {
  const count = value.trim().length;
  const over = limit !== undefined && count > limit;
  // Amber only in the band between the two thresholds, so a headline past the
  // editorial limit still reads as "this one is too long", not "heads up".
  const warn = !over && warnAt !== undefined && count > warnAt;

  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        over
          ? "font-medium text-red-600"
          : warn
            ? "font-medium text-amber-600"
            : "text-neutral-400",
      )}
    >
      {label}: {count}
      {limit !== undefined && !over ? (
        <span className={warn ? "text-amber-300" : "text-neutral-300"}> / {limit}</span>
      ) : null}
    </span>
  );
}