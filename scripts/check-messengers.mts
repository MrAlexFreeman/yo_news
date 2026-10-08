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
  MESSENGER_QUOTE_PREFIX,
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_MAX_MESSAGES,
  TELEGRAM_MESSAGE_LIMIT,
  buildMessengerPost,
  chunkForTelegram,
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
  validateApiRoot,
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
  "Telegram: ровно 4000 — ещё одним сообщением",
  planTelegramPost({ text: paragraph(LONG_READING_THRESHOLD), url: "u" }).mode === "split",
  "граница включительно",
);

check(
  "Telegram: 4001 — уже несколькими сообщениями и без обрезки",
  planTelegramPost({ text: paragraph(LONG_READING_THRESHOLD + 1), url: "u" }).mode === "chunks" &&
    planTelegramPost({ text: paragraph(LONG_READING_THRESHOLD + 1), url: "u" }).truncated === false,
  "граница между одним сообщением и несколькими",
);

// --- several messages, and the point past which they are cut ------------------

/*
  The post the brief is about: a story too long for one Telegram message. It must go
  out whole — as several messages split on paragraph boundaries — rather than as a
  picture with a teaser, which is the shape that was reaching the channel.
*/
const longText = buildMessengerPost({
  title: "Расследование",
  contentHtml: `<p>${bodyOfLength(9000)}</p>`,
  slug: "rassledovanie",
  categoryName: "Происшествия",
  siteUrl: SITE,
});

const longPlan = planTelegramPost(longText, { hasCover: true });
const longChunks = longPlan.steps
  .filter((step): step is { kind: "text"; text: string } => step.kind === "text")
  .map((step) => step.text);

check(
  "Telegram: длинный материал уходит несколькими сообщениями",
  longPlan.mode === "chunks" && !longPlan.truncated && longChunks.length >= 2,
  `${longPlan.mode}, ${longChunks.length} сообщений, исходных ${longPlan.length}`,
);

check(
  "Telegram: каждое сообщение влезает в лимит",
  longChunks.every((chunk) => chunk.length <= TELEGRAM_MESSAGE_LIMIT),
  `максимум ${Math.max(...longChunks.map((chunk) => chunk.length))} <= ${TELEGRAM_MESSAGE_LIMIT}`,
);

check(
  "Telegram: сообщения складываются в исходный текст без потерь",
  longChunks.join("\n\n") === longText.text,
  `${longChunks.join("\n\n").length} против ${longText.text.length}`,
);

check(
  "Telegram: границы сообщений проходят по абзацам",
  longChunks
    .slice(0, -1)
    .every((chunk) => longText.text.includes(chunk) && chunk.includes("\n\n")),
  "каждый кусок, кроме последнего, составлен из целых абзацев",
);

const hugePlan = planTelegramPost(
  { text: paragraph(17000), url: `${SITE}/news/s` },
  { hasCover: true },
);

check(
  "Telegram: за пределом четырёх сообщений материал обрезается",
  hugePlan.mode === "truncated" && hugePlan.truncated,
  `${hugePlan.mode}, исходных ${hugePlan.length}, порог ${TELEGRAM_MAX_MESSAGES} сообщения`,
);

const cutText = hugePlan.steps[1]?.kind === "text" ? hugePlan.steps[1].text : "";

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
  cutForReading({ text: paragraph(9000), url: `${SITE}/news/s` }).length > 3000,
  "обрезан по символам, но не в ноль",
);

// --- chunking itself ----------------------------------------------------------

check(
  "Чанки: короткий текст не режется",
  chunkForTelegram("а".repeat(100), 1000).length === 1,
  "один чанк",
);

check(
  "Чанки: граница по абзацам, а не по символам",
  chunkForTelegram("а".repeat(30) + "\n\n" + "б".repeat(30), 40).join("|") ===
    `${"а".repeat(30)}|${"б".repeat(30)}`,
  "два абзаца — два чанка",
);

check(
  "Чанки: абзац длиннее сообщения режется, но не теряется",
  chunkForTelegram("в".repeat(100), 30).join("").length === 100,
  "100 символов на выходе",
);

check(
  "Чанки: обрез не оставляет половину сущности",
  chunkForTelegram(`ааааа&amp;ббб`, 6).every((chunk) => !/&[a-z]*$/.test(chunk)),
  chunkForTelegram(`ааааа&amp;ббб`, 6)
    .map((chunk) => JSON.stringify(chunk))
    .join(" "),
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
  "Пост: обрезка длинного текста с цитатой остаётся под лимитом",
  planMaxPost({
    text: postWithQuoteAndFigure.text.repeat(20),
    url: `${SITE}/news/s`,
  }).text.length < MAX_MESSAGE_LIMIT,
  `${planMaxPost({ text: postWithQuoteAndFigure.text.repeat(20), url: "u" }).text.length} < ${MAX_MESSAGE_LIMIT}`,
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
  // 1. A short post: the caption must be on the photo. This is the reported bug. */
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
    "Мок: короткий пост — один запрос sendPhoto с подписью",
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

  // 2. A long post: the cover on its own, then the whole text as a message. This is
  //    the case that reached the channel as a bare picture.
  calls.length = 0;
  const longArticle = {
    title: "Длинная новость",
    contentHtml: `<p>${paragraph(3000)}</p>`,
    slug: "dlinnaia",
    categoryName: "Общество",
    coverImage: COVER_URL,
  };
  const longResult = await publishArticleToTelegram(longArticle);

  check(
    "Мок: длинный пост — фото и следом текст",
    longResult.ok &&
      calls.length === 2 &&
      calls[0]?.method === "sendPhoto" &&
      calls[1]?.method === "sendMessage",
    `${calls.length} запрос(ов): ${calls.map((call) => call.method).join(", ")}`,
  );

  check(
    "Мок: текст второго сообщения — полный пост, а не огрызок",
    String(calls[1]?.json?.text ?? "") === expectedPost(longArticle).text &&
      String(calls[1]?.json?.text ?? "").includes(paragraph(3000)),
    `${String(calls[1]?.json?.text ?? "").length} символов`,
  );

  check(
    "Мок: у текста parse_mode HTML и отключён предпросмотр",
    calls[1]?.json?.parse_mode === "HTML" && calls[1]?.json?.disable_web_page_preview === true,
    `${calls[1]?.json?.parse_mode} / ${calls[1]?.json?.disable_web_page_preview}`,
  );

  // 3. The escaping, end to end: this body is exactly what used to make Telegram refuse
  //    the message, which left the picture without it.
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
    "Мок: единственный живой тег — <b> заголовка",
    (trickyText.match(/<[^>]*>/g) ?? []).join("") === "<b></b>",
    JSON.stringify(trickyText.match(/<[^>]*>/g) ?? []),
  );

  // 4. An answer Telegram rejects: the whole answer must reach the log, so an operator
  //    reading PM2 sees the reason and not a bare "fetch failed".
  calls.length = 0;
  const warnings: string[] = [];
  const realWarn = console.warn;
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
      return new Response(JSON.stringify({ ok: true, result: { message_id: 703 } }), {
        headers: { "content-type": "application/json" },
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
    "Мок: отказ Telegram возвращается как ошибка, а не как успех",
    rejected.ok === false && (rejected.error ?? "").includes("can't parse entities"),
    rejected.error ?? "",
  );

  check(
    "Мок: причина отказа попадает в лог PM2 вместе с методом",
    warnings.some((line) => line.includes("sendMessage") && line.includes("can't parse entities")),
    warnings.find((line) => line.includes("can't parse entities"))?.slice(0, 120) ?? "нет строки",
  );

  check(
    "Мок: фото к этому моменту уже ушло — именно так выглядел сбой",
    calls.some((call) => call.method === "sendPhoto"),
    calls.map((call) => call.method).join(", "),
  );
} finally {
  globalThis.fetch = realFetch;
  resetTelegramConfigSource();
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
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