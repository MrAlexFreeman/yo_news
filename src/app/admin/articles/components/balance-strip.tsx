"use client";

import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type ProviderBalance = {
  isSet: boolean;
  balance: string | null;
  error: string | null;
};

type Balances = { deepseek: ProviderBalance; deepinfra: ProviderBalance };

/** How often the figures refresh themselves while the form sits open. */
const REFRESH_MS = 60_000;

const EMPTY: Balances = {
  deepseek: { isSet: false, balance: null, error: null },
  deepinfra: { isSet: false, balance: null, error: null },
};

/**
 * The remaining credit on both providers, shown in the cover panel.
 *
 * Shown before a generation rather than after, because the useful question is "is
 * there enough money left to try", and an editor who has already clicked is too late
 * to act on the answer.
 *
 * Read-only and free: both are account endpoints, not billable work. Refreshed on a
 * timer rather than on every render, so opening the form does not fire a request per
 * keystroke. No spinner on purpose — the request answers in a few hundred
 * milliseconds, so a flash of loading state would be noise, and the figures simply
 * appear.
 *
 * The write-up of the effect is deliberate: the first `await` comes before any state
 * write, which keeps this an ordinary async effect rather than one that sets state
 * synchronously on mount.
 */
export function BalanceStrip({ className }: { className?: string }) {
  const [balances, setBalances] = useState<Balances>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const response = await fetch("/api/admin/balances");
        if (cancelled || !response.ok) return;
        setBalances((await response.json()) as Balances);
      } catch {
        // A balance that will not load must not block generating a cover: the strip
        // keeps whatever it last showed rather than showing an error.
      }
    };

    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const rows = [
    { label: "DeepSeek", value: balances.deepseek },
    { label: "DeepInfra", value: balances.deepinfra },
  ];

  const anyKnown = rows.some((row) => row.value.balance);
  const allUnset = rows.every((row) => !row.value.isSet);

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 font-medium text-neutral-600">
        <Wallet className="size-3.5" aria-hidden />
        Баланс
      </span>

      {allUnset ? (
        <span className="text-neutral-400">ключи не заданы — генерация вернёт ошибку</span>
      ) : null}

      {rows.map((row) => (
        <span key={row.label} className="flex items-baseline gap-1">
          <span className="text-neutral-500">{row.label}:</span>
          {!row.value.isSet ? (
            <span className="text-neutral-400">не задан</span>
          ) : row.value.balance ? (
            <span className="font-mono text-neutral-800">{row.value.balance}</span>
          ) : (
            <span className="text-neutral-400">{row.value.error ?? "неизвестно"}</span>
          )}
        </span>
      ))}

      {!anyKnown && !allUnset ? (
        <span className="text-neutral-400">
          остаток виден в личных кабинетах провайдеров
        </span>
      ) : null}
    </div>
  );
}