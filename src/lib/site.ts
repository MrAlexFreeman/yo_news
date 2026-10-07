import { parseEnabled } from "@/lib/settings-keys";

/** Site-wide branding and absolute URL config, shared by server and client. */

/** Absolute base for canonical/OpenGraph URLs; falls back to localhost. */
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";

export const SITE_NAME = "Ё-новости";

/** Used as the `<title>` suffix and the default meta description. */
export const SITE_TAGLINE = "События, о которых говорят";

/** Longer form for the footer and the about page. */
export const SITE_TAGLINE_LONG =
  "События, о которых говорят | Новости Екатеринбурга и мира";

/** Legal entity line shown in the footer. */
export const SITE_LEGAL_NAME = "Сетевое издание Ё-новости";

/** Short brand mark used in tight spaces (article placeholders, alt text). */
export const SITE_SHORT_NAME = "Ё";

/** RSS channel title and description. */
export const RSS_CHANNEL_TITLE = "Ё-новости";
export const RSS_CHANNEL_DESCRIPTION = SITE_TAGLINE_LONG;

/**
 * Official VK community link, rendered in the footer.
 *
 * Overridable through NEXT_PUBLIC_VK_URL so the same deployed build can follow a
 * renamed community without a code change. The fallback is the exact address, not
 * a bare vk.com — a generic link points readers at VK's homepage rather than at us.
 */
export const VK_COMMUNITY_URL =
  process.env.NEXT_PUBLIC_VK_URL?.trim() || "https://vk.ru/eartnews";

/**
 * Syndication destinations for the subscribe block.
 *
 * `TG_URL` is deliberately nullable rather than defaulted: an empty value means
 * "we have no Telegram channel", and the button is hidden instead of pointing
 * readers somewhere that does not exist. The other two have a real destination to
 * fall back to.
 */
export const DZEN_URL =
  process.env.NEXT_PUBLIC_DZEN_URL?.trim() || "https://dzen.ru/";

export const TG_URL = process.env.NEXT_PUBLIC_TG_URL?.trim() || null;

/** Builds an absolute URL from a site-relative path. */
export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl).toString();
}

/**
 * Yandex Metrika counter id, or null when analytics are not configured.
 *
 * Deliberately nullable rather than defaulted, and the reason is not style: a
 * hardcoded fallback counter would send this site's traffic to whichever counter that
 * number belongs to. If it is not ours then a third party receives our readers'
 * browsing data, and nothing on this site would show it — the number would look
 * correct in the source and wrong only in someone else's report.
 *
 * With no id configured nothing is rendered at all, which is the honest state for a
 * site that has not set up analytics and is visible in the markup.
 *
 * `NEXT_PUBLIC_` because the id is inlined into the client bundle and printed in the
 * page source for every reader; it identifies the counter and is not a secret.
 */
export const YANDEX_METRIKA_ID =
  process.env.NEXT_PUBLIC_YANDEX_METRIKA_ID?.trim() || null;

/**
 * Whether Webvisor (session recording) is enabled.
 *
 * On by default because the official snippet asks for it, and off with
 * NEXT_PUBLIC_YANDEX_METRIKA_WEBVISOR=false.
 *
 * Worth stating plainly, because it is not a neutral switch: Webvisor records what a
 * visitor types, not only where they click. On this site that includes the forum
 * form, where readers type a display name and their post text. The counter lives in
 * the `(public)` layout rather than the root one, which keeps the editorial area out
 * of it — that is what stops the admin's own forms from being recorded, and it is the
 * reason the flag is documented rather than assumed.
 */
export const YANDEX_METRIKA_WEBVISOR = parseEnabled(
  process.env.NEXT_PUBLIC_YANDEX_METRIKA_WEBVISOR ?? "",
  true,
);
