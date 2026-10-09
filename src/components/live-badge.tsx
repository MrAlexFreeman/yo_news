import Link from "next/link";

import type { LiveStreamView } from "@/lib/live-stream";
import { cn } from "@/lib/utils";

/**
 * The «Прямой эфир» badge, as it appears in the masthead and in the compact bar.
 *
 * One component for both, because they are the same decision shown twice. Written twice,
 * the compact bar's copy was the one that drifted: the brief asks for the button to disappear
 * entirely when the stream is off, and a second implementation is exactly where that rule
 * quietly stops holding.
 *
 * **Why `null` and not a hidden element.** Returning nothing when the badge is off is the
 * whole point of the setting, and it is what keeps the search icon pressed to the right edge:
 * the controls group is `ml-auto`, so it sits at the far end whatever it contains. A hidden
 * badge — `hidden`, `opacity-0`, `w-0` — would leave its padding behind and shift the search
 * icon inward by the width of a label that is not there, which is visible on every page of
 * the site the moment the editor turns the stream off.
 *
 * **Why a badge with no URL is not a link.** `href` is null when no safe destination is
 * configured, and the badge then prints as plain text with no hover state. Rendering an
 * `<a>` with an empty href would navigate to the current page; inventing a `/live` route would
 * put a 404 in the masthead. Neither is better than saying plainly that there is nowhere to
 * go yet.
 */
export function LiveBadge({
  live,
  className,
  variant = "masthead",
}: {
  live: LiveStreamView;
  className?: string;
  /** `compact` is the slimmer type inside the 52px scrolled bar. */
  variant?: "masthead" | "compact";
}) {
  if (!live.enabled) return null;

  const compact = variant === "compact";

  const label = (
    <>
      <span
        className={cn("live-dot shrink-0 rounded-full bg-live", compact ? "size-1.5" : "size-2")}
        aria-hidden
      />
      {live.title}
    </>
  );

  const classes = cn(
    "items-center rounded-full font-semibold tracking-wide uppercase",
    "transition-colors",
    compact
      ? "gap-1.5 px-2 py-1 text-[10px]"
      : "gap-2 border border-live/30 bg-live/10 px-3 py-1.5 text-[11px]",
    "text-live-ink",
    className,
  );

  /*
    `aria-hidden` on the pulsing dot is not decoration — the dot is the only part that moves,
    and a screen reader announcing a bullet point before the label is noise.
  */
  if (!live.href) {
    return <span className={cn(classes, "inline-flex")}>{label}</span>;
  }

  /*
    An external stream opens in a new tab, a site-relative one in the same tab. Deciding it
    from the URL rather than from a separate setting means the two can never disagree: an
    editor who pastes an external link gets a new tab because it is external, not because
    they remembered to tick something.
  */
  const external = /^https:\/\//i.test(live.href);

  return (
    <Link
      href={live.href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={cn(classes, "inline-flex hover:bg-live/15")}
    >
      {label}
    </Link>
  );
}