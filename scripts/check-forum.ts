/**
 * Checks the forum's three load-bearing guarantees.
 *
 * 1. A post's HTML is inert. `sanitizeForumHtml` is the only thing between an
 *    anonymous visitor's textarea and `dangerouslySetInnerHTML`, and the attacker's
 *    input is whatever they like. Every case here is one they would try.
 *
 * 2. The anti-spam gate actually blocks. A honeypot field that browsers autofill
 *    would throw away every real visitor, and a rate limiter keyed on a header the
 *    client sets would be switched off with one line of curl — so both are tested
 *    for the failure mode, not just the happy one.
 *
 * 3. The data layer behaves: the reply bumps the thread's activity, and deleting a
 *    thread takes its posts with it. Both are invisible in a page render and both
 *    would be found by a reader instead.
 *
 * The database cases write and then delete, in a `finally`, under a marker author
 * name, so a crashed run leaves one identifiable row rather than a silent one.
 */
import { prisma } from "@/lib/prisma";
import { sanitizeForumHtml } from "@/lib/sanitize";
import {
  FORUM_HONEYPOT_FIELD,
  FORUM_NAME_MAX_LENGTH,
  FORUM_POST_MAX_LENGTH,
  clampForumText,
  forumTextToHtml,
  isHoneypotFilled,
} from "@/lib/forum-text";
import {
  FORUM_COOLDOWN_MS,
  clientIp,
  resetForumRateLimit,
  retryAfterSeconds,
  take,
} from "@/lib/forum-rate-limit";
import {
  createForumPost,
  createForumTopic,
  ensureForumCategories,
  getForumCategories,
  uniqueForumTopicSlug,
} from "@/lib/forum";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

/** Builds a FormData the way a browser would post the form. */
function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** A `headers()` stand-in. */
function headers(values: Record<string, string>) {
  return { get: (name: string) => values[name.toLowerCase()] ?? null };
}

// --- 1. the sanitiser -------------------------------------------------------

function checkSanitiser() {
  // The attacks. Each one is a real technique against an allowlist, not a toy.
  const attacks: [string, string, (result: string) => boolean][] = [
    [
      "скрипт вырезан",
      '<p>текст</p><script>alert(1)</script>',
      (html) => !/script/i.test(html) && html.includes("текст"),
    ],
    [
      "обработчик onerror вырезан",
      '<p><img src="x" onerror="alert(1)"></p>',
      (html) => !/onerror/i.test(html) && !/<img/i.test(html),
    ],
    [
      "iframe вырезан",
      '<p>ок</p><iframe src="https://evil.example/"></iframe>',
      (html) => !/iframe/i.test(html) && html.includes("ок"),
    ],
    [
      "ссылка остаётся текстом, но href исчезает",
      '<p>клик <a href="https://phish.example">сюда</a></p>',
      (html) =>
        !/phish\.example/.test(html) &&
        !/<a[\s>]/.test(html) &&
        html.includes("сюда"),
    ],
    [
      "javascript: в href не доходит до страницы",
      '<p><a href="javascript:alert(1)">x</a></p>',
      (html) => !/javascript:/i.test(html),
    ],
    [
      "style и class вырезаны",
      '<p style="position:fixed" class="x">текст</p>',
      (html) => !/style=/i.test(html) && !/class=/i.test(html) && html.includes("текст"),
    ],
    [
      "заголовок не выживает, текст из него — да",
      "<h1>Мы главные</h1>",
      (html) => !/<h1/i.test(html) && html.includes("Мы главные"),
    ],
    [
      "форма и её поля исчезают",
      '<form action="/x"><input name="a"><button>ok</button></form>',
      (html) => !/<form|<input|<button/i.test(html),
    ],
    [
      "svg с обработчиком вырезан",
      '<p>a</p><svg onload="alert(1)"><circle /></svg>',
      (html) => !/svg|onload/i.test(html),
    ],
    [
      "data: в картинке не проходит",
      '<p><img src="data:text/html;base64,PHNjcmlwdD4="></p>',
      (html) => !/data:/i.test(html),
    ],
    [
      "обычная разметка сообщения сохраняется",
      "<p>абзац<br>строка<strong>жирно</strong></p><blockquote>цитата</blockquote>",
      (html) =>
        /<br\s*\/?>/i.test(html) &&
        /<strong/i.test(html) &&
        /<blockquote/i.test(html),
    ],
  ];

  for (const [name, input, assert] of attacks) {
    const result = sanitizeForumHtml(input);
    check(`Форум: ${name}`, assert(result), result);
  }

  // The article policy must not have leaked: its hook force-adds a class and a
  // target to links, and one shared DOMPurify instance is exactly where that would
  // show up.
  const withLink = sanitizeForumHtml('<p><a href="/news/abc">раз</a></p>');
  check(
    "Форум: политика статьи не применяется к сообщениям",
    !withLink.includes("text-amber") && !withLink.includes("target="),
    withLink,
  );
}

// --- 2. text conversion -----------------------------------------------------

function checkText() {
  const cases: [string, string, string][] = [
    ["два абзаца", "первый\n\nвторой", "<p>первый</p><p>второй</p>"],
    ["перенос строки внутри абзаца", "раз\nдва", "<p>раз<br>два</p>"],
    ["цитата", "> чужая мысль", "<blockquote>чужая мысль</blockquote>"],
    ["многострочная цитата", "> раз\n> два", "<blockquote>раз<br>два</blockquote>"],
    ["обычный текст без тегов", "просто текст", "<p>просто текст</p>"],
  ];

  for (const [name, input, expected] of cases) {
    const result = forumTextToHtml(input);
    check(`Форум: текст — ${name}`, result === expected, `${result}`);
  }

  check(
    "Форум: пустой текст даёт пустую строку, а не пустой <p>",
    forumTextToHtml("   \n  \n ") === "",
    JSON.stringify(forumTextToHtml("   \n  \n ")),
  );

  // A poster who types markup must see their characters, not have them parsed.
  const escaped = forumTextToHtml("<b>жирно</b> и <script>alert(1)</script>");
  check(
    "Форум: ввод разметки остаётся текстом",
    !escaped.includes("<b>") && !/<script/i.test(escaped) && escaped.includes("&lt;b&gt;"),
    escaped,
  );
  check(
    "Форум: экранированный ввод остаётся текстом и после санитайзера",
    !sanitizeForumHtml(escaped).includes("<b>"),
    sanitizeForumHtml(escaped),
  );

  // Control characters survive copy-paste from a terminal and would be stored.
  const cleaned = forumTextToHtml("до\u0007\u001Fпосле");
  check(
    "Форум: управляющие символы вычищаются",
    !cleaned.includes("\u0007") && !cleaned.includes("\u001F") && cleaned.includes("до") && cleaned.includes("после"),
    JSON.stringify(cleaned),
  );

  const clamped = clampForumText(`  очень   длинное   имя  `.repeat(6), FORUM_NAME_MAX_LENGTH);
  check(
    "Форум: имя обрезается по границе слова и не длиннее лимита",
    clamped.length <= FORUM_NAME_MAX_LENGTH && !clamped.includes("  "),
    `${JSON.stringify(clamped.slice(0, 30))}… (${clamped.length})`,
  );
}

// --- 3. honeypot and rate limiting ------------------------------------------

function checkSpamGate() {
  // Computed key, not `{ FORUM_HONEYPOT_FIELD: … }`: without the brackets that is a
  // property literally named "FORUM_HONEYPOT_FIELD", which no bot would ever fill.
  check(
    "Форум: honeypot заполнен — отклоняем",
    isHoneypotFilled(form({ [FORUM_HONEYPOT_FIELD]: "http://spam.example" })),
    "заполнено",
  );
  check(
    "Форум: honeypot пуст — принимаем",
    !isHoneypotFilled(form({ [FORUM_HONEYPOT_FIELD]: "" })),
    "пусто",
  );
  check(
    "Форум: honeypot отсутствует — принимаем",
    !isHoneypotFilled(form({ authorName: "Гость" })),
    "поля нет",
  );

  // The failure mode that matters: a field named like one the browser fills in would
  // be filled by every honest visitor, and the form would reject all of them.
  const autofilled = ["email", "url", "tel", "name", "address", "city", "company"];
  check(
    "Форум: поле-ловушка не пересекается с автозаполнением браузера",
    !autofilled.includes(FORUM_HONEYPOT_FIELD),
    FORUM_HONEYPOT_FIELD,
  );

  resetForumRateLimit();
  const now = Date.now();

  check("Форум: первая попытка проходит", take("10.0.0.1", now), "ок");
  check(
    "Форум: вторая попытка в пределах 30 секунд отклоняется",
    !take("10.0.0.1", now + 1000),
    "отклонено",
  );
  // Measured from the *last* attempt, not the first: `take` moves the window forward
  // on every attempt so a client retrying every 29 seconds never gets through. The
  // 30 seconds therefore start at now + 1000, the second call above.
  check(
    "Форум: после паузы попытка снова проходит",
    take("10.0.0.1", now + 1000 + FORUM_COOLDOWN_MS + 1),
    "ок через 30 с от последней попытки",
  );
  check(
    "Форум: у соседнего адреса своё окно",
    take("10.0.0.2", now),
    "не зависит от первого",
  );

  // A flood must yield exactly one accepted post per window. This is the property that
  // matters, and it is stated as a count rather than as a single call: a limiter
  // tested one call at a time passes even when twenty attempts slip through.
  resetForumRateLimit();
  const floodStart = Date.now();
  let accepted = 0;
  for (let second = 0; second < 60; second += 1) {
    if (take("10.0.0.3", floodStart + second * 1000)) accepted += 1;
  }
  // A sliding window means one post, not two: every attempt — accepted or not — moves
  // the window forward, so a client that keeps retrying never clears it. That is
  // stricter than the "one per 30 seconds" rule asked for, and deliberately so.
  check(
    "Форум: непрерывная серия за минуту проходит один раз",
    accepted === 1,
    `60 попыток за 60 с → принято ${accepted}`,
  );

  // The other half: the limiter must not lock an address out permanently. A pause
  // long enough has to restore it.
  check(
    "Форум: после настоящей паузы адрес восстанавливается",
    take("10.0.0.3", floodStart + 59_000 + FORUM_COOLDOWN_MS + 1),
    "ок после простоя длиннее окна",
  );

  // And the refusal has to be the common case, not an exception.
  resetForumRateLimit();
  let refusals = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!take("10.0.0.5", floodStart + attempt * 100)) refusals += 1;
  }
  check(
    "Форум: плотная серия почти целиком отклоняется",
    refusals === 39,
    `40 попыток за 4 с → отклонено ${refusals}`,
  );

  resetForumRateLimit();
  take("10.0.0.4", now);
  check(
    "Форум: Retry-After считается по остатку окна",
    retryAfterSeconds("10.0.0.4", now) === Math.ceil(FORUM_COOLDOWN_MS / 1000),
    `${retryAfterSeconds("10.0.0.4", now)} с`,
  );
  check(
    "Форум: неизвестный адрес не блокируется",
    take(null, now) && take(null, now + 1),
    "пропускаем, чтобы не отказать живому посетителю",
  );

  // The IP source. The one that matters is the spoofed header: nginx appends the real
  // peer to whatever the client sent, so the leftmost value is the client's own.
  check(
    "Форум: x-real-ip важнее x-forwarded-for",
    clientIp(headers({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "10.0.0.9" })) ===
      "203.0.113.5",
    "nginx перезаписывает x-real-ip, поэтому он доверенный",
  );
  check(
    "Форум: подделённый левый XFF игнорируется",
    clientIp(headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.5" })) === "203.0.113.5",
    "берётся самое правое значение — то, что добавил nginx",
  );
  check(
    "фо��ум: XFF из нескольких цепочек берёт последний",
    clientIp(headers({ "x-forwarded-for": "10.1.1.1, 10.2.2.2, 203.0.113.9" })) ===
      "203.0.113.9",
    "правый конец",
  );
  check(
    "Форум: мусор в заголовке даёт null, а не чужой адрес",
    clientIp(headers({ "x-forwarded-for": "unknown, unknown" })) === null &&
      clientIp(headers({})) === null,
    "null",
  );

  resetForumRateLimit();
}

// --- 4. the data layer ------------------------------------------------------

const MARKER = "forum:check";

async function checkDataLayer() {
  await ensureForumCategories();
  const categories = await getForumCategories();

  const expected = [
    "Новости и события",
    "Городские проблемы и ЖКХ",
    "Авто и дороги",
    "Свободное общение",
  ];
  const titles = categories.map((category) => category.title);

  check(
    "Форум: базовые разделы созданы",
    expected.every((title) => titles.includes(title)),
    titles.join(", "),
  );
  check(
    "Форум: разделы идут в заданном порядке",
    titles.slice(0, 4).join("|") === expected.join("|"),
    titles.join(" → "),
  );

  // Idempotent: a second call on a populated board must not duplicate anything.
  await ensureForumCategories();
  const after = await getForumCategories();
  check(
    "Форум: повторный запуск не дублирует разделы",
    after.length === categories.length,
    `${categories.length} → ${after.length}`,
  );

  const category = categories[0];
  if (!category) throw new Error("no forum category to test with");

  const slug = await uniqueForumTopicSlug("Проверка forum:check");
  check(
    "Форум: slug темы транслитерируется, а не остаётся служебным",
    slug.startsWith("proverka") && !slug.includes(":"),
    slug,
  );

  let topicId: number | null = null;
  try {
    const topic = await createForumTopic({
      categoryId: category.id,
      title: `Проверка ${MARKER}`,
      authorName: MARKER,
      contentHtml: sanitizeForumHtml(forumTextToHtml("первое сообщение")),
    });
    topicId = topic.id;

    const before = await prisma.forumTopic.findUnique({
      where: { id: topic.id },
      include: { _count: { select: { posts: true } } },
    });
    check(
      "Форум: создание темы добавляет первое сообщение",
      before?._count.posts === 1,
      `сообщений: ${before?._count.posts}`,
    );

    const activityBefore = before!.updatedAt.getTime();

    // The reason `createForumPost` writes to the topic row: @updatedAt only moves when
    // the topic itself is written, so without it a fifty-answer thread would still be
    // listed as if it had been quiet since the day it opened.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await createForumPost({
      topicId: topic.id,
      authorName: MARKER,
      contentHtml: sanitizeForumHtml(forumTextToHtml("второе сообщение")),
    });

    const afterReply = await prisma.forumTopic.findUnique({
      where: { id: topic.id },
      include: { _count: { select: { posts: true } } },
    });
    check(
      "Форум: ответ увеличивает счётчик сообщений",
      afterReply?._count.posts === 2,
      `сообщений: ${afterReply?._count.posts}`,
    );
    check(
      "Форум: ответ двигает активность темы вверх списка",
      afterReply!.updatedAt.getTime() > activityBefore,
      `${new Date(activityBefore).toISOString()} → ${afterReply!.updatedAt.toISOString()}`,
    );

    // A thread with no replies must not fall out of the board's counters.
    const summaries = await getForumCategories();
    const mine = summaries.find((item) => item.id === category.id);
    check(
      "Форум: счётчики раздела учитывают тестовую тему",
      (mine?.topics ?? 0) >= 1 && (mine?.posts ?? 0) >= 2,
      `тем: ${mine?.topics}, ответов: ${mine?.posts}`,
    );

    await prisma.forumTopic.delete({ where: { id: topic.id } });
    topicId = null;

    const orphans = await prisma.forumPost.count({ where: { topicId: topic.id } });
    check(
      "Форум: удаление темы уносит её сообщения каскадом",
      orphans === 0,
      `осталось сообщений: ${orphans}`,
    );
  } finally {
    if (topicId !== null) {
      await prisma.forumTopic.deleteMany({ where: { id: topicId } });
    }
    // Nothing of ours survives the run, even if a check above threw.
    await prisma.forumPost.deleteMany({ where: { authorName: MARKER } });
    await prisma.forumTopic.deleteMany({ where: { authorName: MARKER } });
  }

  check(
    "Форум: лимит длины сообщения разумный",
    FORUM_POST_MAX_LENGTH >= 500 && FORUM_NAME_MAX_LENGTH >= 16,
    `${FORUM_POST_MAX_LENGTH} символов на сообщение, ${FORUM_NAME_MAX_LENGTH} на имя`,
  );
}

async function main() {
  checkSanitiser();
  checkText();
  checkSpamGate();
  await checkDataLayer();

  for (const { name, ok, detail } of checks) {
    console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
  }

  const failed = checks.filter((item) => !item.ok);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} проверок пройдено`,
  );
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main()
  .catch((error: unknown) => {
    console.error("проверки форума не выполнены:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });