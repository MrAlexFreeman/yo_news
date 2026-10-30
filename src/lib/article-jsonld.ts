import { SITE_NAME, absoluteUrl, siteUrl } from "@/lib/site";

/**
 * The `NewsArticle` markup Google News and Discover read.
 *
 * Built as data, apart from the page, for the same reason the sitemap is: what matters is the
 * shape — an absolute image, ISO dates, a named publisher with a logo — and a shape is
 * testable without rendering a page that needs a whole article and six related rows.
 */

/** The fields the markup reads. A subset of the row, so the page passes no more than it must. */
export type JsonLdArticle = {
  title: string;
  slug: string;
  lead?: string | null;
  coverImage?: string | null;
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The publisher logo.
 *
 * The brief names `https://eartnews.ru/logo.png`, and **no such file exists** — measured on
 * production, `/logo.png` answers 404 while the brand mark ships as the PWA icon at
 * `/icons/icon-512.png` (512×512, served 200). Google's requirement is a real, crawlable
 * image of at least 112×112, so the markup points at the icon that exists rather than at an
 * address that would fail the check.
 */
export const PUBLISHER_LOGO_PATH = "/icons/icon-512.png";

/**
 * The byline.
 *
 * The schema has no author column: the desk publishes under the masthead, and `photoAuthor`
 * is the picture credit rather than the writer. The brief's `article.author?.name` therefore
 * always falls back, and putting a made-up person in the markup would name someone who is
 * nowhere on the page.
 */
export const EDITORIAL_AUTHOR = "Редакция Ё-новости";

export function buildArticleJsonLd(article: JsonLdArticle) {
  const published = article.publishedAt ?? article.createdAt;
  const lead = article.lead?.trim();

  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    // The canonical address of the story itself; a syndicated copy should point here.
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(`/news/${article.slug}`) },
    headline: article.title,
    ...(lead ? { description: lead } : {}),
    /*
      A cover is optional in the schema, and `[null]` is not "no image" to a validator — it is
      an invalid value. A story without a picture therefore omits the field instead of
      declaring an empty one.
    */
    ...(article.coverImage ? { image: [absoluteUrl(article.coverImage)] } : {}),
    datePublished: published.toISOString(),
    dateModified: article.updatedAt.toISOString(),
    author: [{ "@type": "Person", name: EDITORIAL_AUTHOR }],
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: siteUrl,
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl(PUBLISHER_LOGO_PATH),
      },
    },
  };
}

/**
 * JSON for a `<script type="application/ld+json">`.
 *
 * `<` becomes `\u003c` because the JSON is injected as raw HTML: a headline containing
 * `</script>` would otherwise close the tag and drop the rest of the object into the page as
 * markup. To any JSON parser the value is unchanged.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
