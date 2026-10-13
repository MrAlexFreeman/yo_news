import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";

import { NativeShell } from "@/components/native-shell";
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
  /*
    The Android app, built as a TWA over this site.
   *
    Served from `public/manifest.json` rather than an `app/manifest.ts` route: Next's route
    only answers at `/manifest.webmanifest` and its `path` export is not honoured, and when a
    manifest route exists Next emits the `<link rel="manifest">` itself, overriding whatever
    this field says. The `.json` file is the only way to land on the URL the TWA build is
    configured with — measured, not assumed: `/manifest.json` 404s while `app/manifest.ts` is
    in place.
   */
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Ё-Новости",
  },
  icons: {
    /*
      The brand mark is a photograph-like render, so it is a raster file and there is no SVG
      among these icons: a vector cannot carry the globe, the lighting or the 3D letter, and an
      SVG wrapping the same bitmap would be the same bytes with an extra layer of indirection.

      `favicon.ico` is not listed here because it does not need to be: it lives at
      `src/app/favicon.ico`, and Next emits its own link for it with a content hash — so a
      changed icon reaches a reader who already has the old one cached, which a plain
      `/favicon.ico` cannot promise. Adding it here as well would print the same icon twice.
      That file carries 16/32/48 px frames and is what a browser actually shows in the tab; the
      PNG is the larger floor, and the apple icon is what iOS puts on the home screen — iOS
      ignores SVG and ignores the manifest, so without it a bookmark gets a screenshot of the page.
    */
    icon: [{ url: "/icon.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
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

/**
 * `themeColor` lives here rather than in `metadata`.
 *
 * The `metadata` field of the same name has been deprecated since Next 14 and emits the
 * identical `<meta name="theme-color">` tag from the viewport export — the moved field still
 * works, but it is on its way out, and this app's whole reason for setting it is Android
 * colouring the status bar. Both exports are needed: Next 16 warns when `viewport` sits inside
 * `metadata`, and equally when a deprecated field is used in place of the viewport export.
 */
export const viewport: Viewport = {
  themeColor: "#ffffff",
  /*
    `viewport-fit=cover` — то, без чего `env(safe-area-inset-*)` не работает.

    В Android-приложении (Capacitor, RuStore) страница рисуется под системной строкой статуса и
    под жестовой полосой снизу; без этого флага браузер оставляет чёрные поля по краям выреза, и
    ни один из отступов ниже не срабатывает. В обычном мобильном браузере флаг безвреден.
  */
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${inter.variable} ${lora.variable} h-full antialiased`}
    >
      {/*
        Нижний безопасный отступ — на теле, а не на футере: так он работает для любой страницы,
        включая те, что заканчиваются не подвалом, и ничего не сдвигает, когда выреза нет
        (`env()` вне жестового режима даёт 0).
      */}
      <body className="flex min-h-full flex-col bg-paper text-ink pb-[env(safe-area-inset-bottom)]">
        {/* В браузере не рисует ничего; в оболочке RuStore вешает кнопку «Назад» и статус-бар. */}
        <NativeShell />
        {children}
      </body>
    </html>
  );
}
