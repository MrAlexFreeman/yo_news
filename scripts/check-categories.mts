/**
 * The 2026 rubric rework: the database, the single rubric list, and the category routes.
 *
 * Two halves. The first needs no server — the rows in `Category` match the list, the
 * admin fallback derives from it, and every rubric resolves to a real forum section.
 * The second fetches `/category/<slug>`, which is the part a unit test cannot see: a
 * rubric can exist in the database and still 404 because a route or a redirect is
 * wrong, and a 404 on an address that used to be public is the failure the rework had
 * to avoid.
 *
 * The base URL defaults to the dev server, the same assumption `feed:check` makes.
 * Override it with CATEGORIES_BASE when checking a deployed host.
 */
import { CATEGORIES, FALLBACK_CATEGORY_SLUG, RETIRED_CATEGORY_SLUGS } from "../src/lib/categories";
import { FALLBACK_CATEGORIES } from "../src/app/admin/articles/types";
import { FORUM_SEED_CATEGORIES } from "../src/lib/forum";
import { forumSectionForArticle } from "../src/lib/forum-rubric";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const TARGET_SLUGS = CATEGORIES.map((category) => category.slug);
const RETIRED = [...RETIRED_CATEGORY_SLUGS];

async function checkDatabase() {
  const { prisma } = await import("@/lib/prisma");
  const rows = await prisma.category.findMany({ select: { slug: true, name: true } });
  const bySlug = new Map(rows.map((row) => [row.slug, row.name]));

  check(
    "Рубрикатор: в базе ровно целевые рубрики",
    rows.length === CATEGORIES.length && TARGET_SLUGS.every((slug) => bySlug.has(slug)),
    rows.map((row) => row.slug).sort().join(", "),
  );

  const wrongNames = CATEGORIES.filter((category) => bySlug.get(category.slug) !== category.name);
  check(
    "Рубрикатор: названия совпадают со списком",
    wrongNames.length === 0,
    wrongNames.map((category) => `${category.slug}=${bySlug.get(category.slug)}`).join(", ") ||
      "все совпадают",
  );

  check(
    "Рубрикатор: удалённых рубрик не осталось",
    RETIRED.every((slug) => !bySlug.has(slug)),
    RETIRED.filter((slug) => bySlug.has(slug)).join(", ") || "ни одной",
  );

  // Not required to be zero — a story can legitimately carry no rubric — but the
  // migration reassigned articles rather than dropping them, so a large number here
  // would mean the reassignment silently failed.
  const orphaned = await prisma.article.count({ where: { categoryId: null } });
  check(
    "Рубрикатор: перенос не осиротил материалы",
    orphaned <= 3,
    `${orphaned} материалов без рубрики`,
  );

  await prisma.$disconnect();
}

function checkLists() {
  const fallbackSlugs = FALLBACK_CATEGORIES.map((category) => category.id);
  check(
    "Рубрикатор: запасной список админки совпадает с целевым",
    fallbackSlugs.join(",") === TARGET_SLUGS.join(","),
    fallbackSlugs.join(", "),
  );
  check(
    "Рубрикатор: запасные названия совпадают",
    FALLBACK_CATEGORIES.every(
      (category, index) => category.name === CATEGORIES[index]?.name,
    ),
    FALLBACK_CATEGORIES.map((category) => category.name).join(", "),
  );

  const forumSlugs: Set<string> = new Set(
    FORUM_SEED_CATEGORIES.map((category) => category.slug),
  );
  const unresolved = TARGET_SLUGS.filter(
    (slug) => !forumSlugs.has(forumSectionForArticle({ rubricSlug: slug }).slug),
  );
  check(
    "Рубрикатор: каждая рубрика ведёт в существующий раздел форума",
    unresolved.length === 0,
    unresolved.join(", ") || `${TARGET_SLUGS.length} рубрик разрешены`,
  );

  check(
    "Рубрикатор: порядок навигации — редакционный, а не алфавитный",
    TARGET_SLUGS[0] === "investigations" && TARGET_SLUGS[TARGET_SLUGS.length - 1] === "economy",
    TARGET_SLUGS.join(" → "),
  );
}

async function checkRoute(base: string, path: string): Promise<Response | null> {
  try {
    return await fetch(`${base}${path}`, { redirect: "follow" });
  } catch (error) {
    check(
      `Маршрут: ${path}`,
      false,
      error instanceof Error ? error.message : "сеть недоступна",
    );
    return null;
  }
}

async function checkRoutes(base: string) {
  for (const category of CATEGORIES) {
    const response = await checkRoute(base, `/category/${category.slug}`);
    if (!response) continue;
    const html = await response.text();
    check(
      `Маршрут: /category/${category.slug} отвечает 200 с заголовком`,
      response.status === 200 && html.includes(category.name),
      `HTTP ${response.status}`,
    );
  }

  // The retired rubrics must not 404: the stories moved, so the old addresses
  // redirect to the rubric that now holds them.
  for (const slug of RETIRED) {
    const response = await checkRoute(base, `/category/${slug}`);
    if (!response) continue;
    check(
      `Редирект: /category/${slug} ведёт на /category/${FALLBACK_CATEGORY_SLUG}`,
      response.status === 200 && response.url.endsWith(`/category/${FALLBACK_CATEGORY_SLUG}`),
      `HTTP ${response.status} → ${response.url.replace(base, "")}`,
    );
  }

  // Происшествия kept its articles but took the slug the grid asks for.
  const renamed = await checkRoute(base, "/category/incident");
  if (renamed) {
    check(
      "Редирект: /category/incident ведёт на /category/incidents",
      renamed.status === 200 && renamed.url.endsWith("/category/incidents"),
      `HTTP ${renamed.status} → ${renamed.url.replace(base, "")}`,
    );
  }
}

async function main() {
  const base = (process.env.CATEGORIES_BASE ?? "http://localhost:3000").replace(/\/+$/, "");

  await checkDatabase();
  checkLists();
  await checkRoutes(base);

  const failed = checks.filter((entry) => !entry.ok);
  for (const entry of checks) {
    console.log(`${entry.ok ? "OK  " : "FAIL"} ${entry.name} — ${entry.detail.slice(0, 140)}`);
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("сбой проверки рубрикатора:", error);
  process.exitCode = 1;
});
