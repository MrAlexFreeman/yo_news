"use client";

import { useEffect, useState } from "react";
import { Check, Link2, Send, Share2 } from "lucide-react";

import { cn } from "@/lib/utils";

type ArticleShareProps = {
  /** Absolute URL of the story; the share targets need one, not a path. */
  url: string;
  title: string;
  className?: string;
};

type CopyState = "idle" | "copied" | "failed";

/**
 * Share row: VK, Telegram and copy-link.
 *
 * The two networks are plain links to their own share endpoints — no SDK, no script
 * from a third party, nothing to block or to go stale. That matters more than it
 * sounds: an embed script would be third-party code on every article page, and the
 * sanitiser work in this project exists to keep exactly that kind of thing out.
 *
 * Only copying needs JavaScript, which is why this is a client component at all: the
 * rest could be server-rendered anchors. The share text is computed here rather than
 * on the server because `location` only exists in the browser.
 */
export function ArticleShare({ url, title, className }: ArticleShareProps) {
  const [copied, setCopied] = useState<CopyState>("idle");

  // The confirmation clears itself. Without the reset the button keeps claiming the
  // link was copied long after the reader stopped caring, and a second click on a
  // stale "copied" state looks broken.
  useEffect(() => {
    if (copied === "idle") return;
    const timer = window.setTimeout(() => setCopied("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyLink() {
    try {
      // `navigator.clipboard` is unavailable on an insecure origin and in some
      // embedded webviews, so it is feature-detected rather than assumed.
      if (!navigator.clipboard?.writeText) {
        setCopied("failed");
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  const button =
    "inline-flex min-h-9 items-center gap-1.5 rounded-sm border border-rule bg-white px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-yo hover:bg-yo/5 hover:text-yo-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yo";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span className="mr-1 inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink-soft uppercase">
        <Share2 className="size-3.5" aria-hidden />
        Поделиться
      </span>

      <a
        href={`https://vk.com/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={button}
      >
        <Send className="size-3.5" aria-hidden />
        ВКонтакте
      </a>

      <a
        href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={button}
      >
        <Send className="size-3.5" aria-hidden />
        Telegram
      </a>

      {/*
        A button, not an anchor: copying is not navigation and has no href to fall
        back to. The label changes to report the outcome, and `role="status"` tells a
        screen reader that something was said without stealing focus.
      */}
      <button type="button" onClick={copyLink} className={button}>
        {copied === "copied" ? (
          <>
            <Check className="size-3.5" aria-hidden />
            Ссылка скопирована
          </>
        ) : (
          <>
            <Link2 className="size-3.5" aria-hidden />
            Копировать ссылку
          </>
        )}
      </button>

      <span role="status" className="sr-only">
        {copied === "copied"
          ? "Ссылка скопирована в буфер обмена"
          : copied === "failed"
            ? "Не удалось скопировать ссылку"
            : ""}
      </span>

      {copied === "failed" ? (
        <span className="text-xs text-red-600">
          Скопируйте вручную из адресной строки
        </span>
      ) : null}
    </div>
  );
}