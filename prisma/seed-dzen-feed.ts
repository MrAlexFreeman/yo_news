/**
 * Seeds published articles flagged for Dzen so the feed can be verified against
 * real rows. Run with: npm run db:seed:dzen
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../src/generated/prisma/client";
import { absoluteUrl } from "../src/lib/site";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  }),
});

const HOUR = 60 * 60 * 1000;

type Sample = {
  title: string;
  slug: string;
  lead: string | null;
  contentHtml: string;
  coverImage: string | null;
  isDzen: boolean;
  status: "draft" | "published";
  /** Hours before now; null for drafts. */
  hoursAgo: number | null;
};

const SAMPLES: Sample[] = [
  {
    title: 'Спецсимволы в фиде: "кавычки" и & амперсанд',
    slug: "specsimvoly-v-fide",
    lead: 'Проверка экранирования: < > & " \' и CDATA с ]]> внутри.',
    contentHtml:
      "<p>Текст с &lt;script&gt;alert(1)&lt;/script&gt; и кавычками.</p><p>Секция CDATA ]]> продолжается.</p>",
    // An absolute https URL so the <enclosure> branch of the feed is exercised.
// Pointed at our own bundled placeholder rather than picsum.photos: that used to
// be justified as "no broken image, no 404 in the log", but the VPS gets a 403
// from picsum, which is the same broken cover by a different name. The feed
// checker only cares that the URL is absolute.
coverImage: absoluteUrl("/placeholder.png"),
    isDzen: true,
    status: "published",
    hoursAgo: 1,
  },
  {
    title: "Материал без обложки и без лида",
    slug: "material-bez-oblozhki",
    lead: null,
    contentHtml: "<p>Короткий текст без дополнительных полей.</p>",
    coverImage: null,
    isDzen: true,
    status: "published",
    hoursAgo: 2,
  },
  {
    title: "Черновик — не должен попасть в ленту",
    slug: "chernovik-ne-v-lente",
    lead: "Этот материал в фид не попадёт.",
    contentHtml: "<p>Черновик.</p>",
    coverImage: null,
    isDzen: true,
    status: "draft",
    hoursAgo: null,
  },
  {
    title: "Опубликован, но без флага Дзен",
    slug: "bez-flega-dzen",
    lead: "Тоже мимо ленты.",
    contentHtml: "<p>Не отдаём.</p>",
    coverImage: null,
    isDzen: false,
    status: "published",
    hoursAgo: 3,
  },
];

async function main() {
  const now = Date.now();
  const society = await prisma.category.findUnique({
    where: { slug: "society" },
    select: { id: true },
  });

  for (const sample of SAMPLES) {
    const { hoursAgo, ...rest } = sample;
    const publishedAt =
      hoursAgo === null ? null : new Date(now - hoursAgo * HOUR);

    // The payload is applied on both branches on purpose: an empty `update`
    // would leave a stale fixture in place whenever the seed data changes.
    await prisma.article.upsert({
      where: { slug: sample.slug },
      update: {
        ...rest,
        subtitle: null,
        isVk: false,
        isExclusive: false,
        is18plus: false,
        categoryId: society?.id ?? null,
        publishedAt,
      },
      create: {
        ...rest,
        subtitle: null,
        isVk: false,
        isExclusive: false,
        is18plus: false,
        categoryId: society?.id ?? null,
        publishedAt,
      },
    });
  }

  const total = await prisma.article.count({
    where: { status: "published", isDzen: true },
  });
  console.log(`Готово. Опубликованных с флагом Дзен: ${total}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
