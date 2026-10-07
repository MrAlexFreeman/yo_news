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
  LONG_READING_THRESHOLD,
  MAX_MESSAGE_LIMIT,
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_MESSAGE_LIMIT,
  buildMessengerPost,
  cutForReading,
  escapeHtml,
  htmlToPlainText,
  planMaxPost,
  planTelegramPost,
  readingNotice,
  toHashtag,
} from "../src/lib/messenger-post";
import {
  DEFAULT_SYNDICATION_ENABLED,
  SYNDICATION_FIELDS,
  isMessengerConfigured,
  maskSecret,
  parseEnabled,
  toView,
  validateSyndicationField,
} from "../src/lib/settings-keys";
import {
  MAX_CERTIFICATE_HINT,
  describeMaxError,
  isMaxCertificateError,
  maxNotConfigured,
  publishArticleToMax,
  resetMaxConfigSource,
  setMaxConfigSource,
} from "../src/lib/max-publisher";
import {
  TELEGRAM_UNREACHABLE_HINT,
  describeTelegramError,
  isTelegramUnreachable,
  publishArticleToTelegram,
  resetTelegramConfigSource,
  setTelegramConfigSource,
} from "../src/lib/telegram-publisher";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const SITE = "https://eartnews.ru";

/** A paragraph of roughly `size` characters, so length boundaries can be hit exactly. */
function paragraph(size: number, marker = "а"): string {
  return marker.repeat(Math.max(0, size));
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
  "Пост: строка-источник в самом конце, перед хештегом",
  simplePost.text.endsWith(`Ё-новости: ${SITE}/news/zagolovok-novosti\n#Происшествия`),
  JSON.stringify(simplePost.text.slice(-70)),
);

check(
  "Пост: ссылка на материал совпадает с url",
  simplePost.url === `${SITE}/news/zagolovok-novosti`,
  simplePost.url,
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

// --- the 1024 caption boundary ------------------------------------------------

/*
  The headline case the task specifies: a post that fits in a caption must arrive as
  one message, because a photo with text under it is what a channel reader wants and
  what the channel preview shows.
*/
const shortPost = buildMessengerPost({
  title: "Короткая новость",
  contentHtml: `<p>${paragraph(300)}</p>`,
  slug: "korotkaya",
  categoryName: "Технологии",
  siteUrl: SITE,
});

const shortPlan = planTelegramPost(shortPost, { hasCover: true });

check(
  "Telegram: до 1024 — одно сообщение с подписью к фото",
  shortPlan.mode === "caption" &&
    shortPlan.steps.length === 1 &&
    shortPlan.steps[0]?.kind === "photo" &&
    shortPlan.steps[0]?.caption === shortPost.text,
  `${shortPlan.mode}, ${shortPlan.length} символов, шагов: ${shortPlan.steps.length}`,
);

/*
  The caption is read through a narrowed step rather than `steps[0]?.caption`, because
  `TelegramStep` is a union: a text step has no `caption` at all, and indexing the
  union blindly would let a plan that is entirely text pass this assertion vacuously.
*/
const shortCaption =
  shortPlan.steps[0]?.kind === "photo" ? shortPlan.steps[0].caption : undefined;

check(
  "Telegram: подпись короче лимита",
  typeof shortCaption === "string" && shortCaption.length <= TELEGRAM_CAPTION_LIMIT,
  `${shortCaption?.length ?? "нет подписи"} <= ${TELEGRAM_CAPTION_LIMIT}`,
);

check(
  "Telegram: ровно 1024 — ещё подпись",
  planTelegramPost(
    { text: paragraph(TELEGRAM_CAPTION_LIMIT), url: `${SITE}/news/s` },
    { hasCover: true },
  ).mode === "caption",
  "граница включительно",
);

check(
  "Telegram: 1025 — уже разделение",
  planTelegramPost(
    { text: paragraph(TELEGRAM_CAPTION_LIMIT + 1), url: `${SITE}/news/s` },
    { hasCover: true },
  ).mode === "split",
  "один символ через границу",
);

/*
  The split shape is the one the task specifies and the only one Telegram allows: the
  cover goes out on its own, because `sendPhoto` refuses a caption over 1024, and the
  text follows as a separate message.
*/
const mediumPlan = planTelegramPost(
  { text: paragraph(2500), url: `${SITE}/news/srednyaya` },
  { hasCover: true },
);

check(
  "Telegram: 1025..4000 — обложка отдельным шагом, текст вторым",
  mediumPlan.mode === "split" &&
    mediumPlan.steps.length === 2 &&
    mediumPlan.steps[0]?.kind === "photo" &&
    mediumPlan.steps[0]?.caption === null &&
    mediumPlan.steps[1]?.kind === "text",
  `${mediumPlan.mode}, шагов: ${mediumPlan.steps.length}`,
);

check(
  "Telegram: текст в разделённом виде не обрезан",
  mediumPlan.steps[1]?.kind === "text" &&
    mediumPlan.steps[1].text.length === 2500 &&
    !mediumPlan.truncated,
  `${mediumPlan.steps[1]?.kind === "text" ? mediumPlan.steps[1].text.length : "?"} символов`,
);

check(
  "Telegram: разделённый текст влезает в лимит сообщения",
  (mediumPlan.steps[1]?.kind === "text" ? mediumPlan.steps[1].text.length : Infinity) <=
    TELEGRAM_MESSAGE_LIMIT,
  `<= ${TELEGRAM_MESSAGE_LIMIT}`,
);

check(
  "Telegram: ровно 4000 — ещё полный текст",
  planTelegramPost({ text: paragraph(LONG_READING_THRESHOLD), url: "u" }).truncated === false,
  "граница включительно",
);

check(
  "Telegram: 4001 — обрезка",
  planTelegramPost({ text: paragraph(LONG_READING_THRESHOLD + 1), url: "u" }).truncated === true,
  "один символ через границу",
);

// --- truncation ---------------------------------------------------------------

const longText = buildMessengerPost({
  title: "Расследование",
  contentHtml: `<p>${bodyOfLength(9000)}</p>`,
  slug: "rassledovanie",
  categoryName: "Происшествия",
  siteUrl: SITE,
});

const longPlan = planTelegramPost(longText, { hasCover: true });

check(
  "Telegram: сверхдлинный материал обрезается",
  longPlan.mode === "truncated" && longPlan.truncated,
  `${longPlan.mode}, исходных ${longPlan.length} символов`,
);

const cutText = longPlan.steps[1]?.kind === "text" ? longPlan.steps[1].text : "";

check(
  "Telegram: после обрезки пост короче порога",
  cutText.length < LONG_READING_THRESHOLD,
  `${cutText.length} < ${LONG_READING_THRESHOLD}`,
);

check(
  "Telegram: обрез заканчивается приглашением прочитать на сайте",
  cutText.endsWith(readingNotice(`${SITE}/news/rassledovanie`)),
  cutText.slice(-70),
);

check(
  "Telegram: в обрезанном посте остаётся много текста, а не огрызок",
  cutText.length > LONG_READING_BODY_LIMIT * 0.9,
  `${cutText.length} >= ~${Math.round(LONG_READING_BODY_LIMIT * 0.9)}`,
);

/*
  The reason the cut lands on a paragraph boundary rather than on a character count:
  the visible cut must not look like the site broke mid-sentence. An ellipsis and a
  "read on the site" line are an admission; half a word is a bug.
*/
const paragraphsInCut = cutText.split("\n\n...")[0]?.split("\n\n") ?? [];
check(
  "Telegram: обрез сделан по границе абзаца",
  paragraphsInCut.length > 1 &&
    paragraphsInCut.every((block) => !block.includes(paragraph(50, "z"))),
  `${paragraphsInCut.length} целых абзацев, ни один не обрезан посередине`,
);

check(
  "Telegram: многоточие стоит перед приглашением",
  cutText.includes("\n\n...\n\n"),
  "три абзаца: текст, многоточие, ссылка",
);

check(
  "Telegram: обрез одного гигантского абзаца не даёт пустой пост",
  cutForReading({ text: paragraph(9000), url: `${SITE}/news/s` }).length > 3000,
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
  "Telegram: без обложки длинный пост — один шаг текстом",
  planTelegramPost({ text: paragraph(2500), url: "u" }, { hasCover: false }).steps.length === 1,
  "фото не отправляется пустым",
);

// --- MAX ----------------------------------------------------------------------

const maxShort = planMaxPost(simplePost, { hasCover: true });
check(
  "MAX: короткий пост целиком, с вложением",
  !maxShort.truncated && maxShort.text === simplePost.text && maxShort.attachCover,
  `${maxShort.text.length} символов`,
);

check(
  "MAX: без обложки вложение не запрашивается",
  !planMaxPost(simplePost, { hasCover: false }).attachCover,
  "attachCover выключен",
);

check(
  "MAX: ровно 4000 — ещё целиком",
  !planMaxPost({ text: paragraph(MAX_MESSAGE_LIMIT), url: "u" }).truncated,
  "граница включительно",
);

const maxCut = planMaxPost({ text: paragraph(MAX_MESSAGE_LIMIT + 1), url: `${SITE}/news/s` });
check(
  "MAX: 4001 — обрезка со ссылкой на полный текст",
  maxCut.truncated && maxCut.text.endsWith(readingNotice(`${SITE}/news/s`)) && maxCut.text.length < MAX_MESSAGE_LIMIT,
  `${maxCut.text.length} < ${MAX_MESSAGE_LIMIT}`,
);

/*
  MAX accepts a message and its attachment in one call, so there is no caption limit to
  dodge and no reason to split. Asserted because a copy of Telegram's planner here
  would be the obvious mistake, and it would send two messages where one is correct.
*/
check(
  "MAX: не разделён на два сообщения, в отличие от Telegram",
  planMaxPost({ text: paragraph(2500), url: "u" }).text.length === 2500,
  "одним сообщением до 4000",
);

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
    TELEGRAM_UNREACHABLE_HINT.includes("api.telegram.org"),
  TELEGRAM_UNREACHABLE_HINT.slice(0, 60),
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

resetTelegramConfigSource();
resetMaxConfigSource();

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"} ${entry.name} — ${entry.detail.slice(0, 120)}`);
}

console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 ? 1 : 0;