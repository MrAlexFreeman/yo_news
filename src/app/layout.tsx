import type { Metadata } from "next";
import { Inter, Lora } from "next/font/google";

import { SITE_NAME, SITE_TAGLINE, SITE_TAGLINE_LONG, siteUrl } from "@/lib/site";

import "./globals.css";

/**
 * Body face. Cyrillic is not optional here: every string on the site is Russian, and a
 * family without that subset renders the whole publication in the fallback.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

/**
 * The type pair: an antiqua for anything that is a headline, a grotesque for everything
 * else. Body text, metadata, rubric kickers and interface stay on Inter — that split is
 * what makes a card read as a newspaper rather than as a page of serif.
 *
 * `weight: ["400", "600", "700"]` and not just the two the headlines use: the article
 * deck and the pull-quote in `.article-body blockquote` are Lora at its regular weight,
 * and a family loaded without that weight renders them in the Georgia fallback *inside* a
 * serif block, which is more visibly broken than not using the face at all.
 *
 * `display: "swap"` and self-hosted files: no request to Google at runtime, and the text
 * paints in the fallback immediately rather than waiting for a font that is already on
 * disk.
 */
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE_LONG}`,
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_TAGLINE_LONG,
  applicationName: SITE_NAME,
  generator: "Next.js",
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": "/api/feed/dzen.xml",
    },
  },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_TAGLINE_LONG,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_TAGLINE_LONG,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${inter.variable} ${lora.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-paper text-ink">
        {children}
      </body>
    </html>
  );
}
