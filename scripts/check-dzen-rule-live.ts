/**
 * Verifies the Dzen experiment rule is enforced by the article action, not just by
 * the disabled checkbox.
 *
 * The action is called directly rather than over HTTP: a plain FormData POST to
 * the page URL re-renders the page and never reaches a Server Action, so an HTTP
 * version of this test would pass while checking nothing. `revalidatePath` throws
 * outside a request context, and it runs *after* the database write, so the error
 * is caught and the row is still inspected.
 *
 * Works on a throwaway article that is created here and deleted at the end, so it
 * never edits editorial data — including on production.
 *
 * Run with: npx tsx --env-file=.env scripts/check-dzen-rule-live.ts
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { createArticleAction } from "../src/app/admin/articles/actions";
import { PrismaClient } from "../src/generated/prisma/client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

const PROBE_SLUG = "zz-probe-dzen-experiment-rule";

/**
 * "YYYY-MM-DDTHH:mm" in Moscow, the format the form field uses.
 *
 * The action reads this as Moscow wall clock, so the test has to *write* Moscow
 * wall clock too. Formatting a UTC timestamp here would land three hours in the
 * past and make the fresh-publication case look locked.
 */
function moscowInput(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

async function submit(id: string, publishedAt: string, experiment: boolean) {
  const data = new FormData();
  data.set("id", id);
  data.set("intent", "apply");
  data.set("title", "Проверка правила эксперимента Дзен");
  data.set("slug", PROBE_SLUG);
  data.set("contentHtml", "<p>Проверка серверного правила эксперимента.</p>");
  data.set("status", "published");
  data.set("isDzen", "on");
  data.set("publishedAt", publishedAt);
  if (experiment) data.set("dzenExperiment", "on");

  try {
    return await createArticleAction(data);
  } catch (error) {
    // revalidatePath needs a request scope; the row is already written by then.
    return {
      ok: true,
      revalidationFailed: error instanceof Error ? error.message : String(error),
    };
  }
}

const flag = async (id: string) =>
  (await prisma.article.findUnique({ where: { id }, select: { dzenExperiment: true } }))
    ?.dzenExperiment;

async function main() {
  // Clean up any probe left behind by an interrupted earlier run.
  await prisma.article.deleteMany({ where: { slug: PROBE_SLUG } });

  const probe = await prisma.article.create({
    data: {
      title: "Проверка правила эксперимента Дзен",
      slug: PROBE_SLUG,
      contentHtml: "<p>Проверка серверного правила эксперимента.</p>",
      status: "published",
      isDzen: true,
      publishedAt: new Date(),
      dzenExperiment: false,
    },
    select: { id: true },
  });

  const longAgo = moscowInput(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const results: string[] = [];

  try {
    // 1. A request that tries to switch the flag on long after publication — the
    //    one thing a crafted POST can do that the disabled checkbox cannot stop.
    await prisma.article.update({
      where: { id: probe.id },
      data: { publishedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
    });
    await submit(probe.id, longAgo, true);
    const blocked = (await flag(probe.id)) === false;
    results.push(`${blocked ? "OK  " : "FAIL"} поддельный POST: флаг не выставился`);
    console.log(`1. поддельный POST dzenExperiment=on → ${await flag(probe.id)}`);

    // 2. The flag is still grantable at the moment of publication.
    await prisma.article.update({
      where: { id: probe.id },
      data: { publishedAt: new Date() },
    });
    await submit(probe.id, moscowInput(new Date()), true);
    const granted = (await flag(probe.id)) === true;
    results.push(`${granted ? "OK  " : "FAIL"} свежая публикация: флаг выставлен`);
    console.log(`2. свежая публикация + dzenExperiment=on → ${await flag(probe.id)}`);

    // 3. A granted flag belongs to its publication and is not silently cleared by
    //    a later edit that falls outside the window.
    await submit(probe.id, longAgo, false);
    const kept = (await flag(probe.id)) === true;
    results.push(`${kept ? "OK  " : "FAIL"} позднее сохранение: флаг не сброшен`);
    console.log(`3. позднее сохранение без галочки → ${await flag(probe.id)}`);
  } finally {
    await prisma.article.deleteMany({ where: { slug: PROBE_SLUG } });
  }

  console.log("");
  for (const line of results) console.log(line);

  const failed = results.filter((line) => line.startsWith("FAIL")).length;
  console.log(`\n${results.length - failed}/${results.length} проверок пройдено`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());