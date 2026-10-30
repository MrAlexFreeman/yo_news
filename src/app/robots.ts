import type { MetadataRoute } from "next";

import { SITEMAP_PATHS } from "@/lib/seo";
import { absoluteUrl } from "@/lib/site";

/**
 * robots.txt. The admin area is excluded so editor URLs never appear in search
 * results, and the RSS feed is advertised as a crawlable alternative.
 *
 * Two sitemaps: the general one for the archive, and the news one for the last 48 hours.
 * Google News reads the second, and listing both here is how Search Console finds it without
 * anyone submitting the URL by hand.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/admin/", "/search"],
      },
    ],
    sitemap: SITEMAP_PATHS.map((path) => absoluteUrl(path)),
    host: absoluteUrl("/"),
  };
}
