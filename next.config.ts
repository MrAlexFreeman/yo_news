import type { NextConfig } from "next";

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
};

export default nextConfig;
