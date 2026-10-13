/**
 * Telegram and MAX auto-posting: the post text, the splitting rules, and the settings
 * that feed them.
 *
 * What this suite is for, stated plainly: the alternative to asserting the split rules
 * is publishing a 3000-character article into a live channel and looking at it. The
 * boundaries are 1024, 4000 and 3500 characters, they come from two vendors'
 * documentation, and they are the kind of number that is correct on the day it is
 * written and silently wrong after a refactor that "tidies up" a constant.
 *
 * No network, no database, no server-only imports — every function under test is pure,
 * which is why `messenger-post.ts` and the validation half of `settings-keys.ts` were
 * kept free of Prisma and of `server-only` in the first place.
 */

import {
  LONG_READING_BODY_LIMIT,
  MAX_MESSAGE_LIMIT,
  MESSENGER_QUOTE_PREFIX,
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  buildMessengerPost,
  coverPreviewLink,
  cutForReading,
  escapeAttribute,
  escapeHtml,
  htmlToPlainText,
  planMaxPost,
  planTelegramPost,
  readMoreLink,
  readingNotice,
  stripKickerLines,
  toHashtag,
  type MessengerPost,
} from "../src/lib/messenger-post";
import {
  DEFAULT_SYNDICATION_ENABLED,
  SYNDICATION_FIELDS,
  isMessengerConfigured,
  maskSecret,
  parseEnabled,
  toView,
  validateApiRoot,
  validateSyndicationField,
} from "../src/lib/settings-keys";
import {
  MAX_CERTIFICATE_HINT,
  describeMaxError,
  isMaxCertificateError,
  maxNotConfigured,
  publishArticleToMax,
  readMaxUploadToken,
  resetMaxConfigSource,
  setMaxConfigSource,
} from "../src/lib/max-publisher";
import {
  TELEGRAM_UNREACHABLE_HINT,
  DEFAULT_TELEGRAM_API_ROOT,
  describeApiRoot,
  describeTelegramError,
  isTelegramUnreachable,
  pingTelegramEndpoint,
  publishArticleToTelegram,
  resetTelegramConfigSource,
  resetTelegramProxyCache,
  setTelegramConfigSource,
  telegramApiBase,
  telegramProxy,
} from "../src/lib/telegram-publisher";
import { resetSyndicationSleep, setSyndicationSleep } from "../src/lib/syndication/retry";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const SITE = "https://eartnews.ru";

/** A paragraph of roughly `size` characters, so length boundaries can be hit exactly. */
function paragraph(size: number, marker = "а"): string {
  return marker.repeat(Math.max(0, size));
}

/**
 * A post assembled by hand, as the planner checks below use.
 *
 * No headline block, no rubric: the whole text is the body. The publisher never builds one of
 * these — `buildMessengerPost` is the only producer — but the planner's own contract is about
 * lengths and steps, and stating the parts explicitly here is what keeps those checks from
 * depending on how the builder happens to join its blocks.
 */
function barePost(text: string, url = "u"): MessengerPost {
  return { text, url, headline: "", body: text, hashtag: "" };
}

/** A body long enough to push the post past any given threshold. */
function bodyOfLength(total: number): string {
  const paragraphSize = 400;
  const count = Math.ceil(total / paragraphSize);
  return Array.from({ length: count }, (_, i) => paragraph(paragraphSize, "абвг"[i % 4]!)).join(
    "</p><p>",
  );
}

// --- editor HTML to plain text ------------------------------------------------

/*
  The regression these guard: `plainTextPreview` collapses all whitespace, which is
  right for a word count and wrong for a channel post. A body that arrives as one
  2000-character wall has lost the only structure the reader had, and nothing else in
  the suite would notice.
*/
check(
  "Текст: абзацы сохранены как абзацы",
  htmlToPlainText("<p>Первый.</p><p>Второй.</p>") === "Первый.\n\nВторой.",
  JSON.stringify(htmlToPlainText("<p>Первый.</p><p>Второй.</p>")),
);

check(
  "Текст: <br> даёт перенос строки, а не новый абзац",
  htmlToPlainText("строка один<br>строка два") === "строка один\nстрока два",
  JSON.stringify(htmlToPlainText("строка один<br>строка два")),
);

check(
  "Текст: <br/> и <br /> тоже переносы",
  htmlToPlainText("a<br/>b<br />c") === "a\nb\nc",
  JSON.stringify(htmlToPlainText("a<br/>b<br />c")),
);

check(
  "Текст: пункты списка получают маркер",
  htmlToPlainText("<ul><li>первый</li><li>второй</li></ul>") ===
    "• первый\n• второй",
  JSON.stringify(htmlToPlainText("<ul><li>первый</li><li>второй</li></ul>")),
);

check(
  "Текст: заголовок отделяется абзацем",
  htmlToPlainText("<h2>Заголовок</h2><p>Текст</p>") === "Заголовок\n\nТекст",
  JSON.stringify(htmlToPlainText("<h2>Заголовок</h2><p>Текст</p>")),
);

check(
  "Текст: содержимое script и style не попадает в пост",
  htmlToPlainText("<p>Слева</p><script>alert(1)</script><style>p{}</style><p>Справа</p>") ===
    "Слева\n\nСправа",
  JSON.stringify(htmlToPlainText("<p>Слева</p><script>alert(1)</script><style>p{}</style>")),
);

check(
  "Текст: неизвестный тег не съедает соседний текст",
  htmlToPlainText('<p>до <span data-x="1">картинка</span> после</p>') === "до картинка после",
  JSON.stringify(htmlToPlainText('<p>до <span data-x="1">картинка</span> после</p>')),
);

/*
  A figure *is* a block element, so it does break the paragraph — asserted separately
  because the case above would otherwise suggest the opposite, and a gallery stripped
  inline would run its caption into the paragraph below it.
*/
check(
  "Текст: figure разрывает абзац, а не слипается с текстом",
  htmlToPlainText("<p>до</p><figure><span>подпись</span></figure><p>после</p>") ===
    "до\n\nподпись\n\nпосле",
  JSON.stringify(htmlToPlainText("<p>до</p><figure><span>подпись</span></figure><p>после</p>")),
);

check(
  "Текст: сущности декодируются",
  htmlToPlainText("<p>5 &lt; 6 &amp;&amp; 7 &gt; 6</p>") === "5 < 6 && 7 > 6",
  JSON.stringify(htmlToPlainText("<p>5 &lt; 6 &amp;&amp; 7 &gt; 6</p>")),
);

/*
  The order matters and this is the assertion for it: entities are decoded *after* the
  tags are stripped, so text that merely looks like markup comes out as the characters
  the editor typed. Decoding first would let "&amp;lt;b&amp;gt;" become live bold.
*/
check(
  "Текст: текст, похожий на разметку, остаётся текстом",
  htmlToPlainText("<p>&lt;b&gt;жирно&lt;/b&gt;</p>") === "<b>жирно</b>",
  JSON.stringify(htmlToPlainText("<p>&lt;b&gt;жирно&lt;/b&gt;</p>")),
);

check(
  "Текст: числовые сущности декодируются",
  htmlToPlainText("<p>&#1055;&#1088;&#1080;&#1074;&#1077;&#1090;</p>") === "Привет",
  JSON.stringify(htmlToPlainText("<p>&#1055;&#1088;&#1080;&#1074;&#1077;&#1090;</p>")),
);

check(
  "Текст: нечисловой переполненный кодпоинт не роняет функцию",
  htmlToPlainText("<p>a&#xFFFFFF;b</p>") === "ab",
  JSON.stringify(htmlToPlainText("<p>a&#xFFFFFF;b</p>")),
);

check(
  "Текст: неразрывный пробел становится обычным",
  htmlToPlainText("<p> в начале </p>") === "в начале",
  JSON.stringify(htmlToPlainText("<p> в начале </p>")),
);

check(
  "Текст: три пустых строки подряд схлопываются в одну",
  htmlToPlainText("<p>a</p><p></p><p></p><p></p><p>b</p>") === "a\n\nb",
  JSON.stringify(htmlToPlainText("<p>a</p><p></p><p></p><p></p><p>b</p>")),
);

check(
  "Текст: пустой и пробельный вход дают пустую строку",
  htmlToPlainText("") === "" && htmlToPlainText("   \n  ") === "",
  "без исключений",
);

// --- escaping and hashtags -----------------------------------------------------

check(
  "Экранирование: три символа, которые ломают HTML parse_mode",
  escapeHtml(`<b>&"a"`) === "&lt;b&gt;&amp;&quot;a&quot;".replace(/&quot;/g, '"').replace(/"$/, '"'),
  escapeHtml(`<b>&"a"`),
);

check(
  "Экранирование: амперсанд экранируется раньше остальных",
  escapeHtml("&lt;") === "&amp;lt;",
  escapeHtml("&lt;"),
);

check(
  "Хештег: кириллическая рубрика сохраняется",
  toHashtag("Происшествия") === "#Происшествия",
  toHashtag("Происшествия"),
);

check(
  "Хештег: пробелы заменяются подчёркиванием, а не исчезают",
  toHashtag("Мир и политика") === "#Мир_и_политика",
  toHashtag("Мир и политика"),
);

check(
  "Хештег: пунктуация схлопывается в один подчёркивающий",
  toHashtag("Наука — техника") === "#Наука_техника",
  toHashtag("Наука — техника"),
);

check(
  "Хештег: пустая рубрика даёт пустую строку, а не «#»",
  toHashtag("") === "" && toHashtag(null) === "" && toHashtag("   ") === "",
  "нет висячего решётки",
);

// --- the shape of a post ------------------------------------------------------

const simplePost = buildMessengerPost({
  title: "Заголовок новости",
  contentHtml: "<p>Тело новости.</p><p>Второй абзац.</p>",
  slug: "zagolovok-novosti",
  categoryName: "Происшествия",
  siteUrl: SITE,
});

check(
  "Пост: заголовок жирным",
  simplePost.text.startsWith("<b>Заголовок новости</b>"),
  simplePost.text.slice(0, 40),
);

check(
  "Пост: тело целиком, абзацы сохранены",
  simplePost.text.includes("Тело новости.\n\nВторой абзац."),
  "оба абзаца",
);

check(
  "Пост: ссылка-словами в самом конце, перед хештегом",
  // Прежде здесь было «Ё-новости: https://eartnews.ru/news/zagolovok-novosti» — три строки на
  // телефоне. Теперь адрес спрятан за словами, а сам нигде в подписи не печатается.
  simplePost.text.endsWith(
    `👉 <a href="${SITE}/news/zagolovok-novosti">Читать полностью на сайте</a>\n#Происшествия`,
  ),
  JSON.stringify(simplePost.text.slice(-90)),
);

check(
  "Пост: сырого адреса в тексте не осталось",
  // Адрес есть только внутри `href`. Любое другое его появление — либо мусор в подписи,
  // либо забытая строка кредита.
  !simplePost.text.replace(/<a href="[^"]*">/g, "").includes(SITE),
  simplePost.text.replace(/<a href="[^"]*">/g, "").slice(-60),
);

check(
  "Пост: в href попадает именно адрес материала",
  /<a href="https:\/\/eartnews\.ru\/news\/zagolovok-novosti">/.test(simplePost.text),
  (/<a href="([^"]*)"/.exec(simplePost.text) ?? [])[1] ?? "(нет)",
);

check(
  "Пост: ссылка на материал совпадает с url",
  simplePost.url === `${SITE}/news/zagolovok-novosti`,
  simplePost.url,
);

check(
  "Ссылка в подвале: анкор вместо адреса, и адрес не может вырваться из кавычек",
  // Сырой адрес занимал три строки на телефоне. Теперь он спрятан за словами, и единственное,
  // что его показывает — `href`.
  //
  // Кавычка в адресе закрыла бы атрибут и утащила в разметку остальную строку поста. Проверяется
  // не наличие слова «onmouseover» — оно может остаться внутри значения как обычный текст, —
  // а единственное, что важно: во всей строке ровно две кавычки, обе обрамляют `href`.
  readMoreLink(`${SITE}/news/x`) ===
    `👉 <a href="${SITE}/news/x">Читать полностью на сайте</a>` &&
    (readMoreLink(`${SITE}/news/x" onmouseover="alert(1)`).match(/"/g) ?? []).length === 2,
  readMoreLink(`${SITE}/news/x" onmouseover="a`).slice(0, 70),
);

check(
  "Ссылка в подвале: кавычки в адресе экранируются",
  escapeAttribute(`a"b'c&d<e`) === "a&quot;b&#39;c&amp;d&lt;e",
  escapeAttribute(`a"b'c&d<e`),
);

check(
  "Ссылка в подвале: обрезанный пост и предпросмотр оборачивают адрес одинаково",
  readingNotice(`${SITE}/news/x`).includes(`<a href="${SITE}/news/x">`) &&
    coverPreviewLink(`${SITE}/news/x`).includes(`<a href="${SITE}/news/x">`),
  readingNotice(`${SITE}/news/x`).slice(-60),
);

check(
  "Предпросмотр: невидимая ссылка на обложку стоит нулевой шириной",
  // Текст ссылки — U+200B, нулевая ширина: в канале не видна, но это первая ссылка, и по ней
  // Telegram строит большое фото над текстом. Кавычки в адресе экранируются, как и в подвале.
  coverPreviewLink(`${SITE}/uploads/x.jpg`) ===
    `<a href="${SITE}/uploads/x.jpg">&#8203;</a>` &&
    (coverPreviewLink(`${SITE}/uploads/x" onmouseover="a`).match(/"/g) ?? []).length === 2,
  coverPreviewLink(`${SITE}/uploads/x.jpg`),
);

check(
  "Пост: без рубрики хештег не добавляется",
  !buildMessengerPost({
    title: "T",
    contentHtml: "<p>тело</p>",
    slug: "t",
    siteUrl: SITE,
  }).text.includes("#"),
  "без висячего тега",
);

check(
  "Пост: завершающий слэш в SITE не даёт двойного",
  buildMessengerPost({ title: "T", contentHtml: "x", slug: "s", siteUrl: `${SITE}///` }).url ===
    `${SITE}/news/s`,
  "один слэш",
);

check(
  "Пост: теги внутри заголовка экранируются",
  buildMessengerPost({
    title: "ВК <b>и</b> Telegram",
    contentHtml: "<p>тело</p>",
    slug: "s",
    siteUrl: SITE,
  }).text.includes("&lt;b&gt;и&lt;/b&gt;"),
  "экранировано",
);

check(
  "Пост: пустое тело не оставляет двойных переносов",
  !buildMessengerPost({ title: "T", contentHtml: "", slug: "s", siteUrl: SITE }).text.includes(
    "\n\n\n",
  ),
  "без пустых блоков",
);

// --- the dangling "Читайте также:" -------------------------------------------

/*
  The phrase the editor reported. It reaches a messenger as a promise with nothing behind it,
  because the link does not survive the conversion to text: `<a href="/news/x">Заголовок</a>`
  becomes the bare words «Заголовок», and the line reads as a pointer to a story the reader
  cannot click.

  Measured on the live body: the article about the pickpockets ends with exactly this shape, and
  the channel post carried «Читайте также: Задержали подозреваемого в убийстве…» as a plain
  line. On the site the same paragraph is fine — it keeps its link — which is why this is a
  messenger-side rule and not a body rewrite.
*/
const withKicker = buildMessengerPost({
  title: "Новость",
  contentHtml:
    '<p>Первый абзац с содержанием.</p><p>Читайте также: <a href="https://eartnews.ru/news/drugoe">Другая новость про событие</a></p>',
  slug: "s-kickerom",
  siteUrl: SITE,
});

check(
  "Мессенджер: строка «Читайте также: <ссылка>» вырезана целиком",
  !withKicker.text.includes("Читайте также") &&
    !withKicker.text.includes("Другая новость про событие") &&
    withKicker.text.includes("Первый абзац с содержанием.") &&
    withKicker.text.includes(`${SITE}/news/s-kickerom`),
  JSON.stringify(withKicker.text.slice(0, 140)),
);

const danglingKicker = buildMessengerPost({
  title: "Новость",
  contentHtml: "<p>Первый абзац.</p><p>Читайте также:</p><p>Второй абзац.</p>",
  slug: "visyachiy",
  siteUrl: SITE,
});

check(
  "Мессенджер: одинокое «Читайте также:» вырезано, соседние абзацы целы",
  !danglingKicker.text.includes("Читайте также") &&
    danglingKicker.text.includes("Первый абзац.") &&
    danglingKicker.text.includes("Второй абзац."),
  JSON.stringify(danglingKicker.text),
);

/*
  The shape that must NOT be cut. This one is a real body on the live site, and the phrase
  introduces a sentence of the article's own rather than a pointer out of it — deleting it
  would delete content. The colon is what tells the two apart.
*/
const proseKicker =
  "<p>От удара мишка оставил вмятину.</p><p>Прочитайте также, как медведь наведался в посёлок Кедровка под Березовский. А под Краснотурьинском ликвидировали медведя.</p>";
const prosePostText = buildMessengerPost({
  title: "Новость",
  contentHtml: proseKicker,
  slug: "proza",
  siteUrl: SITE,
}).text;

check(
  "Мессенджер: фраза, продолжающаяся прозой, остаётся",
  prosePostText.includes("Прочитайте также, как медведь наведался") &&
    prosePostText.includes("А под Краснотурьинском ликвидировали медведя"),
  JSON.stringify(prosePostText.slice(0, 120)),
);

/*
  Указатель «Читайте также» вырезается, и остаётся ровно одна ссылка — наша.

  Проверка раньше смотрела на весь текст поста и искала в нём `<a`, чего быть не должно было:
  в теле ссылки должны стать текстом. Теперь в посте есть наш собственный `<a href>` в подвале,
  поэтому «нет ни одной ссылки» больше не верное утверждение — верное: в теле поста нет ссылок
  инструкции, а живая ссылка ровно одна.
*/
const POINTER_PHRASES = [
  "Читайте также",
  "Читать также",
  "Читать далее",
  "Смотрите также",
  "Почитайте также",
];

check(
  "Мессенджер: указатель вырезается, а живая ссылка в посте ровно одна",
  POINTER_PHRASES.every((phrase) => {
    const post = buildMessengerPost({
      title: "T",
      contentHtml: `<p>Текст.</p><p>${phrase}: <a href="/news/x">Материал</a></p>`,
      slug: "s",
      siteUrl: SITE,
    });
    return (
      !post.text.includes(phrase) &&
      !post.text.includes("Материал") &&
      (post.text.match(/<a href/g) ?? []).length === 1
    );
  }) &&
    ["Читайте также", "Читать далее"].every(
      (phrase) =>
        !stripKickerLines(`Абзац.\n\n${phrase}\n\nЕщё абзац`).includes(phrase),
    ),
  `фраз: ${POINTER_PHRASES.length}, все распознаны`,
);

check(
  "Мессенджер: обычный текст со словами «а также» не трогается",
  stripKickerLines("Точные обстоятельства, а также состояние водителя установят.") ===
    "Точные обстоятельства, а также состояние водителя установят." &&
    stripKickerLines("") === "",
  "не тронуто",
);

// --- the 1024 caption boundary ------------------------------------------------

/*
  The headline case: a post that fits in a caption arrives as ONE message — a photo with the
  whole post as its caption.
*/
const shortPost = buildMessengerPost({
  title: "Короткая новость",
  contentHtml: `<p>${paragraph(300)}</p>`,
  slug: "korotkaya",
  categoryName: "Технологии",
  siteUrl: SITE,
});

const shortPlan = planTelegramPost(shortPost, { hasCover: true });

const shortCaptionOfPhoto =
  shortPlan.steps[0]?.kind === "photo" ? (shortPlan.steps[0].caption ?? "") : "";

check(
  "Telegram: до 1024 — одно сообщение, весь пост подписью к фото",
  shortPlan.mode === "caption" &&
    shortPlan.steps.length === 1 &&
    shortPlan.steps[0]?.kind === "photo" &&
    shortCaptionOfPhoto === shortPost.text,
  `${shortPlan.mode}, ${shortPlan.length} символов, шагов: ${shortPlan.steps.length}`,
);

check(
  "Telegram: ровно 1024 — ещё подпись",
  planTelegramPost(
    barePost(paragraph(TELEGRAM_CAPTION_LIMIT), `${SITE}/news/s`),
    { hasCover: true },
  ).mode === "caption",
  "граница включительно",
);

/*
  Past the caption ceiling the post goes out as ONE message with the cover as a link preview —
  never as a picture followed by a wall of text.
*/
const mediumPost = buildMessengerPost({
  title: "Средняя новость",
  contentHtml: `<p>${paragraph(2500)}</p>`,
  slug: "srednyaya",
  categoryName: "Общество",
  siteUrl: SITE,
});
const mediumPlan = planTelegramPost(mediumPost, { hasCover: true, coverUrl: `${SITE}/uploads/cover.jpg` });
const mediumText =
  mediumPlan.steps[0]?.kind === "text" ? mediumPlan.steps[0].text : "";

check(
  "Telegram: 1025 — одно сообщение с предпросмотром обложки, а не двумя постами",
  planTelegramPost(
    barePost(paragraph(TELEGRAM_CAPTION_LIMIT + 1), `${SITE}/news/s`),
    { hasCover: true, coverUrl: `${SITE}/uploads/c.jpg` },
  ).mode === "preview",
  "один символ через границу",
);

check(
  "Telegram: длинный пост — одно сообщение, текст целиком",
  mediumPlan.mode === "preview" &&
    mediumPlan.steps.length === 1 &&
    mediumPlan.steps[0]?.kind === "text" &&
    mediumText === mediumPost.text,
  `${mediumPlan.mode}, ${mediumPlan.steps.length} шагов`,
);

check(
  "Telegram: у текстового шага с обложкой есть адрес для предпросмотра",
  mediumPlan.steps[0]?.kind === "text" && mediumPlan.steps[0].previewUrl === `${SITE}/uploads/cover.jpg`,
  mediumPlan.steps[0]?.kind === "text" ? (mediumPlan.steps[0].previewUrl ?? "нет") : "не текст",
);

/*
  Без обложки текстовый шаг не должен тащить предпросмотр: иначе Telegram покажет карточку
  кредитной ссылки в подвале поста.
*/
check(
  "Telegram: без обложки у текстового шага нет предпросмотра",
  (() => {
    const plan = planTelegramPost(mediumPost, { hasCover: false });
    const step = plan.steps[0];
    return step?.kind === "text" && step.previewUrl === null;
  })(),
  "previewUrl = null",
);

check(
  "Telegram: короткий пост по-прежнему одной подписью к фото",
  planTelegramPost(
    buildMessengerPost({ title: "Короткая", contentHtml: `<p>${paragraph(200)}</p>`, slug: "kor", siteUrl: SITE }),
    { hasCover: true, coverUrl: `${SITE}/uploads/k.jpg` },
  ).mode === "caption",
  "одно сообщение, пока влезает",
);

check(
  "Telegram: длинный пост отдаётся целиком, а не обрезком",
  !mediumPlan.truncated &&
    mediumPlan.length === mediumPost.text.length,
  `${mediumPlan.mode}, исходных ${mediumPlan.length}`,
);

// --- too long for one message: the teaser -------------------------------------

const longText = buildMessengerPost({
  title: "Расследование",
  contentHtml: `<p>${bodyOfLength(9000)}</p>`,
  slug: "rassledovanie",
  categoryName: "Происшествия",
  siteUrl: SITE,
});

const longPlan = planTelegramPost(longText, { hasCover: true, coverUrl: `${SITE}/uploads/long.jpg` });

check(
  "Telegram: 9000 символов — один пост-обрез с предпросмотром, а не простыня",
  longPlan.mode === "truncated" &&
    longPlan.truncated &&
    longPlan.steps.length === 1 &&
    longPlan.steps[0]?.kind === "text" &&
    longPlan.steps[0].previewUrl === `${SITE}/uploads/long.jpg`,
  `${longPlan.mode}, шагов ${longPlan.steps.length}, исходных ${longPlan.length}`,
);

const noCoverHuge = planTelegramPost(barePost(paragraph(17000), `${SITE}/news/s`), { hasCover: false });

check(
  "Telegram: очень длинный текст без обложки обрезается",
  noCoverHuge.mode === "truncated" &&
    noCoverHuge.truncated &&
    noCoverHuge.steps.length === 1,
  `${noCoverHuge.mode}, исходных ${noCoverHuge.length}, шагов ${noCoverHuge.steps.length}`,
);

const cutText = noCoverHuge.steps[0]?.kind === "text" ? noCoverHuge.steps[0].text : "";

check(
  "Telegram: обрез заканчивается приглашением прочитать на сайте",
  cutText.endsWith(readingNotice(`${SITE}/news/s`)),
  cutText.slice(-70),
);

check(
  "Telegram: в обрезанном посте остаётся много текста, а не огрызок",
  cutText.length > LONG_READING_BODY_LIMIT * 0.9,
  `${cutText.length} >= ~${Math.round(LONG_READING_BODY_LIMIT * 0.9)}`,
);

check(
  "Telegram: многоточие стоит перед приглашением",
  cutText.includes("\n\n...\n\n"),
  "стандартный обрез",
);

check(
  "Telegram: обрез одного гигантского абзаца не даёт пустой пост",
  cutForReading(barePost(paragraph(9000), `${SITE}/news/s`)).length > 3000,
  "обрезан по символам, но не в ноль",
);

// --- no cover -----------------------------------------------------------------

check(
  "Telegram: без обложки короткий пост идёт текстом, а не пустым фото",
  planTelegramPost(shortPost, { hasCover: false }).mode === "text-only" &&
    planTelegramPost(shortPost, { hasCover: false }).steps.length === 1 &&
    planTelegramPost(shortPost, { hasCover: false }).steps[0]?.kind === "text",
  "нет шага с фото",
);

check(
  "Telegram: без обложки текст до 4096 — одно сообщение целиком",
  (() => {
    const plan = planTelegramPost(barePost(paragraph(2500), "u"), { hasCover: false });
    const step = plan.steps[0];
    return plan.mode === "text-only" && plan.steps.length === 1 &&
      step?.kind === "text" && step.text.length === plan.length;
  })(),
  "text-only, один шаг",
);

check(
  "Telegram: без обложки текст свыше 4096 — один пост-обрез",
  (() => {
    const plan = planTelegramPost(barePost(paragraph(9000), `${SITE}/news/s`), { hasCover: false });
    const step = plan.steps[0];
    return plan.mode === "truncated" && plan.steps.length === 1 &&
      step?.kind === "text" && step.text.length <= TELEGRAM_MESSAGE_LIMIT;
  })(),
  "truncated, один шаг в лимите",
);

// --- MAX ----------------------------------------------------------------------

const maxSimple = planMaxPost(simplePost, { hasCover: true });
check(
  "MAX: короткий пост целиком, одним сообщением, с вложением",
  maxSimple.chunks.length === 1 &&
    maxSimple.chunks[0] === simplePost.text &&
    maxSimple.attachCover,
  `${maxSimple.chunks.length} сообщение(й), ${maxSimple.chunks[0]?.length ?? 0} символов`,
);

check(
  "MAX: без обложки вложение не запрашивается",
  !planMaxPost(simplePost, { hasCover: false }).attachCover,
  "attachCover выключен",
);

check(
  "MAX: ровно 4000 — ещё целиком",
  planMaxPost(barePost(paragraph(MAX_MESSAGE_LIMIT), "u")).chunks.length === 1,
  "граница включительно",
);

/*
  Past the limit the article is **continued**, not cut to a teaser.

  This is the difference the brief is about: MAX takes the whole story, and a story longer
  than one message becomes several messages rather than an announcement. Telegram's planner
  cuts, because a caption has nowhere to put the rest; MAX's has no such constraint.
*/
const maxLong = planMaxPost(barePost(paragraph(MAX_MESSAGE_LIMIT + 1), `${SITE}/news/s`));
check(
  "MAX: 4001 — уже два сообщения, а не анонс",
  maxLong.chunks.length === 2 &&
    maxLong.chunks.every((chunk) => chunk.length <= MAX_MESSAGE_LIMIT),
  `${maxLong.chunks.length} сообщения, длины ${maxLong.chunks.map((c) => c.length).join(", ")}`,
);

/*
  Compared without whitespace, and that is the honest form of "nothing is lost".

  A cut at a paragraph boundary drops the `\n\n` that separated the two paragraphs: the
  second message does not open with a blank line, and a reader sees two messages rather than
  one text with a gap in it. Every character of content — every word, in order — survives, and
  that is what this asserts.
*/
const withoutWhitespace = (value: string) => value.replace(/\s+/g, "");

check(
  "MAX: ни одно слово не потеряно — куски дают исходный текст",
  withoutWhitespace(maxLong.chunks.join("")) === withoutWhitespace(paragraph(MAX_MESSAGE_LIMIT + 1)),
  `${maxLong.chunks.join("").length} против ${MAX_MESSAGE_LIMIT + 1}`,
);

check(
  "MAX: куски режутся по абзацам, а не по символам",
  (() => {
    const body = Array.from({ length: 12 }, (_, i) => `<p>${paragraph(700, "абвг"[i % 4]!)}</p>`).join("");
    const post = buildMessengerPost({
      title: "Длинный",
      contentHtml: body,
      slug: "dlinnyy",
      categoryName: "Общество",
      siteUrl: SITE,
    });
    const chunks = planMaxPost(post).chunks;
    // Every chunk but the last has to end where a paragraph ended, which is what makes the
    // continuation read as the article continuing rather than as a message cut off.
    return (
      chunks.length > 1 &&
      chunks.slice(0, -1).every((chunk) => chunk.split("\n\n").length > 1)
    );
  })(),
  "границы по абзацам",
);

check(
  "MAX: одна строка текста не разделена, в отличие от Telegram",
  planMaxPost(barePost(paragraph(2500), "u")).chunks.length === 1,
  "одним сообщением до 4000",
);

check(
  "MAX: абзац длиннее сообщения режется, но не исчезает",
  (() => {
    const post = barePost(paragraph(9000), `${SITE}/news/s`);
    const chunks = planMaxPost(post).chunks;
    return (
      chunks.length > 1 &&
      chunks.every((chunk) => chunk.length <= MAX_MESSAGE_LIMIT) &&
      chunks.join("") === post.text
    );
  })(),
  "длинный абзац разложен по сообщениям",
);

// --- quotations and pictures in a post ----------------------------------------

/*
  A quotation has to be recognisable as one.

  The body is escaped into plain text before it is sent, so the `<blockquote>` element
  is gone by then, and Telegram and MAX do not accept the same set of tags — sending a
  tag one of them rejects loses the whole message. A character prefix is understood by
  both, survives being forwarded, and costs one glyph.
*/
const quotedText = htmlToPlainText(
  "<blockquote><p>Это цитата.</p><p><cite>— Иван Петров</cite></p></blockquote>",
);

check(
  "Цитата: текст открывается знаком цитаты",
  quotedText.startsWith(MESSENGER_QUOTE_PREFIX.trim()),
  JSON.stringify(quotedText),
);

check(
  "Цитата: каждый абзац цитаты помечен",
  htmlToPlainText("<blockquote><p>Первый.</p><p>Второй.</p></blockquote>")
    .split("\n\n")
    .every((line) => line.startsWith(MESSENGER_QUOTE_PREFIX.trim())),
  JSON.stringify(htmlToPlainText("<blockquote><p>Первый.</p><p>Второй.</p></blockquote>")),
);

check(
  "Цитата: источник не получает знак цитаты",
  quotedText.includes("— Иван Петров") &&
    !quotedText.includes(`${MESSENGER_QUOTE_PREFIX.trim()} — Иван Петров`),
  JSON.stringify(quotedText),
);

check(
  "Цитата: текст, не являющийся цитатой, знака не получает",
  !htmlToPlainText("<p>Обычный абзац.</p>").includes(MESSENGER_QUOTE_PREFIX.trim()),
  JSON.stringify(htmlToPlainText("<p>Обычный абзац.</p>")),
);

/*
  A picture inside the body must not take the post down, and must not spend characters
  on markup the messenger would reject. The caption stays because it is text the writer
  wrote; the image itself has nowhere to go in a text message and is dropped softly.
*/
const withFigure = htmlToPlainText(
  `<p>До фото.</p><figure class="article-figure"><img src="/uploads/a.webp" alt="Описание"><figcaption>Подпись к фото</figcaption></figure><p>После фото.</p>`,
);

check(
  "Картинка в тексте: тег не попадает в текст сообщения",
  !/<img|<figure|<figcaption/i.test(withFigure),
  JSON.stringify(withFigure),
);

check(
  "Картинка в тексте: подпись сохраняется",
  withFigure.includes("Подпись к фото"),
  JSON.stringify(withFigure),
);

check(
  "Картинка в тексте: порядок текста не нарушен",
  withFigure.indexOf("До фото") < withFigure.indexOf("Подпись к фото") &&
    withFigure.indexOf("Подпись к фото") < withFigure.indexOf("После фото"),
  JSON.stringify(withFigure),
);

check(
  "Картинка в тексте: alt-текст не подставляется вместо отсутствующей подписи",
  !htmlToPlainText(
    `<p>Текст.</p><figure class="article-figure"><img src="/uploads/a.webp" alt="Служебное описание"></figure>`,
  ).includes("Служебное описание"),
  JSON.stringify(
    htmlToPlainText(
      `<p>Текст.</p><figure class="article-figure"><img src="/uploads/a.webp" alt="Служебное описание"></figure>`,
    ),
  ),
);

check(
  "Картинка в абзаце не разрывает предложение пробелом-артефактом",
  htmlToPlainText(`<p>до <img src="/uploads/a.webp" alt="a"> после</p>`) === "до после",
  JSON.stringify(htmlToPlainText(`<p>до <img src="/uploads/a.webp" alt="a"> после</p>`)),
);

/*
  The whole post, with both, and the length boundary still respected: a quotation adds
  a character per paragraph, and the cut has to keep landing under the ceiling.
*/
const postWithQuoteAndFigure = buildMessengerPost({
  title: "Заголовок",
  contentHtml: `<p>Первый абзац.</p><figure class="article-figure"><img src="/uploads/a.webp" alt="x"><figcaption>Подпись</figcaption></figure><blockquote><p>Цитата.</p><p><cite>— Источник</cite></p></blockquote><p>Последний абзац.</p>`,
  slug: "s",
  categoryName: "Общество",
  siteUrl: SITE,
});

check(
  "Пост: цитата и подпись доходят до текста сообщения",
  postWithQuoteAndFigure.text.includes(MESSENGER_QUOTE_PREFIX.trim()) &&
    postWithQuoteAndFigure.text.includes("Подпись") &&
    postWithQuoteAndFigure.text.includes("— Источник"),
  postWithQuoteAndFigure.text.slice(0, 220),
);

check(
  "Пост: разметка редактора не просачивается в сообщение",
  !/<figure|<img|<figcaption|<blockquote|<cite/i.test(postWithQuoteAndFigure.text),
  "только <b> у заголовка",
);

check(
  "Пост: каждое сообщение MAX остаётся под лимитом",
  planMaxPost(barePost(postWithQuoteAndFigure.text.repeat(20), `${SITE}/news/s`)).chunks.every(
    (chunk) => chunk.length <= MAX_MESSAGE_LIMIT,
  ),
  planMaxPost(barePost(postWithQuoteAndFigure.text.repeat(20), "u"))
    .chunks.map((chunk) => chunk.length)
    .join(", ") + ` <= ${MAX_MESSAGE_LIMIT}`,
);

// --- the actual Bot API calls, with `fetch` stubbed ---------------------------

/*
  The planning tests above prove the shape of the plan; these prove the shape of the
  requests. They exist because the failure that reached production was not in the plan
  at all — the plan said "photo with a caption", and what an editor saw was a photo
  without one and no text — and a suite that only looks at the plan cannot see that.

  `fetch` is replaced for the duration: the cover URL is answered with a few bytes and
  the two Bot API methods are recorded instead of sent. Restored in `finally`, because
  the proxy tests further down need the real one.
*/
const COVER_URL = "https://covers.example.com/c.jpg";

type RecordedCall = {
  method: string;
  form: FormData | null;
  json: Record<string, unknown> | null;
};

const calls: RecordedCall[] = [];
const realFetch = globalThis.fetch;

/** Answers a cover fetch, or records a Bot API call and answers `ok: true`. */
function stubTelegramFetch(messageId: number) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url === COVER_URL) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }

    const method = /\/bot[^/]+\/(sendPhoto|sendMessage)/.exec(url)?.[1] ?? "unknown";
    if (method === "sendPhoto") {
      calls.push({ method, form: init?.body as FormData, json: null });
    } else if (method === "sendMessage") {
      calls.push({
        method,
        form: null,
        json: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
    } else {
      throw new Error(`unexpected fetch: ${url}`);
    }

    return new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

delete process.env.TELEGRAM_PROXY;
globalThis.fetch = stubTelegramFetch(701);

/*
  The publisher builds its links from `siteUrl()`, which reads this variable; the
  expected posts below are built against `SITE`. Without pinning it, the test would
  compare a `localhost` post against an `eartnews.ru` one and fail on a difference that
  has nothing to do with the bug under test.
*/
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
process.env.NEXT_PUBLIC_SITE_URL = SITE;

setTelegramConfigSource(async () => ({
  token: "123456:AAHtest",
  channelId: "@eartnews",
  enabled: true,
  apiRoot: "",
}));

/** What `buildMessengerPost` produces for an article, without going through the publisher. */
function expectedPost(article: {
  title: string;
  contentHtml: string;
  slug: string;
  categoryName: string | null;
}) {
  return buildMessengerPost({ ...article, siteUrl: SITE });
}

try {
  // 1. A short post: the whole post rides in the photo caption. */
  calls.length = 0;
  const shortArticle = {
    title: "Короткая новость",
    contentHtml: `<p>${paragraph(300)}</p>`,
    slug: "korotkaya",
    categoryName: "Технологии",
    coverImage: COVER_URL,
  };
  const shortResult = await publishArticleToTelegram(shortArticle);

  check(
    "Мок: короткий пост — один запрос sendPhoto, весь пост подписью",
    shortResult.ok &&
      calls.length === 1 &&
      calls[0]?.method === "sendPhoto" &&
      (calls[0]?.form?.get("caption") as string | null) === expectedPost(shortArticle).text,
    `${calls.length} запрос(ов): ${calls.map((call) => call.method).join(", ")}`,
  );

  check(
    "Мок: подпись уходит с parse_mode HTML в нужный чат",
    calls[0]?.form?.get("parse_mode") === "HTML" &&
      calls[0]?.form?.get("chat_id") === "@eartnews",
    `${calls[0]?.form?.get("parse_mode")} / ${calls[0]?.form?.get("chat_id")}`,
  );

  // 2. A long post: ONE sendMessage with the cover as a link preview — no second message.
  calls.length = 0;
  const longArticle = {
    title: "Длинная новость",
    contentHtml: `<p>${paragraph(3000)}</p>`,
    slug: "dlinnaia",
    categoryName: "Общество",
    coverImage: COVER_URL,
  };
  const longResult = await publishArticleToTelegram(longArticle);
  const longJson = calls[0]?.json ?? {};

  check(
    "Мок: длинный пост — одно сообщение, а не обложка + простыня",
    longResult.ok &&
      calls.length === 1 &&
      calls[0]?.method === "sendMessage",
    `${calls.length} запрос(ов): ${calls.map((call) => call.method).join(", ")}`,
  );

  check(
    "Мок: длинный пост несёт невидимую ссылку на обложку первой",
    String(longJson.text ?? "").startsWith(`<a href="${COVER_URL}">&#8203;</a>`),
    JSON.stringify(String(longJson.text ?? "").slice(0, 80)),
  );

  check(
    "Мок: предпросмотр включён: крупное фото сверху над текстом",
    (longJson.link_preview_options as Record<string, unknown> | undefined)?.is_disabled === false &&
      (longJson.link_preview_options as Record<string, unknown> | undefined)?.prefer_large_media === true &&
      (longJson.link_preview_options as Record<string, unknown> | undefined)?.show_above_text === true &&
      longJson.disable_web_page_preview === undefined,
    JSON.stringify(longJson.link_preview_options),
  );

  check(
    "Мок: текст целиком идёт после невидимой ссылки",
    String(longJson.text ?? "").endsWith(expectedPost(longArticle).text),
    `${String(longJson.text ?? "").length} против ${expectedPost(longArticle).text.length}`,
  );

  check(
    "Мок: текстовое сообщение несёт ссылку-словами",
    String(longJson.text ?? "").includes(`<a href="${SITE}/news/dlinnaia">`),
    JSON.stringify(String(longJson.text ?? "").slice(-70)),
  );

  check(
    "Мок: сообщение идёт с parse_mode HTML",
    longJson.parse_mode === "HTML",
    String(longJson.parse_mode),
  );

  // 3. The escaping, end to end: no cover, one plain message.
  calls.length = 0;
  const trickyArticle = {
    title: "Сравнение",
    contentHtml: "<p>По данным, 5 &lt; 6 и «А &amp; Б», а &lt;b&gt;это не жирный&lt;/b&gt;.</p>",
    slug: "sravnenie",
    categoryName: null,
    coverImage: null as string | null,
  };
  const trickyResult = await publishArticleToTelegram(trickyArticle);
  const trickyText = String(calls[0]?.json?.text ?? "");

  check(
    "Мок: тело с < и & экранируется перед отправкой",
    trickyResult.ok &&
      trickyText.includes("5 &lt; 6") &&
      trickyText.includes("А &amp; Б") &&
      trickyText.includes("&lt;b&gt;это не жирный&lt;/b&gt;"),
    trickyText.slice(0, 90),
  );

  check(
    "Мок: живые теги только те, что мы ставим сами: <b> и <a href>",
    (() => {
      const tags = trickyText.match(/<[^>]*>/g) ?? [];
      const allowed = new Set(["<b>", "</b>", `<a href="${SITE}/news/sravnenie">`, "</a>"]);
      return tags.length > 0 && tags.every((tag) => allowed.has(tag));
    })(),
    JSON.stringify(trickyText.match(/<[^>]*>/g) ?? []),
  );

  // 4. Telegram refuses the picture on a short post. The whole text was in the caption, so the
  //    story must still reach the channel as a plain message — the VK degradation.
  calls.length = 0;
  const realWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(" "));
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === COVER_URL) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    if (/\/sendPhoto$/.test(url)) {
      calls.push({ method: "sendPhoto", form: init?.body as FormData, json: null });
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 400,
          description: "Bad Request: PHOTO_INVALID_DIMENSIONS",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    calls.push({
      method: "sendMessage",
      form: null,
      json: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 704 } }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const coverRejected = await publishArticleToTelegram(shortArticle);
  console.warn = realWarn;

  check(
    "Мок: отказанное фото не теряет публикацию — текст уходит следом",
    coverRejected.ok === true &&
      calls.some((call) => call.method === "sendPhoto") &&
      calls.some((call) => call.method === "sendMessage") &&
      typeof coverRejected.warning === "string",
    `${calls.map((call) => call.method).join(", ")} / warning: ${coverRejected.warning ?? "нет"}`,
  );

  check(
    "Мок: отказ Telegram попадает в лог PM2 методом и описанием",
    warnings.some((line) => line.includes("sendPhoto") && line.includes("PHOTO_INVALID_DIMENSIONS")),
    warnings.find((line) => line.includes("PHOTO_INVALID_DIMENSIONS"))?.slice(0, 140) ?? "нет строки",
  );

  // 5. Everything refused: the result is an error carrying Telegram's own description.
  const allWarnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    allWarnings.push(args.map((value) => String(value)).join(" "));
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === COVER_URL) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    return new Response(
      JSON.stringify({
        ok: false,
        error_code: 400,
        description: "Bad Request: can't parse entities: Unexpected end tag at byte offset 5",
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  const rejected = await publishArticleToTelegram(longArticle);
  console.warn = realWarn;

  check(
    "Мок: полный отказ возвращается как ошибка, а не как успех",
    rejected.ok === false && (rejected.error ?? "").includes("can't parse entities"),
    rejected.error ?? "",
  );

  check(
    "Мок: причина отказа в логе названа вместе с методом",
    allWarnings.some((line) => line.includes("can't parse entities")),
    allWarnings.find((line) => line.includes("can't parse entities"))?.slice(0, 140) ?? "нет строки",
  );

  /*
    6. Лимит площадки (429) на сообщении — лечится повтором. Пауза подменяется, чтобы проверка
    не спала полсекунды на ровном месте.
  */
  calls.length = 0;
  let textAttempts = 0;
  setSyndicationSleep(async () => {});

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === COVER_URL) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    textAttempts += 1;
    calls.push({
      method: "sendMessage",
      form: null,
      json: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    if (textAttempts === 1) {
      return new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 1",
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 709 } }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const rateLimited = await publishArticleToTelegram(longArticle);

  check(
    "Мок: 429 на сообщении лечится повтором, публикация доходит",
    rateLimited.ok === true && textAttempts === 2,
    `ok=${rateLimited.ok}, попыток текста: ${textAttempts}`,
  );

  resetSyndicationSleep();
} finally {
  globalThis.fetch = realFetch;
  resetTelegramConfigSource();
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
}

// --- the MAX API calls, with `fetch` stubbed ---------------------------------

/*
  The MAX half of the same idea: the planner can be right while the requests are not, and the
  three failures this guards are all failures of the request, not of the plan — a cover that
  never reaches the message, an attachment token sent with every chunk instead of with the
  first, and a rollback that leaves half an article in a channel.

  The upload is two calls on the platform: a one-shot URL from `/uploads?type=image`, then the
  bytes to that URL. Both are answered here, and the second returns the token the message
  attaches by.
*/
const MAX_UPLOAD_URL = "https://upload.example.com/u/1";

type MaxCall = {
  kind: "ticket" | "upload" | "message" | "delete";
  json: Record<string, unknown> | null;
  form: FormData | null;
  at: number;
};

const maxCalls: MaxCall[] = [];

function stubMaxFetch(options: { failOnMessage?: number } = {}) {
  let messages = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();

    if (url === COVER_URL) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }

    const json = () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    if (url.includes("/uploads")) {
      maxCalls.push({ kind: "ticket", json: null, form: null, at: Date.now() });
      return new Response(JSON.stringify({ url: MAX_UPLOAD_URL, token: "ticket-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url === MAX_UPLOAD_URL) {
      maxCalls.push({ kind: "upload", json: null, form: init?.body as FormData, at: Date.now() });
      // The measured shape: the token is nested one level inside a numeric map, not top-level.
      return new Response(JSON.stringify({ photos: { "0": { token: "cover-token" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "DELETE") {
      maxCalls.push({ kind: "delete", json: null, form: null, at: Date.now() });
      return json();
    }

    if (url.includes("/messages")) {
      messages += 1;
      maxCalls.push({
        kind: "message",
        json: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        form: null,
        at: Date.now(),
      });

      if (options.failOnMessage === messages) {
        return new Response(
          JSON.stringify({ code: "attachment.not.ready", message: "not ready" }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({ message: { body: { mid: `mid-${messages}` } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

try {
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  setMaxConfigSource(async () => ({ token: "max-test-token", chatId: "-7000000001", enabled: true }));

  /** The messages that were posted, in order. */
  const postedMessages = () =>
    maxCalls.filter((call) => call.kind === "message").map((call) => call.json ?? {});

  // 1. A short article with a cover: one message, carrying both the text and the picture.
  maxCalls.length = 0;
  globalThis.fetch = stubMaxFetch();

  const maxShortArticle = {
    id: "probe-short",
    title: "Короткая новость",
    contentHtml: `<p>${paragraph(300)}</p>`,
    slug: "korotkaya",
    categoryName: "Технологии",
    coverImage: COVER_URL,
  };
  const maxShortResult = await publishArticleToMax(maxShortArticle);
  const shortMessage = postedMessages()[0] ?? {};
  const shortAttachments = shortMessage.attachments as
    | { type?: string; payload?: { token?: string } }[]
    | undefined;

  check(
    "Мок MAX: короткий пост — одно сообщение с полным текстом",
    maxShortResult.ok &&
      postedMessages().length === 1 &&
      shortMessage.text === buildMessengerPost({ ...maxShortArticle, siteUrl: SITE }).text,
    `${postedMessages().length} сообщение(й), ${String(shortMessage.text ?? "").length} символов`,
  );

  check(
    "Мок MAX: обложка едет вложением к тому же сообщению",
    shortMessage.attachments !== undefined &&
      shortAttachments?.[0]?.type === "image" &&
      shortAttachments?.[0]?.payload?.token === "cover-token",
    JSON.stringify(shortAttachments ?? null),
  );

  check(
    "Мок MAX: текст помечен как html и адресован каналу",
    shortMessage.format === "html",
    JSON.stringify(shortMessage.format),
  );

  check(
    "Мок MAX: ссылка в подвале — анкор, адрес не печатается",
    // То же, что в Telegram: MAX разбирает `format: "html"` и показывает `<a href>` ссылкой с
    // нашими словами. Адрес в теле сообщения больше не должен встречаться — иначе он снова
    // занимает три строки в MAX точно так же, как занимал в Telegram.
    /<a href="https:\/\/eartnews\.ru\/news\/[^"]+">Читать полностью на сайте<\/a>/.test(
      String(shortMessage.text ?? ""),
    ) &&
      !String(shortMessage.text ?? "")
        .replace(/<a href="[^"]*">/g, "")
        .includes("eartnews.ru"),
    JSON.stringify(String(shortMessage.text ?? "").slice(-70)),
  );

  check(
    "Мок MAX: id сообщения возвращается и запоминается",
    maxShortResult.messageId === "mid-1" &&
      maxShortResult.messageIds?.join(",") === "mid-1",
    JSON.stringify(maxShortResult.messageIds ?? null),
  );

  // 2. A long article: several messages, the picture on the first only.
  maxCalls.length = 0;
  globalThis.fetch = stubMaxFetch();

  const maxLongArticle = {
    id: "probe-long",
    title: "Длинная новость",
    contentHtml: `<p>${bodyOfLength(9000)}</p>`,
    slug: "dlinnaia",
    categoryName: "Общество",
    coverImage: COVER_URL,
  };
  const maxLongResult = await publishArticleToMax(maxLongArticle);
  const longMessages = postedMessages();
  const longText = buildMessengerPost({ ...maxLongArticle, siteUrl: SITE }).text;

  check(
    "Мок MAX: длинный пост уходит несколькими сообщениями",
    maxLongResult.ok && longMessages.length > 1,
    `${longMessages.length} сообщений`,
  );

  check(
    "Мок MAX: вместе сообщения дают весь текст без потерь",
    withoutWhitespace(longMessages.map((message) => String(message.text ?? "")).join("")) ===
      withoutWhitespace(longText),
    `${longMessages.map((m) => String(m.text ?? "").length).join("+")} против ${longText.length}`,
  );

  check(
    "Мок MAX: обложка прикреплена только к первому сообщению",
    longMessages[0]?.attachments !== undefined &&
      longMessages.slice(1).every((message) => message.attachments === undefined),
    `вложений по сообщениям: ${longMessages.map((m) => (m.attachments ? 1 : 0)).join(",")}`,
  );

  check(
    "Мок MAX: ссылка на источник и рубрика в последнем сообщении",
    String(longMessages.at(-1)?.text ?? "").includes(`${SITE}/news/dlinnaia`) &&
      String(longMessages.at(-1)?.text ?? "").includes("#Общество"),
    JSON.stringify(String(longMessages.at(-1)?.text ?? "").slice(-70)),
  );

  const messageTimes = maxCalls.filter((call) => call.kind === "message").map((call) => call.at);
  check(
    "Мок MAX: сообщения разведены по времени — не чаще двух в секунду",
    messageTimes.length > 1 && messageTimes.slice(1).every((at, i) => at - (messageTimes[i] ?? 0) >= 600),
    messageTimes.map((at, i) => (i === 0 ? 0 : at - (messageTimes[i - 1] ?? 0))).join(", ") + " мс",
  );

  // 3. A failure in the middle: nothing is left half-published.
  maxCalls.length = 0;
  globalThis.fetch = stubMaxFetch({ failOnMessage: 2 });
  const maxBrokenResult = await publishArticleToMax(maxLongArticle);

  check(
    "Мок MAX: обрыв на середине — публикация не считается удавшейся",
    maxBrokenResult.ok === false && (maxBrokenResult.error ?? "").includes("not ready"),
    maxBrokenResult.error ?? "",
  );

  check(
    "Мок MAX: уже отправленное удаляется, а не остаётся половиной статьи",
    maxCalls.filter((call) => call.kind === "delete").length === 1 &&
      maxCalls.find((call) => call.kind === "delete") !== undefined,
    `удалений: ${maxCalls.filter((call) => call.kind === "delete").length}`,
  );

  // 4. No cover: one text message and no upload at all.
  maxCalls.length = 0;
  globalThis.fetch = stubMaxFetch();
  const maxNoCover = await publishArticleToMax({ ...maxShortArticle, coverImage: null });

  check(
    "Мок MAX: без обложки загрузки нет, а сообщение уходит",
    maxNoCover.ok &&
      maxCalls.every((call) => call.kind === "message") &&
      postedMessages()[0]?.attachments === undefined,
    `вызовов: ${maxCalls.map((call) => call.kind).join(", ")}`,
  );

  /*
    The token's real shape, measured against the live endpoint.

    `/uploads` answers `{url}` and the upload answers `{"photos":{"0":{"token":"…"}}}`. The
    first version read a top-level `token` and found none, so the cover was dropped from every
    post while the log blamed MAX — which is why the shapes are asserted rather than assumed.
  */
  check(
    "MAX: токен обложки читается из измеренной формы ответа",
    readMaxUploadToken({ photos: { "0": { token: "tok-nested" } } }) === "tok-nested" &&
      readMaxUploadToken({ token: "tok-flat" }) === "tok-flat" &&
      readMaxUploadToken({ photos: {} }) === null &&
      readMaxUploadToken({ url: "https://iu.oneme.ru/x" }) === null &&
      readMaxUploadToken(null) === null &&
      readMaxUploadToken("строка") === null,
    JSON.stringify(readMaxUploadToken({ photos: { "0": { token: "tok-nested" } } })),
  );

  check(
    "MAX: вложенный токен доезжает до сообщения как вложение",
    // The stub answers with the measured nested shape, so the attachment can only be built if
    // the token is read out of it — the check above would fail on a regression to a flat read.
    maxLongResult.ok === true,
    "обложка читается из вложенного ответа",
  );
} finally {
  globalThis.fetch = realFetch;
  resetMaxConfigSource();
}

// --- settings validation ------------------------------------------------------

const telegramToken = SYNDICATION_FIELDS.telegramBotToken;
const telegramChannel = SYNDICATION_FIELDS.telegramChannelId;
const telegramFlag = SYNDICATION_FIELDS.telegramEnabled;

check(
  "Проверка: нормальный токен принимается",
  validateSyndicationField(telegramToken, "123456789:AAHabcDEF-1234567890") === null,
  "BotFather-формат",
);

check(
  "Проверка: короткий токен отклоняется",
  (validateSyndicationField(telegramToken, "1234567") ?? "").includes("минимум"),
  "7 символов",
);

check(
  "Проверка: токен с пробелом отклоняется",
  (validateSyndicationField(telegramToken, "123456789 abcdef") ?? "").includes("пробелы"),
  "две части",
);

check(
  "Проверка: пустое значение — не ошибка, а команда очистить",
  validateSyndicationField(telegramToken, "") === null &&
    validateSyndicationField(telegramFlag, "") === null,
  "очистка разрешена для всех видов",
);

check(
  "Проверка: @юзернейм канала принимается",
  validateSyndicationField(telegramChannel, "@eartnews") === null,
  "@eartnews",
);

check(
  "Проверка: -100… принимается",
  validateSyndicationField(telegramChannel, "-1001234567890") === null,
  "-1001234567890",
);

check(
  "Проверка: голый числовой ID принимается",
  validateSyndicationField(telegramChannel, "1234567890") === null,
  "1234567890",
);

/*
  The negative that matters most here, and the reason `destination` is its own kind:
  the token charset rejects "@" and "-", so without a separate rule every channel
  reference Telegram actually uses would be refused.
*/
check(
  "Проверка: канал с кавычками отклоняется",
  (validateSyndicationField(telegramChannel, '@eart"news') ?? "").includes("Ожидается"),
  "инъекция в поле назначения",
);

check(
  "Проверка: @юзернейм не проходит валидатор токена",
  (validateSyndicationField(telegramToken, "@eartnews") ?? "").includes("недопустимые"),
  "именно поэтому у поля два вида проверки",
);

check(
  "Проверка: флаг принимает только true и false",
  validateSyndicationField(telegramFlag, "true") === null &&
    validateSyndicationField(telegramFlag, "false") === null &&
    (validateSyndicationField(telegramFlag, "да") ?? "") !== "",
  "только две константы",
);

// --- enabled flag -------------------------------------------------------------

/*
  The defaults are load-bearing in both directions. Telegram defaults on, because a
  channel that was set up should syndicate without a second checkbox; MAX defaults
  off, because it needs a verified business profile that most installs do not have.
  Getting either backwards silently stops publication.
*/
check(
  "Флаг: значение по умолчанию — Telegram включён, MAX выключен",
  DEFAULT_SYNDICATION_ENABLED.telegram === true && DEFAULT_SYNDICATION_ENABLED.max === false,
  `telegram=${DEFAULT_SYNDICATION_ENABLED.telegram}, max=${DEFAULT_SYNDICATION_ENABLED.max}`,
);

check(
  "Флаг: незаданное значение берёт запасной вариант",
  parseEnabled("", true) === true && parseEnabled("", false) === false,
  "пусто не значит «выключено»",
);

check(
  "Флаг: мусор в значении не превращается в «выключено» молча",
  parseEnabled("возможно", true) === true,
  "неизвестное значение -> запасной вариант",
);

check(
  "Флаг: явные значения читаются в обоих направлениях",
  parseEnabled("true", false) === true &&
    parseEnabled("false", true) === false &&
    parseEnabled("1", false) === true &&
    parseEnabled("0", true) === false,
  "true/false/1/0",
);

check(
  "Флаг: регистр и пробелы не мешают",
  parseEnabled("  TRUE  ", false) === true && parseEnabled(" False ", true) === false,
  "нормализовано",
);

// --- masking ------------------------------------------------------------------

/*
  The requirement is that a saved token comes back masked. Asserted through the same
  `toView` the routes build their responses with, so a change to the masking rule
  cannot pass here while the API still leaks a token.
*/
const savedToken = "123456789:AAHabcDEFghiJKLmnopQRStuVWXyz1234";
const tokenView = toView({ value: savedToken, source: "database" });

check(
  "Маскирование: сохранённый токен возвращается замаскированным",
  tokenView.isSet && tokenView.masked !== savedToken && tokenView.masked.includes("…"),
  tokenView.masked,
);

check(
  "Маскирование: середина токена не утекает",
  !tokenView.masked.includes("ghiJKLmnopQR"),
  "нет середины",
);

check(
  "Маскирование: источник — база, а не окружение",
  tokenView.source === "database",
  tokenView.source,
);

check(
  "Маскирование: незаданный токен не выглядит заданным",
  toView({ value: "", source: "unset" }).isSet === false,
  "isSet=false",
);

check(
  "Маскирование: короткий токен не раскрывается частично",
  !maskSecret("1234567").includes("123"),
  maskSecret("1234567"),
);

check(
  "Настроен: токен без канала — это «ещё не настроено», а не ошибка",
  isMessengerConfigured(savedToken, "") === false &&
    isMessengerConfigured(savedToken, "@eartnews") === true,
  "оба случая",
);

/*
  The MAX certificate problem, as an assertion rather than a comment.

  Measured on the workstation and on the VPS: `fetch` to platform-api2.max.ru fails
  before sending anything, because the certificate is issued by the Russian Trusted CA
  of the Ministry of Digital Development and that authority is in neither Node's
  bundled store nor Ubuntu's ca-certificates. Without this classification the editor
  sees `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, which reads like a broken token and sends
  an operator to look for a credential problem that is not there.
*/
check(
  "MAX: отказ доверия к сертификату распознаётся",
  isMaxCertificateError(new Error("fetch failed")) === false &&
    isMaxCertificateError(
      Object.assign(new Error("fetch failed"), {
        cause: Object.assign(new Error("unable to get local issuer certificate"), {
          code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        }),
      }),
    ) === true,
  "по cause.code",
);

check(
  "MAX: тот же отказ распознаётся и по тексту сообщения",
  isMaxCertificateError(new Error("unable to get local issuer certificate")) === true &&
    isMaxCertificateError(new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE")) === true &&
    isMaxCertificateError(new Error("self signed certificate in chain")) === true,
  "без cause",
);

check(
  "MAX: обычная ошибка не принята за проблему сертификата",
  isMaxCertificateError(new Error("401 Unauthorized")) === false &&
    isMaxCertificateError(new Error("chat not found")) === false,
  "ошибка токена остаётся ошибкой токена",
);

check(
  "MAX: в сообщении редактору есть что делать, а не только код",
  describeMaxError(new Error("UNABLE_TO_GET_ISSUER_CERT_LOCALLY")) === MAX_CERTIFICATE_HINT &&
    MAX_CERTIFICATE_HINT.includes("NODE_EXTRA_CA_CERTS"),
  MAX_CERTIFICATE_HINT.slice(0, 60),
);

check(
  "MAX: ошибка без потери смысла проходит дальше как есть",
  describeMaxError(new Error("HTTP 401 — нет доступа")) === "HTTP 401 — нет доступа",
  "не переписана",
);

/*
  The Telegram equivalent, for the opposite reason.

  The VPS cannot open TCP 443 to api.telegram.org at all: curl reports ETIMEDOUT and
  undici reports UND_ERR_CONNECT_TIMEOUT. An editor seeing "fetch failed" would conclude
  the token is wrong and re-paste it, so the two situations are told apart here and
  asserted the same way as MAX's.
*/
check(
  "Telegram: недоступность сети распознаётся и по коду, и по тексту",
  isTelegramUnreachable(
    Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }),
  ) === true &&
    isTelegramUnreachable(new Error("connect ETIMEDOUT 155.212.204.7:443")) === true &&
    isTelegramUnreachable(new Error("getaddrinfo ENOTFOUND api.telegram.org")) === true,
  "таймаут и отсутствие DNS",
);

check(
  "Telegram: отказ токена не принят за недоступность сервера",
  isTelegramUnreachable(new Error("Telegram sendMessage: Unauthorized (401)")) === false &&
    isTelegramUnreachable(new Error("chat not found")) === false,
  "ошибка токена остаётся ошибкой токена",
);

check(
  "Telegram: в сообщении редактору сказано, куда смотреть",
  describeTelegramError(new Error("ETIMEDOUT")) === TELEGRAM_UNREACHABLE_HINT &&
    describeTelegramError(new Error("ETIMEDOUT"), "https://tg.example.com").includes(
      "https://tg.example.com",
    ),
  `${TELEGRAM_UNREACHABLE_HINT} (с адресом при наличии)`,
);

check(
  "Telegram: прочие ошибки не переписаны",
  describeTelegramError(new Error("Telegram sendMessage: Unauthorized (401)")) ===
    "Telegram sendMessage: Unauthorized (401)",
  "как есть",
);

/*
  Graceful degradation, asserted against the real publishers rather than described.

  Every case here is the *normal* state of a production install: no token pasted yet,
  or MAX never set up. None of them may throw — the article is already in the database
  by the time the repost runs, and a messenger that is not configured must not cost the
  editor the story. The config source is injected so none of these touches the network
  or the database.
*/
const draftArticle = {
  title: "Проверка деградации",
  contentHtml: "<p>Тело.</p>",
  slug: "proverka-degradacii",
  categoryName: "Происшествия",
  coverImage: null as string | null,
};

resetTelegramConfigSource();
resetMaxConfigSource();

const emptyTelegram = await publishArticleToTelegram(draftArticle);
check(
  "Telegram: без токена публикация тихо пропускается",
  emptyTelegram.ok === false && (emptyTelegram.error ?? "").includes("Настройки"),
  emptyTelegram.error ?? "без причины",
);

const emptyMax = await publishArticleToMax(draftArticle);
check(
  "MAX: без токена публикация тихо пропускается",
  emptyMax.ok === false && (emptyMax.error ?? "").includes("Настройки"),
  emptyMax.error ?? "без причины",
);

check(
  "MAX: каждая причина недонастройки названа отдельно",
  (maxNotConfigured({ token: "", chatId: "", enabled: true }) ?? "").includes("токен") &&
    (maxNotConfigured({ token: "есть", chatId: "", enabled: true }) ?? "").includes("канала") &&
    (maxNotConfigured({ token: "есть", chatId: "123", enabled: false }) ?? "").includes("выключен") &&
    maxNotConfigured({ token: "есть", chatId: "123", enabled: true }) === null,
  "токен / канал / выключен / всё настроено",
);

setTelegramConfigSource(async () => ({
  token: "123456789:AAHvalid",
  channelId: "",
  enabled: true,
  apiRoot: "",
}));
setMaxConfigSource(async () => ({ token: "есть-токен", chatId: "", enabled: true }));

const noChannel = await publishArticleToTelegram(draftArticle);
const maxNoChat = await publishArticleToMax(draftArticle);
check(
  "Telegram: токен есть, канала нет — сказано про канал",
  noChannel.ok === false && (noChannel.error ?? "").includes("канал"),
  noChannel.error ?? "",
);
check(
  "MAX: токен есть, канала нет — сказано про канал",
  maxNoChat.ok === false && (maxNoChat.error ?? "").includes("канала"),
  maxNoChat.error ?? "",
);

setTelegramConfigSource(async () => ({
  token: "123456789:AAHvalid",
  channelId: "@eartnews",
  enabled: false,
  apiRoot: "",
}));
const switchedOff = await publishArticleToTelegram(draftArticle);
check(
  "Telegram: выключенный автопостинг — не ошибка, а решение",
  switchedOff.ok === false && (switchedOff.error ?? "").includes("выключен"),
  switchedOff.error ?? "",
);

setTelegramConfigSource(async () => {
  throw new Error("настройки недоступны");
});
const settingsDown = await publishArticleToTelegram(draftArticle);
check(
  "Telegram: падение чтения настроек не пробивает наружу",
  settingsDown.ok === false && (settingsDown.error ?? "").includes("настройки недоступны"),
  "ошибка поймана, а не выброшена",
);

/*
  The API root, and why it exists.

  Measured on the production VPS: TCP 443 to api.telegram.org never completes, so every
  publish failed with no Telegram error to report. The escape hatch is an alternative
  base URL, and these assertions are about the two ways it can go wrong: a trailing
  slash producing a doubled path, and a value that is not a root at all.
*/
check(
  "Telegram: пустой адрес API даёт официальный корень",
  telegramApiBase({ token: "", channelId: "", enabled: true, apiRoot: "" }) ===
    DEFAULT_TELEGRAM_API_ROOT,
  DEFAULT_TELEGRAM_API_ROOT,
);

check(
  "Telegram: завершающие слэши в своём адресе не дают двойного пути",
  telegramApiBase({
    token: "",
    channelId: "",
    enabled: true,
    apiRoot: "https://tg.example.com///",
  }) === "https://tg.example.com",
  telegramApiBase({
    token: "",
    channelId: "",
    enabled: true,
    apiRoot: "https://tg.example.com///",
  }),
);

check(
  "Telegram: свой адрес подменяет официальный и это видно в подписи",
  describeApiRoot("https://tg.example.com").includes("tg.example.com") &&
    describeApiRoot(DEFAULT_TELEGRAM_API_ROOT).includes("официальный"),
  `${describeApiRoot("https://tg.example.com")} / ${describeApiRoot(DEFAULT_TELEGRAM_API_ROOT)}`,
);

/*
  The URL validator is a security boundary rather than a convenience. This value becomes
  the host every Telegram request is sent to — *including the one carrying the bot
  token* — so an editor who cannot read the token can still point it at their own server
  and harvest it.
*/
check(
  "Адрес API: https принимается",
  validateApiRoot("https://api.telegram.org") === null &&
    validateApiRoot("https://tg.example.com/proxy") === null,
  "в том числе с путём",
);

check(
  "Адрес API: http отклоняется, кроме localhost",
  validateApiRoot("http://api.telegram.org") !== null &&
    validateApiRoot("http://example.com") !== null &&
    validateApiRoot("http://localhost:8080") === null &&
    validateApiRoot("http://127.0.0.1:8080") === null,
  "локальный nginx reverse proxy разрешён",
);

check(
  "Адрес API: логин и пароль в URL отклоняются",
  validateApiRoot("https://user:pass@tg.example.com") !== null,
  "иначе учетка попала бы в настройки, в страницу и в логи ошибок",
);

check(
  "Адрес API: параметры и якорь отклоняются",
  validateApiRoot("https://tg.example.com/?x=1") !== null &&
    validateApiRoot("https://tg.example.com/#x") !== null,
  "к значению дописывается путь запроса",
);

check(
  "Адрес API: относительный или мусорный адрес отклоняется",
  validateApiRoot("api.telegram.org") !== null &&
    validateApiRoot("/proxy") !== null &&
    validateApiRoot("не url") !== null &&
    validateApiRoot("ftp://example.com") !== null,
  "нужен абсолютный https",
);

check(
  "Адрес API: пусто — не ошибка, а возврат к официальному",
  validateSyndicationField(SYNDICATION_FIELDS.telegramApiRoot, "") === null,
  "очистка разрешена",
);

check(
  "Адрес API: поле объявлено в настройках как url",
  SYNDICATION_FIELDS.telegramApiRoot.key === "TELEGRAM_API_ROOT" &&
    SYNDICATION_FIELDS.telegramApiRoot.kind === "url",
  "telegramApiRoot -> TELEGRAM_API_ROOT",
);

/*
  Proxy resolution. TELEGRAM_PROXY is env-only on purpose — a proxy URL usually carries
  credentials, and this project's rule is that a credential's server-side value is the
  trust boundary. What can be asserted without a proxy to talk to is that the switch
  reads the environment and that a request through a dead proxy fails rather than
  silently going direct.
*/
const originalProxy = process.env.TELEGRAM_PROXY;
delete process.env.TELEGRAM_PROXY;
check("Прокси: без переменной прокси нет", telegramProxy() === "", "прямое соединение");
process.env.TELEGRAM_PROXY = "http://127.0.0.1:3128";
check("Прокси: значение читается из окружения", telegramProxy() === "http://127.0.0.1:3128", telegramProxy());
resetTelegramProxyCache();
delete process.env.TELEGRAM_PROXY;

/*
  The decisive proxy test, and it needs a local listener to be decisive.

  "The request failed" proves nothing on its own: it would also fail with no proxy at
  all. So a throwaway HTTP server is started on an ephemeral port and asked for twice —
  once directly, which must succeed, and once through a proxy pointed at a closed port,
  which must fail. Only a dispatcher that is actually used can turn a working request
  into a failed one.
*/
const { createServer } = await import("node:http");

const listener = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ ok: true }));
});

await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
const listenerPort = (listener.address() as { port: number }).port;
const localRoot = `http://127.0.0.1:${listenerPort}`;

try {
  const direct = await pingTelegramEndpoint({
    token: "",
    channelId: "",
    enabled: true,
    apiRoot: localRoot,
  });
  check(
    "Прокси: без прокси локальный эндпоинт отвечает 200",
    direct.ok && direct.status === 200 && !direct.viaProxy,
    direct.message.slice(0, 110),
  );

  // Same endpoint, same code path, only the proxy differs. A closed port stands in for
  // a proxy that accepts nothing.
  process.env.TELEGRAM_PROXY = "http://127.0.0.1:1";
  resetTelegramProxyCache();

  const proxied = await pingTelegramEndpoint({
    token: "",
    channelId: "",
    enabled: true,
    apiRoot: localRoot,
  });
  check(
    "Прокси: через мёртвый прокси тот же запрос НЕ проходит напрямую",
    proxied.ok === false && proxied.status === null && proxied.viaProxy,
    proxied.message.slice(0, 130),
  );
} finally {
  delete process.env.TELEGRAM_PROXY;
  resetTelegramProxyCache();
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  if (originalProxy !== undefined) process.env.TELEGRAM_PROXY = originalProxy;
}

/*
  The ping itself, against a host that cannot be reached. The reachable case is covered
  above by the local listener, so nothing here depends on the open internet — which
  matters, because api.telegram.org is unreachable from both machines this project runs
  on and a check that needed it would always be red.
*/
const pingUnreachable = await pingTelegramEndpoint({
  token: "",
  channelId: "",
  enabled: true,
  apiRoot: "https://127.0.0.1:9",
});
check(
  "Пинг: недоступный эндпоинт даёт ошибку, а не исключение",
  pingUnreachable.ok === false && pingUnreachable.status === null && pingUnreachable.ms >= 0,
  pingUnreachable.message.slice(0, 110),
);

check(
  "Пинг: измеряет время ответа и сообщает его",
  pingUnreachable.ms >= 0 && Number.isFinite(pingUnreachable.ms),
  `${pingUnreachable.ms} мс`,
);

check(
  "Пинг: сообщает, что учётные данные не отправлялись",
  // The ping sends no token: the question is whether the host can reach the endpoint,
  // and it must be answerable before a token exists.
  pingUnreachable.url === "https://127.0.0.1:9/",
  pingUnreachable.url,
);

resetTelegramConfigSource();
resetMaxConfigSource();

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"} ${entry.name} — ${entry.detail.slice(0, 120)}`);
}

console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 ? 1 : 0;