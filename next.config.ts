import type { NextConfig } from "next";

import {
  FALLBACK_CATEGORY_SLUG,
  RETIRED_CATEGORY_SLUGS,
} from "./src/lib/categories";

const nextConfig: NextConfig = {
  /**
   * Type errors are a gate, but not this one.
   *
   * `next build` runs `tsc` inside its own process, next to Turbopack's compiled graph. On
   * the 709 MB deployment that phase is what the OOM killer takes first: both failed builds
   * of 2026-11-25 printed "Compiled successfully", then "Running TypeScript ...", then a
   * kill, and left `.next` without a BUILD_ID. `deploy.sh` therefore runs `npm run typecheck`
   * as its own step before the build — same compiler, same config, the whole box to itself —
   * and `npm run check` has always included it. Nothing is shipped that `tsc --noEmit` has
   * not approved; it is only checked in a process that can survive.
   */
  typescript: { ignoreBuildErrors: true },

  images: {
    // Editors paste cover URLs from arbitrary hosts, so next/image cannot be
    // restricted to one CDN. Patterns stay on http(s) only, SVG stays off.
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    dangerouslyAllowSVG: false,
    /*
      The default is 60 seconds: an optimised variant whose URL has not been seen for a
      minute is re-encoded from the source on the next request. Upload filenames are UUIDs
      and the bytes behind them now change only when the file is replaced deliberately, so
      a variant can be kept for a month. On a single core this is CPU spent once per size
      instead of once per minute, and it is what makes a cold cache stop being a slow page.
    */
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  /**
   * Static art under `public/` is served by Next with `cache-control: public, max-age=0`,
   * so every repeat visit re-downloads the mascots (127 KB and 140 KB) and revalidates the
   * icons. The audit counted both as missing cache policy. Names here change only when the
   * artwork does, which is rare and under our control — a month is long enough to remove
   * the re-download and short enough that a replaced mascot is not stranded for a year.
   */
  async headers() {
    const artCache = "public, max-age=2592000, stale-while-revalidate=604800";
    return [
      { source: "/mascots/:path*", headers: [{ key: "Cache-Control", value: artCache }] },
      { source: "/icons/:path*", headers: [{ key: "Cache-Control", value: artCache }] },
      { source: "/placeholder.png", headers: [{ key: "Cache-Control", value: artCache }] },
    ];
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
