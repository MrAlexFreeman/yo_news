import { Rss, Send, type LucideIcon } from "lucide-react";
import { useId } from "react";

import { DZEN_URL, TG_URL, VK_COMMUNITY_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

type Channel = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Applied to the Telegram slot only, so an empty value hides the button. */
  hint?: string;
};

const CHANNELS: Channel[] = [
  { href: DZEN_URL, label: "Наш канал в Дзене", icon: Rss },
  { href: VK_COMMUNITY_URL, label: "Мы во ВКонтакте", icon: Send },
  // No fallback on purpose: without a configured channel there is nothing to
  // point at, so the button is left out rather than rendered dead.
  ...(TG_URL ? [{ href: TG_URL, label: "Telegram-канал", icon: Send }] : []),
];

type SubscribeBlockProps = {
  /** "card" sits in a page column, "inline" closes a story. */
  variant?: "card" | "inline";
  className?: string;
};

/**
 * "Subscribe to Ё-новости" block for readers.
 *
 * Every destination is external, so each link is marked as such: middle-click and
 * "open in new tab" are what readers actually use on a block like this, and
 * without rel=noopener the opened page gets a handle on this one.
 */
export function SubscribeBlock({ variant = "card", className }: SubscribeBlockProps) {
  const inline = variant === "inline";
  // Per-instance id. The article page shows this block twice — in the sidebar and
  // again at the end of the story — and a hardcoded id would put two elements with the
  // same id in one document, which is invalid HTML and silently breaks the
  // `aria-labelledby` pointing at it.
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "rounded-sm border border-rule bg-paper-dim",
        inline ? "mt-8 px-4 py-4 sm:px-6 sm:py-5" : "px-4 py-4",
        className,
      )}
    >
      <h2
        id={headingId}
        className={cn(
          "font-[family-name:var(--font-lora)] font-bold text-ink",
          inline ? "text-lg" : "text-base",
        )}
      >
        Подписывайтесь на «Ё-новости» в удобном формате
      </h2>

      <p className="mt-1 text-xs text-ink-soft">
        Новости выходят сразу и без рекламы в дублях.
      </p>

      <ul
        className={cn(
          "mt-3 grid gap-2",
          inline ? "sm:grid-cols-3" : "grid-cols-1",
        )}
      >
        {CHANNELS.map((channel) => {
          const Icon = channel.icon;
          return (
            <li key={channel.href}>
              <a
                href={channel.href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "flex min-h-10 items-center justify-center gap-2 rounded-sm border border-rule bg-white px-3 py-2",
                  "text-sm font-medium text-ink transition-colors",
                  "hover:border-yo hover:bg-yo/5 hover:text-yo-ink",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yo",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {channel.label}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}