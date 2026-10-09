/**
 * One-off backfill: give every existing article a handful of tags.
 *
 * Run with: npm run db:seed:tags        (skips articles that already have tags)
 *           npm run db:seed:tags --force  (overwrites them too)
 *
 * These are *heuristic* tags, not editorial judgement: the rules below are plain
 * keyword matching over the headline and the lead. They exist so a site that was
 * populated before the tag feature landed is not left with an empty /tags page
 * and a taxonomy with nothing in it. Every assignment is meant to be reviewed and
 * corrected in the editor, which is why the script is idempotent and skips
 * anything already tagged — a real editor's work is never overwritten by a
 * re-run.
 *
 * Deterministic throughout: the same input always produces the same tag set, so
 * re-running on a restored database reproduces it exactly.
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../src/generated/prisma/client";
import { UPLOAD_DIR } from "../src/lib/upload-dir";
import { parseTagsField, syncArticleTags } from "../src/lib/tags";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  }),
});

/** Never more than this per article: a wall of tags helps nobody. */
const MAX_TAGS = 3;
const MIN_TAGS = 2;

const force = process.argv.includes("--force");

/**
 * Rubric → tags, always at least two.
 *
 * The second entry is the usual editorial angle for that desk. Spelling these out
 * rather than letting a generic "pad to two tags" rule fire matters: with a blind
 * fallback every sports story came out as "Спорт, Общество" regardless of
 * whether anything in the headline said anything about society.
 */
const BY_CATEGORY: Record<string, string[]> = {
  investigations: ["Расследования", "Общество"],
  lifestyle: ["Здоровье", "Общество"],
  "home-garden": ["Дом", "Город"],
  cinema: ["Культура", "Город"],
  incidents: ["Происшествия", "Город"],
  society: ["Общество", "Город"],
  economy: ["Экономика", "Город"],
};

/** Only for a story with no rubric at all. */
const NO_RUBRIC_FALLBACK = "Общество";

/**
 * Keyword → tag, in priority order: the first rule that matches claims the slot,
 * so specific vocabulary ("гололёд") is not stolen by a broad one ("дорог").
 */
const BY_KEYWORD: [RegExp, string][] = [
  [/екатеринбург/i, "Екатеринбург"],

  [/голол[её]д|обледен/i, "Транспорт"],
  [/транспорт|дорог|автобус|метро|трамва|троллейбус|водител|автомобил|грузовик|поезд|вокзал|пробк|перекр[её]сток|парковк|перевозк|кол[её]с/i, "Транспорт"],

  [/жкх|уборк|отоплен|теплосет|водопровод|канализац|мусор|снег|смет|крыш[ауе]|подтоплен|коммунальн|ливнев/i, "ЖКХ"],

  [/урал|свердловск|свердловской|бер[её]зовск|североуральск|первоуральск|тагил|емыш/i, "Урал"],

  [/хокке|футбол|баскетбол|волейбол|легкоатлет|бокс|шахмат|плов|плавани|пловец|велосипед|лыжн|коньк|прыжк/i, "Спорт"],
  [/спорт|турнир|медал|олимп|чемпионат|гоночн|гонк|эстафет|матч|клуб/i, "Спорт"],

  [/театр|выставк|музе|храм|концерт|спектакль|кино|фестиваль|галере|архитектур|памятник|книг/i, "Культура"],
  [/культур/i, "Культура"],

  [/нейросет|алгоритм|ии\b|искусственн(ый|ого) интеллект/i, "Технологии"],
  [/технолог|сервер|интернет|цифров|приложени|софт|разработ|баттаре|электромобил|смартфон/i, "Технологии"],

  [/наук|уч[её]н|исследован|открыти|эксперимент|космос|астроно|физик|химик|биолог|вакцин|препарат|ученые/i, "Наука"],

  [/экономик|инфляц|стоимост|зарплат|бизнес|рынок|аренд|инвестиц|бюджет|налог|потребительск/i, "Экономика"],
  [/цены|цена|тариф/i, "Экономика"],

  [/погиб|авари|дтп|пожар|преступ|задержан|суд\b|оштраф|травм|сбил|утонул|обвал|разруш|пропал|найден/i, "Происшествия"],

  [/жител|семь|пенси|учител|врач|школ|детск|образован|здравоохран|социальн|сосед|пациент/i, "Общество"],

  [/городск|депутат|выбор|мэр|губернатор|законопроект|администрац|власт/i, "Политика"],

  [/микрорайон|площад|парк|центр города|район|набережн|сквер/i, "Город"],
];

type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  lead: string | null;
  status: string;
  category: { slug: string; name: string } | null;
  /** Join rows, used only to decide whether to skip. */
  tags: { tagId: number }[];
};

/** Category tags first, then the first keyword rules that match, capped. */
function pickTags(article: ArticleRow): string[] {
  const chosen: string[] = [];
  const text = `${article.title} ${article.lead ?? ""}`;

  const add = (name: string) => {
    if (chosen.length < MAX_TAGS && !chosen.includes(name)) chosen.push(name);
  };

  for (const name of BY_CATEGORY[article.category?.slug ?? ""] ?? []) {
    add(name);
  }

  for (const [pattern, name] of BY_KEYWORD) {
    if (chosen.length >= MAX_TAGS) break;
    if (pattern.test(text)) add(name);
  }

  // Every rubric above supplies two, so this only fires for a story that has no
  // rubric — the widest fitting tag beats an untagged page.
  if (chosen.length < MIN_TAGS) add(NO_RUBRIC_FALLBACK);

  return chosen;
}

async function main() {
  const articles = (await prisma.article.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      lead: true,
      status: true,
      category: { select: { slug: true, name: true } },
      tags: { select: { tagId: true } },
    },
  })) as ArticleRow[];

  let tagged = 0;
  let skipped = 0;
  let draftTagged = 0;
  const perTag = new Map<string, number>();

  for (const article of articles) {
    if (article.tags.length > 0 && !force) {
      skipped += 1;
      continue;
    }

    const names = pickTags(article);
    await prisma.$transaction((tx) =>
      syncArticleTags(tx as never, article.id, parseTagsField(names.join(","))),
    );

    tagged += 1;
    if (article.status !== "published") draftTagged += 1;
    for (const name of names) {
      perTag.set(name, (perTag.get(name) ?? 0) + 1);
    }
  }

  const total = await prisma.tag.count();
  const joins = await prisma.articleTag.count();

  console.log(`Обработано статей: ${articles.length}`);
  console.log(`Помечено: ${tagged}${draftTagged ? ` (в т.ч. черновиков: ${draftTagged})` : ""}`);
  console.log(`Пропущено (уже с тэгами): ${skipped}`);
  console.log(`Тегов в справочнике: ${total}, связей: ${joins}`);
  console.log("");
  console.log("Распределение:");
  for (const [name, count] of [...perTag].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))) {
    console.log(`  ${name.padEnd(16)} ${count}`);
  }
  console.log("");
  console.log(`Каталог загрузок: ${UPLOAD_DIR} (не используется этим скриптом)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());