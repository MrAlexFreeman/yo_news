/**
 * Post-check cleanup verification.
 *
 * Two things to confirm after the live link test: the database no longer holds the
 * probe paragraphs, and the deployed bundle carries the new link class. The ISR
 * route cache is expected to still hold the probe text for a few minutes — that is
 * the 5-minute window doing its job, not a leak — so it is reported, not failed.
 *
 * Wrapped in main() rather than using top-level await: the file sits next to other
 * scripts in a package without "type": "module", so esbuild would compile it as
 * CJS and refuse.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../src/generated/prisma/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

let failed = 0;
const check = (name: string, ok: boolean, detail: string) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
};

/**
 * Every JS and RSC file under the server output.
 *
 * The whole tree rather than one path: the class may live in a shared chunk, and
 * asserting on a file that happens to hold it today would make the check a
 * tripwire for the wrong reason.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|rsc)$/.test(entry)) out.push(full);
  }
  return out;
}

async function main() {
  // --- the database --------------------------------------------------------
  const articles = await prisma.article.findMany({ select: { slug: true, contentHtml: true } });
  const dirty = articles.filter((a) => a.contentHtml.includes("Проверка ссылки"));
  check(
    "В базе нет следов пробы",
    dirty.length === 0,
    dirty.length === 0
      ? `${articles.length} статей чисто`
      : dirty.map((a) => a.slug).join(", "),
  );
  await prisma.$disconnect();

  // --- the deployed bundle -------------------------------------------------
  const files = walk(".next/server");
  const withClass = files.filter((f) => readFileSync(f, "utf8").includes("hover:text-amber-700"));
  check(
    "Задеплоенный бандл несёт новый класс ссылки",
    withClass.length > 0,
    withClass.length > 0 ? `${withClass.length} файл(ов)` : "класс не найден нигде в .next/server",
  );

  const withKey = files.filter((f) => readFileSync(f, "utf8").includes("articles-search"));
  check(
    "Эндпоинт поиска попал в сборку",
    withKey.length > 0,
    withKey.length > 0 ? `${withKey.length} файл(ов)` : "не найден",
  );

  // --- the ISR cache, reported only ---------------------------------------
  const response = await fetch(
    "https://eartnews.ru/news/voditeley-mogut-nachat-vyzyvat-na-vneocherednoy-medosmotr-cherez-gosuslugi",
  );
  const stillCached = (await response.text()).includes("Проверка ссылки");
  console.log(
    `\nISR-кэш всё ещё содержит пробу: ${stillCached ? "да" : "нет"} — ` +
      (stillCached
        ? "это окно регенерации в 5 минут, страница протухнет сама"
        : "страница уже перегенерирована"),
  );

  console.log(failed === 0 ? "\nВсе проверки прошли" : `\n${failed} проверок провалено`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
