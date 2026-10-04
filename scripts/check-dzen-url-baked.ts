/**
 * Confirms NEXT_PUBLIC_DZEN_URL reached the built HTML.
 *
 * Next.js inlines NEXT_PUBLIC_* at build time, so this is the only place the
 * substitution can be observed — reading the env var at runtime would look like
 * it works and then serve the old value. Point it at a build made with a
 * distinctive value and it tells you whether the wiring holds.
 */
import { readFileSync } from "node:fs";

const EXPECTED = process.env.EXPECT_DZEN_URL?.trim();
const FILE = ".next/server/app/index.html";

if (!EXPECTED) {
  console.error("Передайте EXPECT_DZEN_URL — адрес, зашитый при последней сборке.");
  process.exit(2);
}

const html = readFileSync(FILE, "utf8");

// Every dzen.ru link in the built home page: the subscribe button plus anything
// the footer or metadata emits.
const hrefs = [...new Set([...html.matchAll(/href="(https:\/\/dzen[^"]*)"/g)].map((m) => m[1]))];

console.log(`Ожидаем: ${EXPECTED}`);
console.log(`Ссылки на dzen.ru в ${FILE}:`);
for (const href of hrefs) console.log(`  ${href}`);

const ok = hrefs.includes(EXPECTED);
console.log(`\n${ok ? "OK  " : "FAIL"} значение NEXT_PUBLIC_DZEN_URL попало в сборку`);
process.exitCode = ok ? 0 : 1;