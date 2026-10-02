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

/** Builds an absolute URL from a site-relative path. */
export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl).toString();
}
