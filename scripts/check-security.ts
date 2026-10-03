/**
 * Checks the XSS sanitiser, upload validation, the view counter route and the
 * admin auth gate. Run with: npm run checks:security (needs a dev server).
 */
import { normalizeArticleHtml } from "../src/lib/article-html";
import { sanitizeArticleHtml } from "../src/lib/sanitize";
import { buildVideoEmbed, isAllowedVideoEmbed } from "../src/lib/video-embed";

const checks: { name: string; ok: boolean; detail: string }[] = [];

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

async function main() {
  checkSanitizer();
  checkArticleHtml();

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
