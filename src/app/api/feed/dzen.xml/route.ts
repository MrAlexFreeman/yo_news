import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { RSS_CHANNEL_DESCRIPTION, RSS_CHANNEL_TITLE } from "@/lib/site";

/** How many articles the feed exposes, newest first. */
const FEED_LIMIT = 50;

/**
 * Absolute base for item links. Falls back to localhost so a missing
 * NEXT_PUBLIC_SITE_URL yields a parseable feed instead of relative <link>s.
 */
function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const base = configured && configured.length > 0 ? configured : "http://localhost:3000";
  return base.replace(/\/+$/, "");
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Formats a date as RFC-822 in GMT: "Thu, 01 Oct 2026 08:11:21 GMT".
 *
 * Built by hand rather than via Intl: Intl's own layout is locale- and
 * engine-dependent (it emitted "Thu, Oct 01, 2026, 08:11:21", which is not
 * RFC-822), and RSS validators reject that.
 */
function toRfc822(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "GMT",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  // Some engines emit "24" for midnight; RFC-822 expects "00".
  const hour = get("hour") === "24" ? "00" : get("hour");

  return `${DAY_NAMES[date.getUTCDay()]}, ${get("day")} ${
    MONTH_NAMES[date.getUTCMonth()]
  } ${get("year")} ${hour}:${get("minute")}:${get("second")} GMT`;
}

/** Escapes the five XML predefined entities in text and attributes. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Wraps text in CDATA. Any literal "]]>" inside the payload has to be split,
 * otherwise it closes the section early and truncates the document.
 */
function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

type FeedArticle = Prisma.ArticleGetPayload<{
  select: {
    id: true;
    title: true;
    slug: true;
    lead: true;
    contentHtml: true;
    coverImage: true;
    publishedAt: true;
    createdAt: true;
    category: { select: { name: true } };
  };
}>;

/**
 * MIME type for the enclosure, derived from the stored URL.
 *
 * Hardcoding image/jpeg was fine while every cover was a picsum JPEG. The demo
 * covers are PNG and editors can upload WebP, and Dzen uses this attribute to
 * decide how to fetch the file, so it has to follow the actual format.
 */
function coverMimeType(url: string): string {
  const path = url.split("?")[0].split("#")[0].toLowerCase();
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

function renderItem(article: FeedArticle, base: string): string {
  const link = `${base}/news/${article.slug}`;
  const date = article.publishedAt ?? article.createdAt;

  const parts = [
    `      <title>${escapeXml(article.title)}</title>`,
    `      <link>${escapeXml(link)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(article.id)}</guid>`,
    `      <pubDate>${toRfc822(date)}</pubDate>`,
    `      <description>${cdata(article.lead ?? "")}</description>`,
    `      <content:encoded>${cdata(article.contentHtml)}</content:encoded>`,
  ];

  if (article.category) {
    parts.push(`      <category>${escapeXml(article.category.name)}</category>`);
  }

  if (article.coverImage) {
    // coverImage may be stored as a site-relative path (/uploads/x.png) when the
    // editor used the upload endpoint, so it needs the same absolutising as the
    // item link. RSS requires an absolute URI here and Dzen refuses to fetch a
    // relative one.
    const enclosure = /^https?:\/\//i.test(article.coverImage)
      ? article.coverImage
      : `${base}${article.coverImage.startsWith("/") ? "" : "/"}${article.coverImage}`;

    parts.push(
      `      <enclosure url="${escapeXml(enclosure)}" type="${coverMimeType(article.coverImage)}" length="0" />`,
    );
  }

  return `    <item>\n${parts.join("\n")}\n    </item>`;
}

function renderFeed(items: FeedArticle[], base: string, builtAt: Date): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(RSS_CHANNEL_TITLE)}</title>
    <link>${escapeXml(base)}</link>
    <atom:link href="${escapeXml(`${base}/api/feed/dzen.xml`)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(RSS_CHANNEL_DESCRIPTION)}</description>
    <language>ru</language>
    <lastBuildDate>${toRfc822(builtAt)}</lastBuildDate>
${items.map((article) => renderItem(article, base)).join("\n")}
  </channel>
</rss>
`;
}

export async function GET() {
  const articles = await prisma.article.findMany({
    where: { status: "published", isDzen: true },
    orderBy: { publishedAt: "desc" },
    take: FEED_LIMIT,
    select: {
      id: true,
      title: true,
      slug: true,
      lead: true,
      contentHtml: true,
      coverImage: true,
      publishedAt: true,
      createdAt: true,
      category: { select: { name: true } },
    },
  });

  const xml = renderFeed(articles, siteUrl(), new Date());

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      // Five minutes of shared caching, then serve stale while revalidating.
      "Cache-Control": "s-maxage=300, stale-while-revalidate",
    },
  });
}
