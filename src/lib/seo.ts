/**
 * The directives this site uses, typed so the constants are readable as objects.
 *
 * `Metadata["robots"]` is `string | Robots`, and a constant typed that way cannot be read
 * back — the check suite needs `ROBOTS_INDEXABLE.googleBot`, not a union. The shape below is
 * a subset of Next's `Robots` and is assignable to it.
 */
type RobotsDirectives = {
  index: boolean;
  follow: boolean;
  googleBot: {
    index: boolean;
    follow: boolean;
    "max-image-preview": "large";
    "max-video-preview": number;
    "max-snippet": number;
  };
};

/**
 * The `robots` block every indexable page must carry.
 *
 * `max-image-preview: large` is the load-bearing one for Google Discover: without it Google
 * shows a thumbnail instead of the full-width picture, and Discover's guidance names a large
 * image preview as a condition for the big card. `max-video-preview: -1` and
 * `max-snippet: -1` remove the remaining caps so a story can be shown whole.
 *
 * **Why a constant rather than a literal in the layout.** Measured on production before this
 * existed: `/news/<slug>` answered `<meta name="robots" content="index, follow">` — the
 * page's own `robots` overrides the layout's, because Next merges metadata shallowly, and the
 * article page only set `index`/`follow`. So the layout had the directive and every article
 * page silently dropped it, which is exactly where Discover reads it. One object, used
 * everywhere a page says "index me", is what stops that from happening again.
 */
export const ROBOTS_INDEXABLE: RobotsDirectives = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-video-preview": -1,
    "max-snippet": -1,
  },
};

/** The other half of the pair: a page that must stay out of the index. */
export const ROBOTS_NOINDEX: { index: false; follow: false } = { index: false, follow: false };

/**
 * Every sitemap the site publishes.
 *
 * The archive map and the Google News map (last 48 hours). `robots.txt` lists them all, and
 * keeping the list here means a new map cannot be added without robots.txt seeing it — the
 * failure mode otherwise is a sitemap nobody crawls.
 */
export const SITEMAP_PATHS = ["/sitemap.xml", "/news-sitemap.xml"] as const;
