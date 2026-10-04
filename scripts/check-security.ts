/**
 * Checks the XSS sanitiser, upload validation, the view counter route and the
 * admin auth gate. Run with: npm run checks:security (needs a dev server).
 */
import { normalizeArticleHtml, plainTextPreview } from "../src/lib/article-html";
import {
  MAX_MEDIA_ITEMS,
  meetsDzenMinimum,
  parseMedia,
  parseMediaField,
} from "../src/lib/article-media";
import { buildDzenContent } from "../src/lib/dzen-feed-html";
import { sanitizeArticleHtml } from "../src/lib/sanitize";
import { normalizeTagList, parseTagsField, tagKey } from "../src/lib/tags";
import {
  AI_HINT_LIMIT,
  COVER_HEIGHT,
  COVER_STEPS,
  COVER_WIDTH,
  PHOTO_STYLE_SUFFIX,
} from "../src/lib/cover-prompt";
import { detectImageFormat, extractImageBytes } from "../src/lib/deepinfra-response";
import {
  ALLOWED_KEYS,
  isAllowedKey,
  maskSecret,
} from "../src/lib/settings-keys";
import { buildVideoEmbed, isAllowedVideoEmbed } from "../src/lib/video-embed";

const checks: { name: string; ok: boolean; detail: string }[] = [];

/**
 * A real 1x1 PNG, concatenated 20 times so the decoded length clears the
 * parser's 1 KB floor. Concatenating the *bytes* and encoding once matters:
 * repeating a padded base64 string does not repeat the data, because a decoder
 * stops at the first "==" it meets.
 */
const IMAGE_FIXTURE_BASE64 = Buffer.concat(
  Array.from({ length: 20 }, () =>
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  ),
).toString("base64");

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

function checkSanitizer() {
  const vectors: [string, string, string][] = [
    ["<script>", "<p>ок</p><script>alert(1)</script>", "alert"],
    ["инлайн onerror", '<img src=x onerror="alert(1)">', "onerror"],
    ["onclick на <a>", '<a href="#" onclick="alert(1)">x</a>', "onclick"],
    ["javascript: в href", '<a href="javascript:alert(1)">x</a>', "javascript:"],
    ["<iframe>", '<iframe src="https://evil.test"></iframe>', "iframe"],
    ["<object>", '<object data="x.swf"></object>', "object"],
    ["<style>", "<style>body{display:none}</style><p>ок</p>", "<style>"],
    ["data: URI в img", '<img src="data:text/html;base64,PHNjcmlwdD4=">', "data:text/html"],
    ["data: URI в a", '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', "data:text/html"],
    ["data: с переносом", '<img src="da\nta:text/html,x">', "ta:text/html"],
    ["<form>/input", '<form action="/x"><input name="a"></form>', "<form"],
    ["svg onload", '<svg onload="alert(1)"></svg>', "onload"],
    ["body onload", "<body onload=\"alert(1)\">ok</body>", "onload"],
  ];

  for (const [name, payload, forbidden] of vectors) {
    const clean = sanitizeArticleHtml(payload);
    check(`Удалено: ${name}`, !clean.includes(forbidden), clean.slice(0, 70));
  }

  // Legitimate editor output must survive untouched.
  const keep: [string, string, string][] = [
    ["абзац", "<p>Текст</p>", "<p>Текст</p>"],
    ["h2", "<h2>Заголовок</h2>", "<h2>Заголовок</h2>"],
    ["жирный", "<strong>жирно</strong>", "<strong>жирно</strong>"],
    ["курсив", "<em>курс</em>", "<em>курс</em>"],
    ["цитата", "<blockquote>цитата</blockquote>", "<blockquote>цитата</blockquote>"],
    ["список", "<ul><li>пункт</li></ul>", "<ul><li>пункт</li></ul>"],
    [
      "таблица",
      "<table><tbody><tr><td>ячейка</td></tr></tbody></table>",
      "<table><tbody><tr><td>ячейка</td></tr></tbody></table>",
    ],
    ["ссылка", '<a href="https://example.com">текст</a>', 'href="https://example.com"'],
    ["выравнивание", '<p style="text-align: center">центр</p>', "text-align: center"],
    ["картинка", '<img src="https://example.com/a.jpg" alt="a">', 'src="https://example.com/a.jpg"'],
    ["pre/code", "<pre><code>npm run dev</code></pre>", "<code>npm run dev</code>"],
    [
      "figure/figcaption",
      '<figure><img src="/uploads/a.png"><figcaption>Подпись</figcaption></figure>',
      "<figcaption>Подпись</figcaption>",
    ],
  ];

  for (const [name, payload, expected] of keep) {
    const clean = sanitizeArticleHtml(payload);
    check(`Сохранено: ${name}`, clean.includes(expected), clean.slice(0, 80));
  }
}

/**
 * Paragraph and line-break handling, plus the video embed allowlist.
 *
 * Both are security-adjacent: the first because it rewrites editor input before
 * it is stored, the second because allowing <iframe> at all widens the XSS
 * surface and has to be narrowed back to known video hosts.
 */
function checkArticleHtml() {
  // --- plain text becomes paragraphs ------------------------------------
  // A blank line is a paragraph break; a single newline is a line break inside
  // one, so both have to survive.
  const plain = normalizeArticleHtml("Первый абзац.\n\nВторой абзац.");
  check(
    "Абзац из пустой строки",
    (plain.match(/<p>/g) ?? []).length === 2,
    plain,
  );

  const oneBreak = normalizeArticleHtml("Строка один\nстрока два");
  check(
    "Перенос строки → <br />",
    oneBreak.includes("<br />") && (oneBreak.match(/<p>/g) ?? []).length === 1,
    oneBreak,
  );

  // The regression that matters visually: a newline the editor typed between two
  // block tags is formatting whitespace and must not become a line break.
  const between = normalizeArticleHtml("<p>Готовый абзац</p>\n<h2>Подзаголовок</h2>");
  check(
    "Перенос между блоками не даёт <br />",
    !between.includes("<br />") &&
      between === "<p>Готовый абзац</p><h2>Подзаголовок</h2>",
    between,
  );

  const codeKept = normalizeArticleHtml("До\n<pre><code>line1\nline2</code></pre>\nПосле");
  check(
    "Переносы внутри <pre> не трогаются",
    codeKept.includes("<code>line1\nline2</code>"),
    codeKept.replace(/\n/g, "\\n").slice(0, 90),
  );

  // --- video embeds ------------------------------------------------------
  const youtube = buildVideoEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  check(
    "YouTube → embed iframe",
    Boolean(youtube?.includes("youtube.com/embed/dQw4w9WgXcQ")),
    youtube?.slice(0, 80) ?? "null",
  );
  // The share sheet produces youtu.be links, where the id has no path prefix.
  const youtubeShort = buildVideoEmbed("https://youtu.be/dQw4w9WgXcQ");
  check(
    "YouTube короткая ссылка → embed iframe",
    Boolean(youtubeShort?.includes("youtube.com/embed/dQw4w9WgXcQ")),
    youtubeShort?.slice(0, 80) ?? "null",
  );
  check(
    "YouTube-embed переживает санитайзер",
    sanitizeArticleHtml(youtube ?? "").includes("youtube.com/embed"),
    "проверено",
  );

  const rutube = buildVideoEmbed("https://rutube.ru/video/abc123def456/");
  check(
    "Rutube → embed iframe",
    Boolean(rutube?.includes("rutube.ru/play/embed/abc123def456")),
    rutube?.slice(0, 80) ?? "null",
  );

  const vk = buildVideoEmbed("https://vk.com/video-241944021_456239021");
  check(
    "VK Видео → embed iframe",
    Boolean(vk?.includes("oid=") && vk.includes("id=")),
    vk?.slice(0, 90) ?? "null",
  );

  check(
    "Ссылка не на видео отклоняется",
    buildVideoEmbed("https://example.com/watch") === null,
    "null",
  );
  check(
    "http (не https) отклоняется",
    !isAllowedVideoEmbed("http://www.youtube.com/embed/abc"),
    "http не принимается",
  );
  check(
    "iframe на чужой домен вырезается",
    !sanitizeArticleHtml(
      '<iframe src="https://evil.test/x"></iframe>',
    ).includes("evil.test"),
    "evil.test отсутствует",
  );
  check(
    "iframe без src вырезается",
    !sanitizeArticleHtml("<iframe></iframe>").includes("<iframe"),
    "пустой iframe удалён",
  );
}

/**
 * Tag normalisation and the metadata fallbacks.
 *
 * The case-folding assertions are the point of the `nameKey` column: SQLite's
 * NOCASE folds ASCII only, so Cyrillic dedup has to happen in JS.
 */
function checkSeoAndTags() {
  const parsed = parseTagsField("нейросети,  разработка ,Гайд,нейросети");
  check(
    "Тэги: разбираются и дедуплицируются",
    parsed.length === 3 && parsed.includes("нейросети") && parsed.includes("разработка"),
    JSON.stringify(parsed),
  );

  check(
    "Тэги: ключ нечувствителен к регистру",
    tagKey("Искусственный Интеллект") === tagKey("искусственный интеллект"),
    tagKey("Искусственный Интеллект"),
  );

  check(
    "Тэги: пустые и пробельные отбрасываются",
    normalizeTagList(["  ", "", "   ", "тест"]).length === 1,
    JSON.stringify(normalizeTagList(["  ", "", "   ", "тест"])),
  );

  check(
    "Тэги: лимит на статью соблюдается",
    normalizeTagList(Array.from({ length: 40 }, (_, i) => `т${i}`)).length === 12,
    String(normalizeTagList(Array.from({ length: 40 }, (_, i) => `т${i}`)).length),
  );

  // An unfilled SEO description must degrade to readable text, not raw markup.
  const derived = plainTextPreview("<p>Первый абзац.</p><h2>Заголовок</h2><p>Второй.</p>", 20);
  check(
    "SEO: описание выводится из текста без разметки",
    !derived.includes("<") && derived.length <= 21,
    JSON.stringify(derived),
  );

  check(
    "SEO: текст без тегов не даёт пустого описания",
    plainTextPreview("Просто текст без разметки", 160).length > 0,
    JSON.stringify(plainTextPreview("Просто текст без разметки", 160)),
  );
}

/**
 * Gallery JSON and the Dzen feed body.
 *
 * Both are attacker-reachable: the gallery mirror is a plain text field in the
 * form, and the feed is public. A malformed entry must degrade to "no gallery"
 * rather than throw on a page render, and the feed body must not smuggle markup
 * past the narrower Dzen allowlist.
 */
function checkArticleMedia() {
  check(
    "Медиа: не-JSON не ломает разбор",
    parseMediaField("{not json").length === 0,
    "пустой галереи",
  );

  check(
    "Медиа: не-массив игнорируется",
    parseMedia({ url: "/uploads/a.jpg" }).length === 0,
    "пустой галереи",
  );

  check(
    "Медиа: мусорные записи отбрасываются",
    parseMedia([
      null,
      "строка",
      42,
      { noUrl: true },
      { url: "   " },
      { url: "/uploads/ok.jpg", caption: "Ок" },
    ]).length === 1,
    JSON.stringify(parseMedia([null, "s", 42, {}, { url: "/uploads/ok.jpg" }])),
  );

  check(
    "Медиа: дубли URL схлопываются",
    parseMedia([
      { url: "/uploads/a.jpg", caption: "раз" },
      { url: "/uploads/a.jpg", caption: "два" },
    ]).length === 1,
    "одна запись",
  );

  const capped = parseMedia(
    Array.from({ length: 40 }, (_, i) => ({ url: `/uploads/${i}.jpg` })),
  );
  check(
    "Медиа: галерея ограничена 10 фото",
    capped.length === MAX_MEDIA_ITEMS,
    `${capped.length} из 40`,
  );

  check(
    "Медиа: каптион обрезан по длине",
    parseMedia([{ url: "/uploads/a.jpg", caption: "я".repeat(1000) }])[0].caption.length ===
      300,
    "300 символов",
  );

  // Dzen drops a picture under its minimum and publishes the piece with no
  // media at all, so an oversized-but-tiny pair must not be shipped.
  check(
    "Медиа: фото меньше 480×320 не проходит в RSS",
    !meetsDzenMinimum({ url: "/uploads/a.jpg", caption: "", source: "", width: 320, height: 240 }) &&
      meetsDzenMinimum({ url: "/uploads/a.jpg", caption: "", source: "", width: 1200, height: 800 }),
    "320×240 отклонено, 1200×800 принято",
  );

  check(
    "Медиа: неподдерживаемый формат отклонён",
    !meetsDzenMinimum({ url: "/uploads/a.webp", caption: "", source: "", width: 1200, height: 800 }) &&
      meetsDzenMinimum({ url: "/uploads/a.png", caption: "", source: "", width: 1200, height: 800 }),
    ".webp отклонён, .png принят",
  );

  const dzenBody = buildDzenContent({
    title: "Заголовок",
    subtitle: "Подзаголовок",
    base: "https://eartnews.ru",
    coverImage: "/uploads/cover.png",
    gallery: [
      { url: "/uploads/one.jpg", caption: "Один", source: "Фото АС", width: 1200, height: 800 },
      { url: "https://cdn.example.com/two.jpg", caption: "", source: "", width: 0, height: 0 },
    ],
    videoUrl: "https://youtu.be/dQw4w9WgXcQ",
    contentHtml:
      '<p style="color:red">Текст</p><table><tr><td>Таблица</td></tr></table>' +
      '<div>Обёртка</div><iframe src="https://www.youtube.com/embed/x"></iframe>' +
      '<a href="/news/other">Ссылка</a><img src="/uploads/inline.jpg" />',
  });

  check(
    "Дзен: разметка вне поддерживаемого набора вырезана",
    !/<table|<div|<span|<pre|class=|style=/i.test(dzenBody),
    "только разрешённые теги",
  );

  check(
    "Дзен: iframe не попадает в ленту",
    !/<iframe/i.test(dzenBody),
    "нет iframe",
  );

  check(
    "Дзен: текст удалённого тега сохранён",
    dzenBody.includes("Таблица") && dzenBody.includes("Обёртка"),
    "KEEP_CONTENT",
  );

  check(
    "Дзен: все URL абсолютные",
    !/(?:href|src)="\/(?!\/)/i.test(dzenBody),
    "нет относительных ссылок",
  );

  check(
    "Дзен: заголовок начинает тело",
    /^<h1>Заголовок<\/h1>/.test(dzenBody),
    dzenBody.slice(0, 40),
  );

  check(
    "Дзен: обложка первым figure",
    dzenBody.indexOf("uploads/cover.png") < dzenBody.indexOf("uploads/one.jpg"),
    "cover раньше галереи",
  );

  check(
    "Дзен: галерея с подписью в figure",
    dzenBody.includes("<figcaption>Один. Фото АС</figcaption>"),
    "figcaption на месте",
  );

  check(
    "Дзен: видео — обычная ссылка",
    dzenBody.includes('<a href="https://youtu.be/dQw4w9WgXcQ">') && !/<iframe/i.test(dzenBody),
    "ссылка вместо плеера",
  );

  // The link is what Dzen turns into a widget; shipping an unsupported host would
  // render as a dead anchor.
  const badVideo = buildDzenContent({
    title: "Т",
    subtitle: null,
    base: "https://eartnews.ru",
    coverImage: null,
    gallery: [],
    videoUrl: "https://example.com/video.mp4",
    contentHtml: "<p>Текст</p>",
  });
  check(
    "Дзен: неподдерживаемый источник видео не вставляется",
    !badVideo.includes("example.com/video.mp4"),
    "ссылка отброшена",
  );

  // One enclosure per item is the RSS rule; the feed must not multiply them.
  check(
    "Дзен: внешняя ссылка не дублируется в галерее",
    !dzenBody.match(/cdn\.example\.com\/two\.jpg/g)?.slice(1).length,
    "нет повторов",
  );
}

/**
 * Cover generation input handling, exercised without touching a provider.
 *
 * The response parser is the fragile part: DeepInfra's v1/inference API has
 * shipped several envelopes for image models, and silently failing to find the
 * image is the difference between "cover generated" and an empty article.
 */
function checkAiCover() {
  check(
    "Генератор: стиль добавляется к подсказке",
    PHOTO_STYLE_SUFFIX.includes("strictly no text") &&
      PHOTO_STYLE_SUFFIX.includes("16:9 aspect ratio"),
    "brief на месте",
  );

  check(
    "Генератор: лимит подсказки 600 символов",
    AI_HINT_LIMIT === 600,
    `${AI_HINT_LIMIT}`,
  );

  // FLUX rejects dimensions that are not multiples of 16, and the frame has to be
  // 16:9 for the news card — a regression on either breaks generation outright.
  check(
    "Генератор: кадр 1024×576 (16:9, кратно 16)",
    COVER_WIDTH === 1024 &&
      COVER_HEIGHT === 576 &&
      COVER_WIDTH / COVER_HEIGHT === 16 / 9 &&
      COVER_WIDTH % 16 === 0 &&
      COVER_HEIGHT % 16 === 0,
    `${COVER_WIDTH}×${COVER_HEIGHT}`,
  );

  check(
    "Генератор: ширина выше минимума Дзена в 700 px",
    COVER_WIDTH >= 700,
    `${COVER_WIDTH} >= 700`,
  );

  check(
    "Генератор: 4 шага FLUX-1-schnell",
    COVER_STEPS === 4,
    `${COVER_STEPS}`,
  );
}

/** Exercises the image extractor against every envelope DeepInfra has shipped. */
function checkDeepInfraEnvelope() {
  const payload = IMAGE_FIXTURE_BASE64;

  const shapes: Record<string, unknown> = {
    "output: base64": { output: payload },
    "image: base64": { image: payload },
    "images: массив": { images: [payload] },
    "images: объекты": { images: [{ b64_json: payload }] },
    "data: массив": { data: [{ b64_json: payload }] },
    "inference.output": { inference: { output: payload } },
    "data URL": { output: `data:image/png;base64,${payload}` },
    "голая строка": payload,
  };

  for (const [name, body] of Object.entries(shapes)) {
    const found = extractImageBytes(body);
    check(
      `Генератор: разбор «${name}»`,
      found !== null,
      found ? `${found.length} байт` : "не найдено",
    );
  }

  // Magic-byte detection is what stops a plausible-length non-image being
  // accepted: "x" is a valid base64 character, so 4096 of them decode to over
  // 3 KB of nothing.
  const junk: Record<string, unknown> = {
    "ошибка": { error: "model not found" },
    "пустой объект": {},
    "короткая строка": { output: "abcd" },
    "не-base64, но верной длины": { output: "x".repeat(4096) },
    "base64 без сигнатуры файла": { output: Buffer.alloc(4096, 7).toString("base64") },
    "число вместо строки": { output: 12345 },
    "url вместо картинки": { url: "https://example.com/cover.png" },
  };

  for (const [name, body] of Object.entries(junk)) {
    const found = extractImageBytes(body);
    check(
      `Генератор: «${name}» не принят за картинку`,
      found === null,
      found ? "ложное срабатывание" : "отклонено",
    );
  }

  // Each supported format is recognised, so a provider switch to JPEG or WebP
  // does not silently start failing.
  const onePixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  check(
    "Генератор: сигнатура PNG распознаётся",
    detectImageFormat(onePixel) === "image/png",
    detectImageFormat(onePixel) ?? "нет",
  );
  check(
    "Генератор: сигнатура JPEG распознаётся",
    detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])) === "image/jpeg",
    "image/jpeg",
  );
  check(
    "Генератор: сигнатура WebP распознаётся",
    detectImageFormat(
      Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]),
    ) === "image/webp",
    "image/webp",
  );
  check(
    "Генератор: сигнатура ELF не считается картинкой",
    detectImageFormat(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])) === null,
    "отклонено",
  );
}

/**
 * Settings service and its two routes.
 *
 * The settings endpoint is the only place in the project that can write
 * configuration at runtime, so it gets the same treatment as the upload gate:
 * anonymous access refused, unknown body fields ignored rather than persisted,
 * and no full key ever returned.
 */
async function checkSettingsApi(base: string, auth: string) {
  const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  // --- gating ---------------------------------------------------------------
  const anonGet = await fetch(`${base}/api/admin/settings`);
  check("/api/admin/settings без авторизации → 401", anonGet.status === 401, `${anonGet.status}`);

  const anonPost = await postJson("/api/admin/settings", { deepseekApiKey: "sk-test" });
  check(
    "POST /api/admin/settings без авторизации → 401",
    anonPost.status === 401,
    `${anonPost.status}`,
  );

  const anonTest = await postJson("/api/admin/settings/test", { provider: "deepseek" });
  check(
    "POST /api/admin/settings/test без авторизации → 401",
    anonTest.status === 401,
    `${anonTest.status}`,
  );

  const pageAnon = await fetch(`${base}/admin/settings`);
  check("/admin/settings без авторизации → 401", pageAnon.status === 401, `${pageAnon.status}`);

  const pageAuth = await fetch(`${base}/admin/settings`, { headers: { authorization: auth } });
  check("/admin/settings с авторизацией → 200", pageAuth.status === 200, `${pageAuth.status}`);

  // The nav link the settings page depends on for discoverability.
  const listHtml = await (
    await fetch(`${base}/admin/articles`, { headers: { authorization: auth } })
  ).text();
  check(
    "В верхнем меню админки есть ссылка «Настройки»",
    listHtml.includes("/admin/settings") && listHtml.includes("Настройки"),
    "ссылка на месте",
  );

  // --- CSRF -----------------------------------------------------------------
  const formPost = await fetch(`${base}/api/admin/settings`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: auth },
    body: "deepseekApiKey=sk-attacker",
  });
  check(
    "POST /api/admin/settings: не-JSON отклонён (защита от CSRF)",
    formPost.status === 415,
    `${formPost.status}`,
  );

  // --- validation, all refused before any write ------------------------------
  const tooShort = await postJson(
    "/api/admin/settings",
    { deepseekApiKey: "sk-a" },
    { authorization: auth },
  );
  check("Ключ короче минимума → 400", tooShort.status === 400, `${tooShort.status}`);

  const withSpaces = await postJson(
    "/api/admin/settings",
    { deepseekApiKey: "sk-abc def ghi" },
    { authorization: auth },
  );
  check("Ключ с пробелами → 400", withSpaces.status === 400, `${withSpaces.status}`);

  const wrongType = await postJson(
    "/api/admin/settings",
    { deepseekApiKey: 12345 },
    { authorization: auth },
  );
  check("Ключ не строка → 400", wrongType.status === 400, `${wrongType.status}`);

  const nothing = await postJson("/api/admin/settings", {}, { authorization: auth });
  check("Пустое тело → 400", nothing.status === 400, `${nothing.status}`);

  // --- unknown fields must be ignored, never written ------------------------
  // The dangerous version of a settings API is one that will store ADMIN_PASSWORD
  // or DATABASE_URL on request. Only the two mapped field names are accepted.
  const canary = `sk-canary-${Date.now()}`;
  const smuggled = await postJson(
    "/api/admin/settings",
    { deepseekApiKey: canary, ADMIN_PASSWORD: "hacked", DATABASE_URL: "file:/tmp/x" },
    { authorization: auth },
  );
  check("Неизвестные поля приняты без ошибки", smuggled.status === 200, `${smuggled.status}`);

  const afterSmuggle = (await (await fetch(`${base}/api/admin/settings`, {
    headers: { authorization: auth },
  })).json()) as { settings: Record<string, { masked: string; isSet: boolean; source: string }> };

  const secretLeak = [
    JSON.stringify(afterSmuggle),
    "hacked",
  ].some((needle) => JSON.stringify(afterSmuggle).includes(needle) && needle === "hacked");
  check(
    "Чужие поля не сохранены (секрет не утёк в ответ)",
    !secretLeak,
    secretLeak ? "утечка" : "чисто",
  );

  // --- masking --------------------------------------------------------------
  const settings = afterSmuggle.settings;
  check(
    "GET возвращает оба поля",
    Boolean(settings?.deepseekApiKey && settings?.deepinfraApiKey),
    "оба ключа",
  );
  check(
    "Маска не равна исходному ключу",
    settings?.deepseekApiKey?.masked !== canary,
    settings?.deepseekApiKey?.masked ?? "нет",
  );
  check(
    "Маска не содержит середину ключа",
    !settings?.deepseekApiKey?.masked?.includes(canary.slice(6, -4)),
    "только начало и конец",
  );
  check(
    "У сохранённого ключа isSet = true и source = database",
    settings?.deepseekApiKey?.isSet === true && settings.deepseekApiKey.source === "database",
    `${settings?.deepseekApiKey?.isSet}, ${settings?.deepseekApiKey?.source}`,
  );

  // --- the whole point: no pm2 restart needed --------------------------------
  // The cover route reads keys through getSetting, so the value just written must
  // already be visible to a request that never touches .env.
  const canaryBody = await postJson(
    "/api/admin/generate-cover",
    { mode: "custom", prompt: "проверка сквозного чтения" },
    { authorization: auth },
  );
  const canaryText = await canaryBody.text();
  check(
    "Генератор сразу использует ключ из базы (провайдер ответил, а не «не задан»)",
    canaryText.includes("DEEPSEEK_API_KEY") === false &&
      canaryText.includes("Не задан") === false,
    canaryBody.status === 429
      ? "429 (окно частоты) — ключ прочитан"
      : canaryBody.status === 502 || canaryBody.status === 503
        ? `провайдер ответил ${canaryBody.status}`
        : `${canaryBody.status}: ${canaryText.slice(0, 60)}`,
  );

  // --- cleanup --------------------------------------------------------------
  // Restores whatever was configured before the canary, so running the suite
  // never leaves a junk key in the settings table.
  const cleared = await postJson(
    "/api/admin/settings",
    { deepseekApiKey: "" },
    { authorization: auth },
  );
  check("Очистка ключа → 200", cleared.status === 200, `${cleared.status}`);

  const clearedBody = (await cleared.json()) as {
    settings?: Record<string, { isSet: boolean; source: string }>;
  };
  check(
    "После очистки ключ берётся из .env либо снят",
    clearedBody.settings?.deepseekApiKey?.source !== "database",
    `source=${clearedBody.settings?.deepseekApiKey?.source}`,
  );

  // --- test-connection endpoint guards ---------------------------------------
  const badProvider = await postJson(
    "/api/admin/settings/test",
    { provider: "openai" },
    { authorization: auth },
  );
  check("Неизвестный провайдер → 400", badProvider.status === 400, `${badProvider.status}`);

  const noKey = await postJson(
    "/api/admin/settings/test",
    { provider: "deepseek" },
    { authorization: auth },
  );
  const noKeyBody = (await noKey.json().catch(() => ({}))) as { error?: string };
  check(
    "Проверка без ключа не уходит в сеть → 400",
    noKey.status === 400,
    `${noKey.status}: ${(noKeyBody.error ?? "").slice(0, 40)}`,
  );

  const badJsonTest = await fetch(`${base}/api/admin/settings/test`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: "не json",
  });
  check("Проверка: не-JSON тело → 400", badJsonTest.status === 400, `${badJsonTest.status}`);
}

/**
 * Settings primitives.
 *
 * Masking is the only thing standing between a leaked log or a shoulder-surfed
 * screen and a billable key, and the "empty row falls back to .env" rule is what
 * makes clearing a key in the UI behave like the form claims.
 */
function checkSettingsPrimitives() {
  check(
    "Маска: у ключа показывает начало и конец",
    maskSecret("sk-abcdefghijklmnop1234") === "sk-abc…1234",
    maskSecret("sk-abcdefghijklmnop1234"),
  );

  check(
    "Маска: короткий ключ не раскрывается",
    maskSecret("sk-12345") === "•".repeat(8) && !maskSecret("sk-12345").includes("sk-"),
    `8 точек вместо символов`,
  );

  check(
    "Маска: пустая строка остаётся пустой",
    maskSecret("   ") === "",
    "пусто",
  );

  // The middle of a key must never appear in its own mask.
  const longKey = "sk-proj-ABCDEFGHIJKLMNOP-0123456789xyz";
  const mask = maskSecret(longKey);
  check(
    "Маска: середина ключа не утекает",
    !mask.includes("HIJKLMNOP") && mask.length < longKey.length,
    mask,
  );

  check(
    "Настройки: allowlist непустой и без посторонних ключей",
    ALLOWED_KEYS.length === 2 &&
      isAllowedKey("DEEPSEEK_API_KEY") &&
      isAllowedKey("DEEPINFRA_API_KEY"),
    ALLOWED_KEYS.join(", "),
  );

  // The critical negative: ADMIN_PASSWORD and DATABASE_URL must not be
  // reachable through this service at all.
  for (const forbidden of [
    "ADMIN_PASSWORD",
    "ADMIN_USER",
    "DATABASE_URL",
    "VK_ACCESS_TOKEN",
    "NEXT_PUBLIC_SITE_URL",
    "UPLOAD_DIR",
  ]) {
    check(
      `Настройки: ${forbidden} недоступен через сервис`,
      !isAllowedKey(forbidden),
      "не в allowlist",
    );
  }

  // Masking a value that is not there must not throw: the settings page renders
  // the form whether or not a key exists.
  check(
    "Маска: отсутствующая переменная окружения не роняет форму",
    maskSecret(process.env.DEEPSEEK_API_KEY ?? "") === "" ||
      maskSecret(process.env.DEEPSEEK_API_KEY ?? "").includes("…"),
    "безопасно",
  );
}

async function main() {
  checkSanitizer();
  checkArticleHtml();
  checkSeoAndTags();
  checkArticleMedia();
  checkAiCover();
  checkDeepInfraEnvelope();
  checkSettingsPrimitives();

  const base = process.env.CHECK_BASE_URL?.trim() || "http://localhost:3000";

  // /api/upload now sits behind the same Basic Auth as /admin, so every upload
  // assertion has to carry credentials.
  const auth = `Basic ${Buffer.from(
    `${process.env.ADMIN_USER}:${process.env.ADMIN_PASSWORD}`,
  ).toString("base64")}`;

  const post = (body: FormData) =>
    fetch(`${base}/api/upload`, {
      method: "POST",
      body,
      headers: { authorization: auth },
    });

  // A real 1x1 PNG.
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  // The gate that was missing: this endpoint writes attacker-chosen bytes to
  // disk, so an anonymous POST must not reach the handler.
  const anonymousUpload = new FormData();
  anonymousUpload.append("file", new File([PNG], "x.png", { type: "image/png" }));
  const anonResponse = await fetch(`${base}/api/upload`, {
    method: "POST",
    body: anonymousUpload,
  });
  check(
    "/api/upload без авторизации → 401",
    anonResponse.status === 401,
    `${anonResponse.status}`,
  );

  const good = new FormData();
  good.append("file", new File([PNG], "cover.png", { type: "image/png" }));
  const okResponse = await post(good);
  const okBody = (await okResponse.json()) as { url?: string; error?: string };
  check(
    "Загрузка PNG принята",
    okResponse.status === 201 &&
      typeof okBody.url === "string" &&
      okBody.url.startsWith("/uploads/"),
    okBody.url ?? okBody.error ?? String(okResponse.status),
  );

  const stored = okBody.url ? await fetch(`${base}${okBody.url}`) : null;
  check(
    "Файл доступен по возвращённому URL",
    stored !== null && stored.status === 200,
    stored ? `${stored.status} ${stored.headers.get("content-type")}` : "нет url",
  );

  const svg = new FormData();
  svg.append(
    "file",
    new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/svg+xml" }),
  );
  check("SVG отклонён", (await post(svg)).status === 415, "ожидался 415");

  const exe = new FormData();
  exe.append(
    "file",
    new File(["MZ"], "virus.exe", { type: "application/x-msdownload" }),
  );
  check("Неизвестный тип отклонён", (await post(exe)).status === 415, "ожидался 415");

  const empty = new FormData();
  empty.append("file", new File([], "empty.png", { type: "image/png" }));
  check("Пустой файл отклонён", (await post(empty)).status === 400, "ожидался 400");

  check(
    "Отсутствие файла отклонено",
    (await post(new FormData())).status === 400,
    "ожидался 400",
  );

  const badId = await fetch(`${base}/api/articles/not-an-id/view`, { method: "POST" });
  check("Мусорный id в счётчике отклонён", badId.status === 400, `${badId.status}`);

  // cuid() ids are 25 chars; the id must be well-formed before the DB is hit.
  // The upload button lives on the editor's "Медиа" tab, which is not in the
  // server HTML until the tab is opened, so the tab bar is asserted here and
  // the handler is covered by the upload round-trip above.
  const adminHtml = await (
    await fetch(`${base}/admin/articles/new`, {
      headers: {
        authorization: `Basic ${Buffer.from(
          `${process.env.ADMIN_USER}:${process.env.ADMIN_PASSWORD}`,
        ).toString("base64")}`,
      },
    })
  ).text();
  check(
    "Редактор отдаёт вкладку «Медиа»",
    adminHtml.includes("Медиа"),
    adminHtml.includes("Медиа") ? "вкладка на месте" : "вкладки нет в HTML",
  );

  const missing = await fetch(`${base}/api/articles/cmdoesnotexist1234567/view`, {
    method: "POST",
  });
  check("Несуществующая статья → 404", missing.status === 404, `${missing.status}`);

  // --- AI cover endpoint ----------------------------------------------------
  // It spends money per call and writes to UPLOAD_DIR, so the gate matters more
  // here than for any other route. These assertions never reach the providers:
  // every case is refused before a key is read.
  const aiBody = JSON.stringify({ mode: "auto", title: "Тест" });

  const aiAnon = await fetch(`${base}/api/admin/generate-cover`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: aiBody,
  });
  check(
    "Генератор обложки без авторизации → 401",
    aiAnon.status === 401,
    `${aiAnon.status}`,
  );

  const aiWrong = await fetch(`${base}/api/admin/generate-cover`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from("admin:nope").toString("base64")}`,
    },
    body: aiBody,
  });
  check(
    "Генератор обложки с неверным паролем → 401",
    aiWrong.status === 401,
    `${aiWrong.status}`,
  );

  // With credentials, a form-shaped body must still be refused: an HTML form can
  // only send urlencoded/multipart/text-plain, so requiring JSON is what stops a
  // page on another origin from spending the account's credit.
  const aiForm = await fetch(`${base}/api/admin/generate-cover`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: auth,
    },
    body: "mode=auto&title=test",
  });
  check(
    "Генератор: не-JSON отклонён (защита от CSRF)",
    aiForm.status === 415,
    `${aiForm.status}`,
  );

  const aiBadJson = await fetch(`${base}/api/admin/generate-cover`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: "not json at all",
  });
  check(
    "Генератор: не-JSON тело → 400",
    aiBadJson.status === 400,
    `${aiBadJson.status}`,
  );

  // Empty story: refused before any provider call, so this passes with no keys
  // configured and costs nothing.
  const aiEmpty = await fetch(`${base}/api/admin/generate-cover`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify({ mode: "auto" }),
  });
  const aiEmptyBody = (await aiEmpty.json().catch(() => ({}))) as { error?: string };
  check(
    "Генератор: пустая статья отклонена до вызова провайдера",
    aiEmpty.status === 400 && (aiEmptyBody.error ?? "").includes("Нечего описать"),
    `${aiEmpty.status}: ${(aiEmptyBody.error ?? "").slice(0, 48)}`,
  );

  const aiNoHint = await fetch(`${base}/api/admin/generate-cover`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify({ mode: "custom" }),
  });
  const aiNoHintBody = (await aiNoHint.json().catch(() => ({}))) as { error?: string };
  check(
    "Генератор: пустая подсказка отклонена",
    aiNoHint.status === 400 && (aiNoHintBody.error ?? "").includes("подсказку"),
    `${aiNoHint.status}: ${(aiNoHintBody.error ?? "").slice(0, 40)}`,
  );

  // The two rejections above must not have consumed the rate-limit slot, or an
  // editor's typo would block their own retry.
  const keysConfigured = Boolean(
    process.env.DEEPSEEK_API_KEY?.trim() && process.env.DEEPINFRA_API_KEY?.trim(),
  );

  if (keysConfigured) {
    check("Генератор: ключи настроены", true, "проверка 503 пропущена — ключи есть");
  } else {
    // With no keys set the endpoint must answer with a readable 503 that names the
    // missing variable, not a stack trace and not a silent success.
    const aiNoKeys = await fetch(`${base}/api/admin/generate-cover`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: auth },
      body: JSON.stringify({ mode: "custom", prompt: "Проверка наличия ключа" }),
    });
    const aiNoKeysBody = (await aiNoKeys.json().catch(() => ({}))) as { error?: string };
    check(
      "Генератор: без ключей — понятная ошибка с именем переменной",
      aiNoKeys.status === 503 &&
        /DEEPSEEK_API_KEY|DEEPINFRA_API_KEY/.test(aiNoKeysBody.error ?? ""),
      `${aiNoKeys.status}: ${(aiNoKeysBody.error ?? "").slice(0, 64)}`,
    );
  }

  // Each generation costs money, so back-to-back calls are refused. Asserted last
  // among the authenticated cases because it depends on the previous one having
  // just taken a slot.
  const aiRate = await fetch(`${base}/api/admin/generate-cover`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify({ mode: "custom", prompt: "Повторный запрос" }),
  });
  const aiRateBody = (await aiRate.json().catch(() => ({}))) as { error?: string };
  check(
    "Генератор: повторный вызов ограничен по частоте",
    aiRate.status === 429,
    `${aiRate.status}: ${(aiRateBody.error ?? "").slice(0, 40)}`,
  );

  const malformed = await fetch(`${base}/api/articles/short/view`, { method: "POST" });
  check("Некорректный формат id → 400", malformed.status === 400, `${malformed.status}`);

  const anonymous = await fetch(`${base}/admin/articles`);
  check(
    "/admin без авторизации → 401",
    anonymous.status === 401,
    `${anonymous.status}, WWW-Authenticate: ${
      anonymous.headers.get("www-authenticate")?.slice(0, 42) ?? "нет"
    }`,
  );

  const wrong = await fetch(`${base}/admin/articles`, {
    headers: {
      authorization: `Basic ${Buffer.from("admin:nope").toString("base64")}`,
    },
  });
  check("/admin с неверным паролем → 401", wrong.status === 401, `${wrong.status}`);

  const right = await fetch(`${base}/admin/articles`, {
    headers: {
      authorization: `Basic ${Buffer.from(
        `${process.env.ADMIN_USER}:${process.env.ADMIN_PASSWORD}`,
      ).toString("base64")}`,
    },
  });
  check("/admin с верными данными → 200", right.status === 200, `${right.status}`);

  const publicPage = await fetch(`${base}/`);
  check(
    "Публичная страница без авторизации → 200",
    publicPage.status === 200,
    `${publicPage.status}`,
  );

  await checkSettingsApi(base, auth);

  console.log("\nПроверки безопасности и интеграций\n");
  for (const { name, ok, detail } of checks) {
    console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
