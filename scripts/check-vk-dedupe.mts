/**
 * One story, one wall post.
 *
 * Two failures are covered here, and they are not the same failure.
 *
 * The visible one is the re-save: the VK branch used to test `status === "published"`
 * where Telegram and MAX test the transition into published, so a story stayed eligible
 * forever and every edit put the headline on the wall again.
 *
 * The subtle one is the double submit. Two requests both read the row before either writes
 * and both conclude they are first; no amount of checking in application code fixes that,
 * because the check and the write have to be the same statement. So the claim is exercised
 * against the real SQLite file as well as against a fake — the atomicity is a property of
 * the database, and a fake that agrees with whatever the code does proves nothing.
 */

import { claimVkPost, finishVkPost, releaseVkPost, type VkClaimStore } from "../src/lib/vk-claim";
import {
  decideVkRepost,
  interpretVkClaim,
  isVkPostClaimed,
  isVkPosted,
  VK_POST_CLAIM,
} from "../src/lib/vk-dedupe";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

/** A store that refuses to overwrite an existing value, the way SQLite's conditional UPDATE does. */
function fakeStore(initial: string | null) {
  let value = initial;
  const store: VkClaimStore = {
    article: {
      async updateMany({ where, data }) {
        if (where.vkPostId !== value) return { count: 0 };
        value = data.vkPostId;
        return { count: 1 };
      },
      async findUnique() {
        return { vkPostId: value };
      },
    },
  };
  return { store, read: () => value };
}

// --- the sentinel ---------------------------------------------------------

check(
  "Claim: не путается с настоящим id",
  isVkPostClaimed(VK_POST_CLAIM) &&
    !isVkPosted(VK_POST_CLAIM) &&
    isVkPosted("42") &&
    !isVkPosted(null) &&
    !isVkPosted(""),
  `${VK_POST_CLAIM}: claim=${isVkPostClaimed(VK_POST_CLAIM)}, posted=${isVkPosted(VK_POST_CLAIM)}`,
);

// --- who may publish ------------------------------------------------------

const base = { previousStatus: "draft", status: "published", isVk: true } as const;

check(
  "Решение: первая публикация — публикуем",
  decideVkRepost({ ...base, storedPostId: null }) === "publish",
  decideVkRepost({ ...base, storedPostId: null }),
);

/*
  The regression for the duplicates. Same status on both sides means this save is an edit
  of something already live, and that is exactly the case that used to repost.
*/
check(
  "Решение: повторное сохранение опубликованной — НЕ публикуем",
  decideVkRepost({ ...base, previousStatus: "published", storedPostId: null }) ===
    "already-posted",
  decideVkRepost({ ...base, previousStatus: "published", storedPostId: null }),
);

check(
  "Решение: сохранённый id ВК останавливает даже первую публикацию",
  decideVkRepost({ ...base, storedPostId: "12345" }) === "already-posted",
  decideVkRepost({ ...base, storedPostId: "12345" }),
);

/*
  The claim is deliberately not proof of a post. A request that died holding a claim would
  otherwise bar the story from the wall permanently; the row-level claim is what resolves
  this case, and it reports "someone else is publishing" rather than "already posted".
*/
check(
  "Решение: чужой claim — не повод считать, что пост уже есть",
  decideVkRepost({ ...base, storedPostId: VK_POST_CLAIM }) === "publish",
  decideVkRepost({ ...base, storedPostId: VK_POST_CLAIM }),
);

check(
  "Решение: снятый флажек и черновик не публикуются",
  decideVkRepost({ ...base, isVk: false }) === "not-publishable" &&
    decideVkRepost({ ...base, status: "draft" }) === "not-publishable" &&
    decideVkRepost({
      previousStatus: "draft",
      status: "published",
      isVk: false,
    }) === "not-publishable",
  "not-publishable во всех трёх",
);

// --- reading the row count ------------------------------------------------

check(
  "Claim: одна строка — наш, ноль — не наш",
  interpretVkClaim(1, VK_POST_CLAIM).claimed &&
    !interpretVkClaim(0, null).claimed &&
    !interpretVkClaim(0, "42").claimed,
  "count решает",
);

check(
  "Claim: проигравший отличает «идёт публикация» от «уже опубликовано»",
  // null — the other writer has not finished; the editor must not be told anything failed.
  !interpretVkClaim(0, null).alreadyPosted &&
    // A real id — it finished and the story did go out.
    interpretVkClaim(0, "42").alreadyPosted &&
    // The claim — still in flight.
    !interpretVkClaim(0, VK_POST_CLAIM).alreadyPosted,
  "null=идёт, id=есть, claim=идёт",
);

// --- the three statements against a store ---------------------------------

const fresh = fakeStore(null);
const first = await claimVkPost(fresh.store, "a1");
check(
  "Claim: первый захватывает строку",
  first.claimed && !first.alreadyPosted && fresh.read() === VK_POST_CLAIM,
  `claimed=${first.claimed}, в БД=${fresh.read()}`,
);

const second = await claimVkPost(fresh.store, "a1");
check(
  "Claim: второй захват проигрывает, а не перезаписывает",
  !second.claimed && !second.alreadyPosted && fresh.read() === VK_POST_CLAIM,
  `claimed=${second.claimed}, в БД=${fresh.read()}`,
);

await finishVkPost(fresh.store, "a1", "777");
check(
  "Claim: после публикации в строке id поста",
  fresh.read() === "777",
  `в БД=${fresh.read()}`,
);

const afterFinish = await claimVkPost(fresh.store, "a1");
check(
  "Claim: после публикации никто не может захватить снова",
  !afterFinish.claimed && afterFinish.alreadyPosted,
  `claimed=${afterFinish.claimed}, alreadyPosted=${afterFinish.alreadyPosted}`,
);

/*
  VK confirmed the post but would not say which one. Leaving the claim behind would block
  every future attempt while looking like something still in flight.
*/
const noId = fakeStore(VK_POST_CLAIM);
await finishVkPost(noId.store, "a1", null);
check(
  "Claim: без id поста claim снимается, а не висит вечно",
  noId.read() === null,
  `в БД=${noId.read()}`,
);

/*
  The failed post has to give the story back: the usual cause is VK being unavailable, and
  that is not a reason to bar the story from the wall permanently.
*/
const failed = fakeStore(VK_POST_CLAIM);
await releaseVkPost(failed.store, "a1");
check(
  "Claim: после неудачи строка освобождена для следующей попытки",
  failed.read() === null && (await claimVkPost(failed.store, "a1")).claimed,
  `в БД=${failed.read()}`,
);

const posted = fakeStore("555");
await releaseVkPost(posted.store, "a1");
check(
  "Claim: освобождение не стирает настоящий id поста",
  posted.read() === "555",
  `в БД=${posted.read()}`,
);

await finishVkPost(posted.store, "a1", "999");
check(
  "Claim: finish не перезаписывает id без своего claim",
  posted.read() === "555",
  `в БД=${posted.read()}`,
);

// --- the atomicity argument, against the real database -------------------

/*
  The fake above enforces "only if still null" because it was written to. That is circular.
  This runs the same function against the actual dev.db with two claims started at once, so
  the property being relied on — SQLite serialising the writes so exactly one matches — is
  observed rather than assumed.
*/
async function checkAgainstSqlite() {
  const { prisma } = await import("../src/lib/prisma");

  const article = await prisma.article.create({
    data: {
      title: "Проверка дедупликации ВК",
      slug: `vk-dedupe-probe-${process.pid}`,
      contentHtml: "<p>probe</p>",
    },
    select: { id: true },
  });

  try {
    const store = prisma as unknown as VkClaimStore;

    const outcomes = await Promise.all([
      claimVkPost(store, article.id),
      claimVkPost(store, article.id),
      claimVkPost(store, article.id),
    ]);

    const winners = outcomes.filter((outcome) => outcome.claimed).length;
    check(
      "Claim: три одновременных захвата — ровно один победитель (настоящая БД)",
      winners === 1 && outcomes.filter((o) => o.alreadyPosted).length === 0,
      `победителей=${winners}, ужеОпубликовано=${outcomes.filter((o) => o.alreadyPosted).length}`,
    );

    const stored = await prisma.article.findUnique({
      where: { id: article.id },
      select: { vkPostId: true },
    });
    check(
      "Claim: в строке остался claim, а не последний победитель",
      stored?.vkPostId === VK_POST_CLAIM,
      `в БД=${stored?.vkPostId}`,
    );

    await releaseVkPost(store, article.id);
    const released = await prisma.article.findUnique({
      where: { id: article.id },
      select: { vkPostId: true },
    });
    check(
      "Claim: освобождение работает и на настоящей БД",
      released?.vkPostId === null,
      `в БД=${released?.vkPostId}`,
    );
  } finally {
    await prisma.article.deleteMany({ where: { id: article.id } });
    await prisma.$disconnect();
  }
}

await checkAgainstSqlite();

const failedChecks = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"} ${entry.name} — ${entry.detail}`);
}
console.log(`\n${checks.length - failedChecks.length}/${checks.length} проверок пройдено`);
process.exit(failedChecks.length > 0 ? 1 : 0);