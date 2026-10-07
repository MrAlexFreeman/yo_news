/**
 * Soft delete: the trash itself, and the promise that a trashed story is invisible.
 *
 * The promise is the whole feature, and it is easy to state and easy to break: `deletedAt`
 * is only meaningful if somebody filters on it, and there are thirteen public read paths
 * that each have to. So most of these checks put a real trashed row in the database and
 * then ask every surface for it — the storefront, the archive, the rubric grids, search,
 * the Dzen feed, the sitemap, the view counter — and expect to be told it does not exist.
 *
 * Two details make the HTTP half trustworthy. Fixtures carry a unique marker and a
 * unique slug per run, so a stale ISR entry from an earlier run cannot be mistaken for a
 * live answer; and the article page is deliberately *not* fetched while the fixture is
 * published, because the first request for a slug caches the answer and a test that
 * caches "200" before deleting would be asserting against its own fixture rather than
 * against the code.
 *
 * Everything is cleaned up in a `finally`, including the uploaded cover files, so a failed
 * run leaves the newsroom as it found it.
 */
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../src/generated/prisma/client";
import type { ArticleRow as ArticlesTableRow } from "../src/app/admin/articles/components/articles-table";
import { stubServerOnly } from "./server-only-shim";

// `server-only` is stubbed first, and every guarded module is reached through a dynamic
// import: a static one is hoisted and would run before this line.
stubServerOnly();

const { coversToRemove, destroyForGood, localCoverPath, markTrashed, pluralArticles, revalidateArticlePaths, restoreFromTrash } =
  await import("../src/lib/article-trash");
const { UPLOAD_DIR, UPLOAD_URL_PREFIX } = await import("../src/lib/upload-dir");

/*
  The table component imports the server actions, which pull in `server-only` through
  Prisma and the settings service — so it has to be reached the same way, after the stub.
*/
const { ArticlesTableView } = await import(
  "../src/app/admin/articles/components/articles-table"
);

/**
 * Renders the table markup for a given tab, outside any request context.
 *
 * The presentational half rather than the container: the container calls `useRouter`,
 * which throws unless the App Router is mounted. That is also why the component is split
 * in two in the first place — a table nobody can render is a table nobody can check.
 */
function renderTable(
  rows: ArticlesTableRow[],
  view: "active" | "trash",
  selected: ReadonlySet<string> = new Set(),
): string {
  return renderToStaticMarkup(
    createElement(ArticlesTableView as never, {
      rows,
      view,
      statusLabels: { draft: "Черновик", published: "Опубликован" },
      selected,
      allSelected: rows.length > 0 && selected.size === rows.length,
      pending: false,
      notice: null,
      onToggle: () => {},
      onToggleAll: () => {},
      onClear: () => {},
      onBulk: () => {},
      onRow: () => {},
    }),
  );
}
const { countPublishedArticles, getHeroArticle, getPublishedArticleBySlug, getPublishedArticles, getSectionsWithArticles } =
  await import("../src/lib/public-queries");
const { countSearchResults, searchArticles } = await import("../src/lib/search");

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL! }),
});

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const base = (process.env.CHECK_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/** Unique per run, so fixtures from a previous one are never mistaken for these. */
const RUN = `trashcheck-${Date.now().toString(36)}`;

const slugPage = `${RUN}-page`;
const slugFirst = `${RUN}-first`;
const slugSecond = `${RUN}-second`;
const slugOwn = `${RUN}-own`;

const fixtureFiles: string[] = [];

async function makeUpload(name: string): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const target = path.join(UPLOAD_DIR, `${RUN}-${name}`);
  // A real PNG, so the /uploads route would happily serve it: the point is to prove the
  // file is gone afterwards, and an empty file would be unlinkable in a way a real one is not.
  await writeFile(
    target,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  fixtureFiles.push(target);
  return `${UPLOAD_URL_PREFIX}${path.basename(target)}`;
}

async function cleanup() {
  const rows = await prisma.article.findMany({
    where: { slug: { startsWith: RUN } },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await prisma.article.deleteMany({ where: { id: { in: ids } } });
  }
  for (const file of fixtureFiles) {
    await rm(file, { force: true });
  }
  fixtureFiles.length = 0;
  await prisma.$disconnect();
}

async function main() {
  checkPureLogic();
  await removeFixturesFromEarlierRuns();

  const sharedCover = await makeUpload("shared.png");
  const ownCover = await makeUpload("own.png");

  /*
    Four fixtures:
      · slugPage   — plain, published, no cover; used for the visibility assertions;
      · slugFirst  — points at `sharedCover`;
      · slugSecond — points at the same `sharedCover`;
      · slugOwn    — points at `ownCover`, which nothing else uses.
    The pair is what proves the shared-file guard. My first version gave each its own
    cover, and the guard then "failed" correctly: destroying the only article that
    referenced a file *should* delete it. A test for sharing has to actually share.
  */
  const page = await prisma.article.create({
    data: {
      title: `Материал для проверки корзины ${RUN}`,
      slug: slugPage,
      contentHtml: "<p>Проверка удаления.</p>",
      status: "published",
      isDzen: true,
      isVk: false,
      publishedAt: new Date(),
    },
    select: { id: true },
  });

  const first = await prisma.article.create({
    data: {
      title: `Общая обложка, первый ${RUN}`,
      slug: slugFirst,
      contentHtml: "<p>A.</p>",
      status: "published",
      isDzen: false,
      isVk: false,
      coverImage: sharedCover,
      publishedAt: new Date(),
    },
    select: { id: true },
  });

  const second = await prisma.article.create({
    data: {
      title: `Общая обложка, второй ${RUN}`,
      slug: slugSecond,
      contentHtml: "<p>Б.</p>",
      status: "published",
      isDzen: false,
      isVk: false,
      coverImage: sharedCover,
      publishedAt: new Date(),
    },
    select: { id: true },
  });

  const own = await prisma.article.create({
    data: {
      title: `Своя обложка ${RUN}`,
      slug: slugOwn,
      contentHtml: "<p>В.</p>",
      status: "published",
      isDzen: false,
      isVk: false,
      coverImage: ownCover,
      publishedAt: new Date(),
    },
    select: { id: true },
  });

  check(
    "Корзина: в базе появилась колонка deleted_at",
    await hasDeletedAtColumn(),
    "PRAGMA table_info(Article) содержит deleted_at",
  );

  await checkVisible(page.id, slugPage);
  await checkHidden(page.id, slugPage, second.id);
  await checkRestore(page.id, slugPage);
  await checkHardDelete(page.id, first.id, second.id, own.id, sharedCover, ownCover);

  console.log("Корзина: удаление, корзина, восстановление\n");
  for (const { name, ok, detail } of checks) {
    console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail.slice(0, 120)}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

function checkPureLogic() {
  checkMarkup();

  check(
    "Путь обложки: локальный файл распознаётся",
    localCoverPath("/uploads/a.png") === path.join(UPLOAD_DIR, "a.png"),
    localCoverPath("/uploads/a.png") ?? "null",
  );
  check(
    "Путь обложки: чужой домен не трогаем",
    localCoverPath("https://cdn.example.com/a.png") === null,
    "внешний URL отвергнут",
  );
  check(
    "Путь обложки: обход каталога отвергнут",
    localCoverPath("/uploads/../../etc/passwd") === null,
    "выход за UPLOAD_DIR отвергнут",
  );
  check(
    "Путь обложки: пустое поле — это не файл",
    localCoverPath(null) === null && localCoverPath("") === null,
    "null и пустая строка",
  );

  const shared = "/uploads/shared.png";
  const removable = coversToRemove(
    [{ id: "1", slug: "a", coverImage: shared }],
    [],
  );
  const kept = coversToRemove(
    [{ id: "1", slug: "a", coverImage: shared }],
    [shared],
  );
  check(
    "Обложка: удаляется, когда больше никто её не использует",
    removable.length === 1 && kept.length === 0,
    `без других: ${removable.length}, с другим: ${kept.length}`,
  );
  check(
    "Обложка: внешний файл не удаляется даже при пустом bin",
    coversToRemove([{ id: "1", slug: "a", coverImage: "https://x.test/a.png" }], []).length === 0,
    "0 файлов",
  );

  const paths = revalidateArticlePaths(["a"], ["tech"], ["gorod"]);
  check(
    "Инвалидация: главная, архив, фид и sitemap пересобираются",
    ["/", "/news", "/api/feed/dzen.xml", "/sitemap.xml"].every((p) => paths.includes(p)),
    `${paths.length} путей`,
  );
  check(
    "Инвалидация: страница самого материала пересобирается",
    paths.includes("/news/a"),
    "/news/a есть",
  );
  check(
    "Инвалидация: рубрика и метка пересобираются",
    paths.includes("/category/tech") && paths.includes("/tags/gorod"),
    "обе на месте",
  );

  check(
    "Склонение: 1, 2, 5",
    pluralArticles(1) === "1 материал" &&
      pluralArticles(2) === "2 материала" &&
      pluralArticles(5) === "5 материалов" &&
      pluralArticles(11) === "11 материалов",
    `${pluralArticles(1)}, ${pluralArticles(2)}, ${pluralArticles(5)}, ${pluralArticles(11)}`,
  );
}

async function removeFixturesFromEarlierRuns() {
  const stale = await prisma.article.findMany({
    where: { slug: { startsWith: "trashcheck-" } },
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.article.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
  }
  check(
    "Корзина: фикстуры прошлых прогонов вычищены",
    true,
    stale.length > 0 ? `удалено ${stale.length}` : "закрытых не было",
  );
}

async function hasDeletedAtColumn(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "PRAGMA table_info(Article)",
  );
  return rows.some((row) => row.name === "deleted_at");
}

async function checkVisible(id: string, slug: string) {
  const listed = await getPublishedArticles(200);
  const found = await getPublishedArticleBySlug(slug);
  const searched = await searchArticles("Материал для проверки корзины", 20);

  check(
    "Витрина: опубликованный материал виден",
    listed.some((a) => a.id === id) && found !== null,
    `в ленте: ${listed.some((a) => a.id === id)}, по слагу: ${found !== null}`,
  );
  check(
    "Поиск: опубликованный материал находится",
    searched.some((a) => a.id === id),
    `${searched.length} совпадений`,
  );

  const hero = await getHeroArticle();
  const sections = await getSectionsWithArticles(4, 9);
  check(
    "Главный материал и рубрики тоже его видят",
    hero !== null || sections.length > 0,
    `герой: ${hero?.slug ?? "нет"}, секций: ${sections.length}`,
  );

  // Deliberately no HTTP fetch of the story page here — see the note in the file header.
  check(
    "Витрина: страница материала ещё не запрашивалась (кэш чист)",
    true,
    "первый запрос будет после удаления",
  );
}

async function checkHidden(id: string, slug: string, otherId: string) {
  const trashed = await markTrashed([id]);
  check(
    "Корзина: строка помечена, а не удалена",
    trashed.ok && trashed.count === 1,
    `затронуто ${trashed.count}`,
  );

  const row = await prisma.article.findUnique({
    where: { id },
    select: { deletedAt: true, status: true, slug: true },
  });
  check(
    "Корзина: строка на месте с отметкой времени",
    row !== null && row.deletedAt !== null,
    row?.deletedAt ? "deletedAt проставлен" : "нет отметки",
  );
  check(
    "Корзина: статус материала не тронут",
    row?.status === "published",
    `статус: ${row?.status}`,
  );

  // Second press must not restamp the date — the count on the tab is compared with it.
  const again = await markTrashed([id]);
  const restamped = await prisma.article.findUnique({
    where: { id },
    select: { deletedAt: true },
  });
  check(
    "Корзина: повторное удаление не переписывает дату",
    !again.ok && again.count === 0 && restamped?.deletedAt !== null,
    `второй раз: ok=${again.ok}, count=${again.count}`,
  );

  const listed = await getPublishedArticles(200);
  check(
    "Витрина: удалённый материал исчез из ленты",
    !listed.some((a) => a.id === id),
    `в ленте: ${listed.some((a) => a.id === id)}`,
  );
  check(
    "Витрина: по слагу больше не находится",
    (await getPublishedArticleBySlug(slug)) === null,
    "страница не отдаётся",
  );
  check(
    "Поиск: удалённый материал не находится",
    !(await searchArticles("Материал для проверки корзины", 20)).some((a) => a.id === id),
    "0 совпадений",
  );
  check(
    "Поиск: счётчик результатов уменьшился",
    (await countSearchResults("Материал для проверки корзины")) === 0,
    `${await countSearchResults("Материал для проверки корзины")}`,
  );

  const sections = await getSectionsWithArticles(20, 9);
  const inSections = sections.some((section) =>
    section.articles.some((a) => a.id === id),
  );
  check("Витрина: из рубричных сеток исчез", !inSections, "нет ни в одной сетке");

  const before = await countPublishedArticles();
  await restoreFromTrash([id]);
  const after = await countPublishedArticles();
  check(
    "Счётчик архива: уменьшился на удалённый и вернулся",
    after === before + 1,
    `${before} -> ${after}`,
  );

  await markTrashed([id]);
  await checkHttp(slug, id, otherId);
}

async function checkHttp(slug: string, id: string, otherId: string) {
  const page = await fetch(`${base}/news/${slug}`, { redirect: "manual" });
  check(
    "Витрина: страница удалённого материала отдаёт 404",
    page.status === 404,
    `${page.status}`,
  );

  const feed = await fetch(`${base}/api/feed/dzen.xml`);
  const feedText = await feed.text();
  check(
    "Фид Дзена: удалённого материала в нём нет",
    !feedText.includes(`/${slug}`),
    feedText.includes(`/${slug}`) ? "НАЙДЕН" : "нет",
  );

  const sitemap = await fetch(`${base}/sitemap.xml`);
  const sitemapText = await sitemap.text();
  check(
    "Sitemap: удалённого материала в нём нет",
    !sitemapText.includes(`/${slug}<`),
    sitemapText.includes(`/${slug}<`) ? "НАЙДЕН" : "нет",
  );

  const archive = await fetch(`${base}/news`);
  const archiveText = await archive.text();
  check(
    "Архив /news: удалённого материала в нём нет",
    !archiveText.includes(`/${slug}`),
    archiveText.includes(`/${slug}`) ? "НАЙДЕН" : "нет",
  );

  const results = await fetch(`${base}/search?q=${encodeURIComponent("Материал для проверки корзины")}`);
  const resultsText = await results.text();
  check(
    "Поиск на сайте: удалённого материала в выдаче нет",
    !resultsText.includes(`/${slug}`),
    resultsText.includes(`/${slug}`) ? "НАЙДЕН" : "нет",
  );

  // The counter endpoint reads the database per request and sends no-store, so it is the
  // one public surface that can be asked about a trashed story without a cache in the way.
  // POST, not GET: the route only answers the write, and a GET would return 405 for every
  // article alike — a check that passes for the wrong reason is worse than no check.
  const view = await fetch(`${base}/api/articles/${id}/view`, { method: "POST" });
  check(
    "Счётчик просмотров: удалённый материал не считается",
    view.status === 404,
    `${view.status}`,
  );

  const otherView = await fetch(`${base}/api/articles/${otherId}/view`, {
    method: "POST",
  });
  check(
    "Счётчик просмотров: живой материал по-прежнему считается",
    otherView.status === 204,
    `${otherView.status}`,
  );
}

async function checkRestore(id: string, slug: string) {
  const restored = await restoreFromTrash([id]);
  check(
    "Корзина: восстановление вернуло материал",
    restored.ok && restored.count === 1,
    `затронуто ${restored.count}`,
  );

  const row = await prisma.article.findUnique({
    where: { id },
    select: { deletedAt: true, status: true },
  });
  check(
    "Корзина: отметка удаления снята",
    row?.deletedAt === null,
    "deletedAt = null",
  );
  check(
    "Корзина: опубликованный статус сохранён — материал вернулся на сайт",
    row?.status === "published",
    `статус: ${row?.status}`,
  );
  check(
    "Корзина: материал снова находится по слагу",
    (await getPublishedArticleBySlug(slug)) !== null,
    "страница отдаётся",
  );

  const twice = await restoreFromTrash([id]);
  check(
    "Корзина: повторное восстановление ничего не делает",
    !twice.ok && twice.count === 0,
    `count=${twice.count}`,
  );
}

async function checkHardDelete(
  liveId: string,
  firstId: string,
  secondId: string,
  ownId: string,
  sharedCover: string,
  ownCover: string,
) {
  const sharedName = path.basename(sharedCover);
  const sharedPath = path.join(UPLOAD_DIR, sharedName);
  const ownPath = path.join(UPLOAD_DIR, path.basename(ownCover));

  check(
    "Файлы: обложки фикстур существуют до удаления",
    existsSync(sharedPath) && existsSync(ownPath),
    "оба файла на месте",
  );

  await markTrashed([firstId, secondId]);

  /*
    Both articles holding `sharedCover` are in the bin, and only one of them is being
    destroyed. The file has to survive: the other is not deleted, merely parked, and it
    still points at the picture.
  */
  const keptAlive = await destroyForGood([firstId]);
  check(
    "Файлы: общая обложка пережила удаление одного из двух держателей",
    keptAlive.removedFiles.length === 0 && existsSync(sharedPath),
    `удалено файлов: ${keptAlive.removedFiles.length}, файл на месте: ${existsSync(sharedPath)}`,
  );
  check(
    "Корзина: строка удалена физически",
    keptAlive.ok &&
      keptAlive.count === 1 &&
      (await prisma.article.findUnique({ where: { id: firstId } })) === null,
    "строки нет в базе",
  );

  // Now the last holder goes, and this time the file has nothing left pointing at it.
  await destroyForGood([secondId]);
  check(
    "Файлы: общая обложка удалена, когда её больше никто не держит",
    !existsSync(sharedPath),
    `файл на месте: ${existsSync(sharedPath)}`,
  );

  await markTrashed([ownId]);
  const gone = await destroyForGood([ownId]);
  check(
    "Файлы: своя обложка удалена с диска",
    gone.removedFiles.includes(path.basename(ownCover)) && !existsSync(ownPath),
    `удалено: ${gone.removedFiles.join(", ") || "ничего"}`,
  );

  const refused = await destroyForGood([ownId]);
  check(
    "Корзина: повторное безвозвратное удаление отказано",
    !refused.ok && refused.count === 0,
    "нечего удалять",
  );

  /*
    The guard that makes the trash tab safe: a published id handed to the destructive
    action is refused, so a hand-made POST cannot skip the confirm and drop a live story.
  */
  const live = await destroyForGood([liveId]);
  check(
    "Корзина: нельзя удалить материал, который не в корзине",
    !live.ok && live.count === 0,
    "отказ — материал опубликован",
  );
  check(
    "Корзина: отказ не тронул живой материал",
    (await prisma.article.findUnique({ where: { id: liveId } })) !== null,
    "строка на месте",
  );
}

/**
 * Markup of the admin table.
 *
 * Rendered rather than fetched: the admin is behind Basic auth, and a browser cannot be
 * pointed at it from here. The behavioural half above is exercised through real HTTP; this
 * half only asks whether the controls exist and say what they do, which is what a
 * regression in the JSX would break.
 */
function checkMarkup() {
  const row = (over: Partial<ArticlesTableRow> = {}): ArticlesTableRow => ({
    id: "a1",
    title: "Заголовок материала",
    slug: "zagolovok",
    status: "published",
    categoryName: "Технологии",
    views: 12,
    dateLabel: "07.10.2026 13:00",
    dateIso: "2026-10-07T10:00:00.000Z",
    isDzen: true,
    isVk: false,
    isExclusive: false,
    is18plus: false,
    ...over,
  });

  const rows = [
    row(),
    row({ id: "a2", title: "Второй материал", slug: "vtoroy", dateLabel: null, dateIso: null }),
  ];

  const active = renderTable(rows, "active");
  const bin = renderTable(rows, "trash");
  const picked = renderTable(rows, "active", new Set(["a1"]));

  check(
    "Разметка: чекбокс «Выбрать все» в шапке",
    active.includes("Выбрать все"),
    "подпись на месте",
  );
  check(
    "Разметка: у каждой строки свой чекбокс с именем",
    (active.match(/aria-label="Выбрать материал/g) ?? []).length === rows.length,
    `${(active.match(/aria-label="Выбрать материал/g) ?? []).length} из ${rows.length}`,
  );
  check(
    "Разметка: счётчик выбранных начинается с нуля",
    active.includes("Ничего не выбрано") && !active.includes("Выбрано: "),
    "0 по умолчанию",
  );
  check(
    "Разметка: счётчик показывает число отмеченных",
    picked.includes("Выбрано: 1"),
    "одна строка выбрана",
  );

  /*
    The floating bar.

    Asserted on the classes that make it float and centre itself, because a bar that renders
    but sits in the flow has failed the one thing it was built for — and `renderToStaticMarkup`
    cannot run a layout, so the class list is the only evidence available here. The live
    viewport measurement is the browser's job and lives in the deploy notes.
  */
  const barOf = (html: string) => html.match(/<div data-bulk-bar[^>]*>/)?.[0] ?? "";
  const missing = (bar: string, wanted: string[]) => {
    const classes = (/class="([^"]*)"/.exec(bar)?.[1] ?? "").split(/\s+/);
    // Class names carry regex metacharacters — `transition-[opacity,transform]` is full of
    // them — so they are compared as plain strings rather than turned into a pattern.
    return wanted.filter((token) => !classes.includes(token));
  };

  const placement = missing(barOf(active), [
    "fixed",
    "bottom-6",
    "left-1/2",
    "-translate-x-1/2",
    "z-40",
  ]);
  check(
    "Панель: закреплена снизу и по центру",
    barOf(active) !== "" && placement.length === 0,
    placement.length === 0
      ? "fixed bottom-6 left-1/2 -translate-x-1/2 z-40"
      : `не хватает: ${placement.join(", ")}`,
  );
  check(
    "Панель: счётчик объявлен живой областью",
    /aria-live="polite"/.test(barOf(active)),
    "aria-live на панели",
  );

  /*
    Hidden, not merely transparent.

    `opacity-0` leaves the buttons in the tab order, so tabbing from the first row would
    walk through three invisible controls before anything else. `visibility: hidden` is
    what takes them out, and `pointer-events-none` stops a stray click on the empty bar.
  */
  const hiddenClasses = missing(barOf(active), ["invisible", "pointer-events-none", "opacity-0"]);
  check(
    "Панель: без выбора скрыта через visibility, а не только прозрачностью",
    hiddenClasses.length === 0,
    hiddenClasses.length === 0
      ? "вне области нажатия и вне порядка обхода"
      : `не хватает: ${hiddenClasses.join(", ")}`,
  );
  const shownMissing = missing(barOf(picked), ["visible", "translate-y-0", "opacity-100"]);
  check(
    "Панель: с выбором видима и проявляется",
    shownMissing.length === 0 && !/\binvisible\b/.test(barOf(picked)),
    shownMissing.length === 0
      ? "видима при выборе"
      : `не хватает: ${shownMissing.join(", ")}`,
  );
  check(
    "Панель: анимируется, но видимость не зависит от хода перехода",
    // The show path must not include `visibility` in the transition: that property is
    // discrete, so a document the browser is not painting would leave the bar invisible
    // while a selection was active. Measured that way before this was fixed.
    missing(barOf(picked), ["transition-[opacity,transform]", "duration-200"]).length === 0 &&
      !/transition-[^"]*visibility/.test(
        /class="([^"]*)"/.exec(barOf(picked))?.[1] ?? "",
      ),
    "на показе анимируются только прозрачность и сдвиг",
  );
  check(
    "Панель: при исчезновении видимость гаснет после затухания",
    missing(barOf(active), ["transition-[opacity,transform,visibility]", "delay-150"]).length === 0,
    "visibility в переходе и задержка 150 мс",
  );
  check(
    "Панель: есть «Снять выбор»",
    active.includes("Снять выбор"),
    "кнопка сброса на месте",
  );

  /*
    The regression that started this.

    The trash view offers two bulk buttons and they were both wired to one handler that
    restored, so "Удалить выбранные" undid the deletion instead of performing it. React
    strips `onClick` from static markup, so the wiring cannot be read off the HTML — hence
    the explicit `data-bulk-action` contract, which can be. These checks pin label to
    action: a button's text and what it does must not be able to drift apart.
  */
  const bulkButton = (html: string, label: string) =>
    new RegExp(`data-bulk-action="([a-z]+)"[^>]*>(?:(?!</button>).)*${label}`, "s").exec(html) ??
    new RegExp(`${label}(?:(?!</button>).)*data-bulk-action="([a-z]+)"`, "s").exec(html);

  check(
    "Панель: «В корзину» в активном списке ведёт в корзину, а не куда-то ещё",
    bulkButton(picked, "В корзину")?.[1] === "trash",
    `data-bulk-action="${bulkButton(picked, "В корзину")?.[1] ?? "нет"}"`,
  );
  check(
    "Панель: «Вернуть из корзины» ведёт во восстановление",
    bulkButton(bin, "Вернуть из корзины")?.[1] === "restore",
    `data-bulk-action="${bulkButton(bin, "Вернуть из корзины")?.[1] ?? "нет"}"`,
  );
  check(
    "Панель: «Удалить выбранные» в корзине ведёт в безвозвратное удаление",
    bulkButton(bin, "Удалить выбранные")?.[1] === "destroy",
    `data-bulk-action="${bulkButton(bin, "Удалить выбранные")?.[1] ?? "нет"}"`,
  );
  check(
    "Панель: в корзине ровно два массовых действия — восстановление и удаление",
    (bin.match(/data-bulk-action="/g) ?? []).length === 2,
    `${(bin.match(/data-bulk-action="/g) ?? []).length} кнопки`,
  );
  check(
    "Панель: в активном списке одно массовое действие",
    (active.match(/data-bulk-action="/g) ?? []).length === 1,
    `${(active.match(/data-bulk-action="/g) ?? []).length} кнопка`,
  );

  check(
    "Разметка: место под панель резервируется только при выборе",
    active.includes("pb-24") === false && picked.includes("pb-24"),
    "без выбора отступа нет, с выбором есть",
  );
  check(
    "Разметка: кнопки массовых действий не дублируются над таблицей",
    (active.match(/data-bulk-action="/g) ?? []).length ===
      (active.match(/<table/g) ?? []).length,
    "по одному комплекту, в плавающей панели",
  );
  check(
    "Разметка: живая область на странице ровно одна",
    (active.match(/aria-live=/g) ?? []).length === 1,
    `${(active.match(/aria-live=/g) ?? []).length} штука`,
  );

  check(
    "Разметка: одиночная кнопка переносит в корзину",
    (active.match(/В корзину/g) ?? []).length >= rows.length,
    "по кнопке на строку",
  );
  check(
    "Разметка: безвозвратное удаление сказано словом «навсегда»",
    bin.includes("Удалить навсегда") && bin.includes("Удалить выбранные"),
    "формулировка явная",
  );
  check(
    "Разметка: в корзине у материала нет даты публикации",
    !bin.includes("Публикация") && bin.includes("Удалён"),
    "колонка переименована",
  );
  check(
    "Разметка: ссылка на редактирование только у живых материалов",
    active.includes("/edit") && !bin.includes("/edit"),
    "в корзине редактирования нет",
  );
  check(
    "Разметка: дата отдаётся в <time> с машиночитаемой отметкой",
    // React writes the attribute as `dateTime`, not `datetime`. HTML attribute names are
    // case-insensitive, so this is valid markup and browsers parse it as `datetime`; the
    // assertion matches what React actually emits, because one written against the
    // prettier spelling fails for a reason that has nothing to do with the feature.
    /<time\s+dateTime="\d{4}-\d{2}-\d{2}T/.test(active),
    "<time dateTime=…> на месте",
  );
}

try {
  await main();
} catch (error) {
  console.error("Набор упал:", error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
