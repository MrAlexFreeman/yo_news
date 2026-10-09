import type { NextConfig } from "next";

import {
  FALLBACK_CATEGORY_SLUG,
  RETIRED_CATEGORY_SLUGS,
} from "./src/lib/categories";

const nextConfig: NextConfig = {
  images: {
    // Editors paste cover URLs from arbitrary hosts, so next/image cannot be
    // restricted to one CDN. Patterns stay on http(s) only, SVG stays off.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    dangerouslyAllowSVG: false,
  },

  /**
   * The 2026 rubric rework retired five rubrics and renamed one. Their stories were
   * reassigned and keep their own URLs, so no article link breaks — but the retired
   * rubric URLs themselves would 404, and a 404 on an address that was public is the
   * thing the rework set out to avoid. They are sent to the rubric that now holds the
   * stories, and the renamed one to its new address.
   *
   * Built from the same list the seed and the navigation use, so a rubric retired later
   * is redirected the moment it leaves that list.
   */
  async redirects() {
    return [
      ...RETIRED_CATEGORY_SLUGS.map((slug) => ({
        source: `/category/${slug}`,
        destination: `/category/${FALLBACK_CATEGORY_SLUG}`,
        permanent: true,
      })),
      {
        source: "/category/incident",
        destination: "/category/incidents",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
