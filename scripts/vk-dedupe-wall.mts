/**
 * Удаление постов-дубликатов со стены сообщества ВК.
 *
 * Run from the project root:
 *   npx tsx --env-file=.env scripts/vk-dedupe-wall.mts               # сухой прогон
 *   npx tsx --env-file=.env scripts/vk-dedupe-wall.mts --apply       # удаляет
 *   ... --apply --delay=5000                                        # медленнее
 *
 * ---------------------------------------------------------------------------
 * Что считается дубликатом
 * ---------------------------------------------------------------------------
 * Two posts are the same publication if they link to the same article — the slug in
 * `/news/<slug>` is the identity, not the text, because a re-saved story can differ by a word.
 * Of such a group the **earliest** post is kept: it is the one that was actually published
 * first, and the later copies are the accident. Posts with no article link are never touched.
 *
 * The decision itself lives in `planWallDedupe`, which is pure and checked; this script only
 * prints it, takes the backup and makes the calls.
 *
 * ---------------------------------------------------------------------------
 * Почему это вообще понадобилось
 * ---------------------------------------------------------------------------
 * The wall carried 28 posts, 17 of them copies of six stories — four copies of one, six of
 * another — created on 6–8 October, before the claim mechanism in `vk-claim.ts` existed.
 * Nothing on the wall says they were a mistake; they simply accumulated while repeated saves
 * each reposted the same story.
 *
 * ---------------------------------------------------------------------------
 * Безопасность
 * ---------------------------------------------------------------------------
 * Dry run unless `--apply`. Before anything is deleted, every doomed post — id, date, text and
 * attachments — is written to `vk-dedupe-backup-<timestamp>.json` in the current directory, so
 * a mistaken deletion can be reconstructed by hand. The file is not in git.
 *
 * VK answers these calls with error 14, "Captcha needed", once it has seen enough of them; the
 * run stops there rather than knocking, and can be repeated because it only ever looks at what
 * are still duplicates.
 */

import { deleteWallPost, listWallPosts, planWallDedupe } from "@/lib/vk-publisher";
import { writeFile } from "node:fs/promises";

const apply = process.argv.includes("--apply");

const delayArg = process.argv.find((arg) => arg.startsWith("--delay="));
const delayMs = delayArg ? Math.max(0, Number(delayArg.split("=")[1]) || 0) : 1500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isCaptchaError(error: unknown): boolean {
  return error instanceof Error && /Captcha needed \(14\)/.test(error.message);
}

async function main() {
  const posts = await listWallPosts(100);
  const { keep, remove } = planWallDedupe(posts);

  console.log(`Всего постов: ${posts.length}`);
  console.log(`Останется: ${keep.length}, к удалению: ${remove.length}`);
  console.log(apply ? "РЕЖИМ: удаление\n" : "РЕЖИМ: сухой прогон, ничего не удаляется\n");

  const keptIds = new Set(keep.map((post) => post.id));
  const removedBySlug = new Map<string, string[]>();
  for (const post of remove) {
    const slug = post.text.match(/\/news\/([A-Za-z0-9_-]+)/)?.[1] ?? "—";
    const list = removedBySlug.get(slug);
    if (list) list.push(post.id);
    else removedBySlug.set(slug, [post.id]);
  }

  for (const post of keep) {
    const slug = post.text.match(/\/news\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
    const doomed = slug ? (removedBySlug.get(slug) ?? []) : [];
    const when = new Date(post.date * 1000).toISOString().slice(0, 16).replace("T", " ");
    console.log(
      `  оставляем ${post.id} (${when})${slug ? ` «${slug}»` : " — без ссылки"}${
        doomed.length ? `, удаляем ${doomed.length}: ${doomed.join(", ")}` : ""
      }`,
    );
  }
  console.log(`\nПроверка: остаётся ${keptIds.size} постов`);

  if (remove.length === 0) {
    console.log("Дубликатов нет.");
    return;
  }

  if (!apply) {
    console.log("Сухой прогон: ничего не удалено.");
    return;
  }

  /*
    The backup, written before the first deletion.
    Deleting a wall post is not reversible through the API, and the only copy of what was in
    one lives in this run's memory until this file is on disk.
  */
  const backupPath = `vk-dedupe-backup-${Date.now()}.json`;
  await writeFile(
    backupPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        community: process.env.VK_COMMUNITY_ID ?? null,
        deleted: remove.map((post) => ({
          id: post.id,
          date: post.date,
          text: post.text,
          attachments: post.attachments,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`Резервная копия: ${backupPath}\n`);

  let deleted = 0;
  let failed = 0;
  for (const post of remove) {
    if (deleted + failed > 0) await sleep(delayMs);
    try {
      console.log(`  удаляю ${post.id}: ${(post.text.split("\n")[0] ?? "").slice(0, 60)}`);
      await deleteWallPost(post.id);
      deleted += 1;
    } catch (error) {
      if (isCaptchaError(error)) {
        console.error(
          `\n  ВК потребовал капчу на посте ${post.id} — останавливаюсь. Повторите запуск позже.`,
        );
        break;
      }
      console.error(`      ошибка: ${error instanceof Error ? error.message : String(error)}`);
      failed += 1;
    }
  }

  console.log(
    `\nУдалено: ${deleted}, ошибок: ${failed}, осталось: ${remove.length - deleted - failed}`,
  );
  if (failed > 0) process.exitCode = 1;
}

await main();
