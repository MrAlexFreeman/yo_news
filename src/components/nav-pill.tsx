"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * One link in the rubric strip, which knows whether it is the page you are on.
 *
 * A client component, and specifically not `headers()` read in the layout: reading a
 * request header there would opt every public page out of static rendering, and the
 * whole site is prerendered with ISR on purpose. `usePathname` is the one source of
 * the current route that works without touching the server render at all.
 *
 * The strip previously hardcoded `aria-current="page"` on "Все новости", which meant
 * that pill claimed to be the current page on every article, category and forum page
 * in the site. Passing a boolean down from the layout instead would have fixed that
 * only by making the layout render on the client for every page, so the decision is
 * taken here instead.
 */
type NavPillProps = {
  href: string;
  label: string;
  /**
   * `muted` for the forum pill: it is not a rubric filter like the others, so it gets
   * a slightly different resting background to say so. The active state is identical
   * for every pill — a visitor who is on the forum should see the forum marked.
   */
  tone?: "default" | "muted";
};

const RESTING = {
  default:
    "border border-rule bg-white text-ink-soft hover:border-yo hover:bg-yo/5 hover:text-yo-ink hover:shadow-xs",
  muted:
    "border border-rule bg-paper-dim text-ink-soft hover:border-yo hover:bg-yo/5 hover:text-yo-ink hover:shadow-xs",
} as const;

/**
 * True when `pathname` is inside `href`.
 *
 * The trailing-slash test rather than `startsWith(href)`: without it a pill pointing
 * at `/forum` would light up on `/forums`, and one pointing at `/tags` would light up
 * on `/tagsomething`. The root is handled apart — `"/" + "/"` matches nothing, so
 * `pathname.startsWith("//")` would never make the home pill active.
 */
export function isCurrentPath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavPill({ href, label, tone = "default" }: NavPillProps) {
  const pathname = usePathname();
  const active = isCurrentPath(pathname, href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? // The same look the home pill always had: filled, no border.
            "inline-flex min-h-8 items-center rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold tracking-wide text-paper transition-transform hover:scale-[1.03]"
          : `inline-flex min-h-8 items-center rounded-full px-3.5 py-1.5 text-xs font-semibold tracking-wide transition-all ${RESTING[tone]}`
      }
    >
      {label}
    </Link>
  );
}