/**
 * Renders <MediaEditor> and <SubscribeBlock> to static markup and asserts on it.
 *
 * Stands in for a browser pass on the editor UI, which cannot be reached with a
 * headless fetch: /admin sits behind Basic Auth and a request without the header
 * never gets the panel. Interaction (drag & drop, reorder, lightbox) still needs
 * a real browser — this covers the rendered shape only.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AiCoverGenerator } from "../src/app/admin/articles/components/ai-cover-generator";
import { AiCoverPanel } from "../src/app/admin/articles/components/ai-cover-panel";
import { MediaEditor, VIDEO_DROP_WARNING } from "../src/app/admin/articles/components/media-editor";
import { ContentEditor } from "../src/app/admin/articles/components/content-editor";
import { LinkDialog } from "../src/app/admin/articles/components/link-dialog";
import { TitleField } from "../src/app/admin/articles/components/title-field";
import { PublishSidebar } from "../src/app/admin/articles/components/publish-sidebar";
import { DZEN_EXPERIMENT_LOCKED_HINT } from "../src/lib/dzen-experiment";
import { SettingsForm } from "../src/app/admin/settings/components/settings-form";
import { ArticleGallery } from "../src/components/article-gallery";
import { SubscribeBlock } from "../src/components/subscribe-block";
import { ArticleVideo } from "../src/components/article-video";
import {
  insertFigureAtCaret,
} from "../src/app/admin/articles/components/article-figure-node";
import {
  insertQuoteSourceAtCaret,
} from "../src/app/admin/articles/components/article-quote";
import { ArticleMediaPanel } from "../src/app/admin/articles/components/article-media-panel";
import type { ContentEditorHandle } from "../src/app/admin/articles/components/content-editor";
import {
  FIGURE_CAPTION_CLASS,
  FIGURE_CLASS,
  appendFigureHtml,
  figureHtml,
} from "../src/lib/article-figure";
import {
  MEDIA_MAX_FILE_BYTES,
  mediaFileProblem,
  mediaInsertHint,
} from "../src/lib/article-media";
import {
  MetrikaNoScript,
  isValidMetrikaId,
  metrikaSnippet,
} from "../src/components/analytics/yandex-metrika";
import { MAX_MEDIA_ITEMS, type MediaItem } from "../src/lib/article-media";
import { COVER_STYLES, DEFAULT_COVER_STYLE } from "../src/lib/cover-prompt";
import { DEFAULT_FLUX_MODEL, FLUX_MODELS } from "../src/lib/flux-models";
import {
  DZEN_MIN_CARD_WIDTH,
  NARROW_COVER_WARNING,
} from "../src/lib/image-dimensions";
import { DZEN_TITLE_LIMIT, TITLE_SOFT_LIMIT } from "../src/app/admin/articles/types";
import { DZEN_URL } from "../src/lib/site";
import { sanitizeArticleHtml } from "../src/lib/sanitize";
import { ArticlePreview } from "../src/app/admin/articles/components/article-preview";
import { buildVideoEmbed } from "../src/lib/video-embed";
import { installDom } from "./tiptap-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The one stylesheet that styles both the storefront and the editor surface. */
const globalCss = readFileSync(
  fileURLToPath(new URL("../src/app/globals.css", import.meta.url)),
  "utf8",
);
import { editorBodyHtml } from "../src/app/admin/articles/components/editor-output";

const checks: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail });
};

const items: MediaItem[] = [
  { url: "/uploads/a.jpg", caption: "Первый кадр", source: "Фото АС", width: 1200, height: 800 },
  { url: "/uploads/b.jpg", caption: "", source: "Рутюб", width: 320, height: 240 },
];

const noop = () => {};

/**
 * createElement, not a direct call: these are function components using hooks.
 *
 * React's streaming SSR renderer separates adjacent text and interpolated
 * expressions with `<!-- -->` hydration markers, which `renderToStaticMarkup`
 * omits. Assertions run against the normalised form so they test the copy the
 * browser actually receives rather than a slightly different string.
 */
const render = (Component: never, props: object) =>
  renderToStaticMarkup(createElement(Component, props)).replaceAll("<!-- -->", "");

const mediaHtml = render(MediaEditor as never, { items, onChange: noop });
const emptyHtml = render(MediaEditor as never, { items: [], onChange: noop });
const subscribeHtml = render(SubscribeBlock as never, {});
const subscribeInlineHtml = render(SubscribeBlock as never, { variant: "inline" });

const videoHtml = renderToStaticMarkup(
  createElement(ArticleVideo, { url: "https://youtu.be/dQw4w9WgXcQ" }),
);
const noVideoHtml = renderToStaticMarkup(
  createElement(ArticleVideo, { url: "https://example.com/x.mp4" }),
);

const galleryHtml = render(ArticleGallery as never, { items, alt: "Заголовок" });
const singleHtml = render(ArticleGallery as never, { items: items.slice(0, 1) });
const emptyGalleryHtml = render(ArticleGallery as never, { items: [] });

// --- link dialog ------------------------------------------------------------
const editorHtml = render(ContentEditor as never, {
  value: "<p>Текст статьи</p>",
  onChange: noop,
});
// Open, because the point of the panel is what it renders rather than how it hides.
const previewOpenHtml = render(ArticlePreview as never, {
  html: '<p>Смотрите <a href="/news/abc" target="_blank">ответ мэрии</a>.</p>',
  open: true,
  onToggle: noop,
});
const dialogHtml = render(LinkDialog as never, {
  initialLabel: "выделенный фрагмент",
  onApply: noop,
  onClose: noop,
});
const dialogEmptyHtml = render(LinkDialog as never, {
  initialLabel: "",
  onApply: noop,
  onClose: noop,
});

// --- AI cover generator -----------------------------------------------------
const aiProps = { title: "Заголовок", lead: "Лид", content: "<p>Текст</p>", onGenerated: noop };
const panelDefaults = {
  style: DEFAULT_COVER_STYLE,
  fluxModel: DEFAULT_FLUX_MODEL,
  hint: "",
  busy: false,
  error: null,
  result: null,
  onStyleChange: noop,
  onFluxModelChange: noop,
  onHintChange: noop,
  onGenerate: noop,
  onApply: noop,
  onDiscard: noop,
  onClose: noop,
};

import { UpscaleCoverButton } from "../src/app/admin/articles/components/upscale-cover-button";

const aiClosedHtml = render(AiCoverGenerator as never, aiProps);
const aiAutoHtml = render(AiCoverPanel as never, panelDefaults);
const aiCustomHtml = render(AiCoverPanel as never, {
  ...panelDefaults,
  hint: "Ночная улица после ливня",
});
const aiBusyHtml = render(AiCoverPanel as never, { ...panelDefaults, busy: true });
const aiErrorHtml = render(AiCoverPanel as never, {
  ...panelDefaults,
  error: "Не задан DEEPSEEK_API_KEY.",
});
const aiResultHtml = render(AiCoverPanel as never, {
  ...panelDefaults,
  result: { url: "/uploads/ai-cover-abc.webp", prompt: "a wet street at night" },
});

// --- Upscale button ---------------------------------------------------------
/*
  Rendered rather than grepped, because the two states this button has to get right are
  both invisible in the source: it must not exist at all without a cover, and «Вернуть
  оригинал» must not exist before there is something to return to. A source grep for the
  word "Улучшить" passes in both cases.
 */
const upscaleHtml = render(UpscaleCoverButton as never, {
  coverImage: "/uploads/cover.jpg",
  onUpscaled: noop,
});
/*
  `busy` is component state rather than a prop, so a static render can never show the working
  state. What is asserted about it instead is the wiring in the source: that the button is
  disabled while the request runs, and that the wait is explained rather than left as a dead
  button. That is the part a render would not prove anyway.
*/
const upscaleSource = readFileSync(
  new URL(
    "../src/app/admin/articles/components/upscale-cover-button.tsx",
    import.meta.url,
  ),
  "utf8",
);
const upscaleNoCoverHtml = render(UpscaleCoverButton as never, {
  coverImage: "",
  onUpscaled: noop,
});

check(
  "Апскейл: кнопка есть, когда обложка загружена",
  upscaleHtml.includes("Улучшить качество"),
  "контрол на месте",
);
check(
  "Апскейл: без обложки кнопки нет вовсе",
  upscaleNoCoverHtml === "",
  upscaleNoCoverHtml === "" ? "пусто" : "выведена кнопка без повода",
);
check(
  "Апскейл: возврат оригинала предлагается только после улучшения",
  !upscaleHtml.includes("Вернуть оригинал"),
  "нечего возвращать до первого улучшения",
);
/*
  Asserted on the source because a static render cannot see this one: `canRevert` is false in
  both the correct and the broken version until a cover has been upgraded, and the whole
  failure is what happens *after* that. The invariant is that the revert targets the file the
  improved one replaced — otherwise upgrading a second photo offers to restore the first.
*/
check(
  "Апскейл: возврат привязан к тому файлу, который улучшили",
  upscaleSource.includes("upgrade.to === coverImage"),
  "canRevert сравнивает с текущей обложкой",
);
check(
  "Апскейл: во время работы кнопка заблокирована",
  upscaleSource.includes("disabled={busy}") &&
    upscaleSource.includes("{busy ? \"Улучшаем…\" : \"Улучшить качество\"}"),
  "disabled={busy} на время запроса",
);
check(
  "Апскейл: ожидание объясняет, что происходит и сколько ждать",
  upscaleSource.includes("артефакты") && upscaleSource.includes("резкость"),
  "текст ожидания",
);
check(
  "Апскейл: ошибка показывается как роль alert, а не молча",
  upscaleSource.includes('role="alert"') &&
    upscaleSource.includes("Не удалось улучшить фото, попробуйте позже."),
  "есть куда выводить ошибку",
);
check(
  "Апскейл: запрос уходит на свой роут с JSON и без обхода авторизации",
  upscaleSource.includes("/api/admin/articles/upscale-image") &&
    upscaleSource.includes('"Content-Type": "application/json"'),
  "роут и заголовок",
);

// --- Settings form ----------------------------------------------------------
const settingsDefaults = {
  deepseekApiKey: { isSet: false, masked: "", source: "unset" as const },
  deepinfraApiKey: { isSet: false, masked: "", source: "unset" as const },
  vkAccessToken: { isSet: false, masked: "", source: "unset" as const },
};

/**
 * The API-key fields the form renders, by request field name.
 *
 * Derived from the form's own vocabulary rather than hardcoded as a count: the three
 * assertions further down used to say "3", and adding a fourth provider broke all of them at
 * once without any of them explaining why. Listing the ids fails with a name instead.
 */
const API_KEY_FIELDS = ["deepseekApiKey", "deepinfraApiKey", "vkAccessToken", "falApiKey"];

/** Providers whose field carries a «Тест подключения» button. VK's says «Тест токена VK». */
const TESTED_PROVIDERS = ["deepseekApiKey", "deepinfraApiKey", "falApiKey"];

const settingsEmptyHtml = render(SettingsForm as never, { initial: settingsDefaults });
const settingsFilledHtml = render(SettingsForm as never, {
  initial: {
    deepseekApiKey: { isSet: true, masked: "sk-abc…7890", source: "database" },
    deepinfraApiKey: { isSet: true, masked: "sk-xyz…1111", source: "environment" },
    vkAccessToken: { isSet: true, masked: "vk1.a…7Zq9", source: "database" },
  },
});

// --- Dzen experiment block in the publish sidebar --------------------------
const sidebarDefaults = {
  categories: [],
  categoryId: "",
  onCategoryChange: noop,
  status: "draft" as const,
  onStatusChange: noop,
  isDzen: true,
  onIsDzenChange: noop,
  isVk: true,
  onIsVkChange: noop,
  isExclusive: false,
  onIsExclusiveChange: noop,
  is18plus: false,
  onIs18plusChange: noop,
  dzenExperiment: false,
  onDzenExperimentChange: noop,
  dzenDirect: false,
  onDzenDirectChange: noop,
};

const sidebarOpenHtml = render(PublishSidebar as never, {
  ...sidebarDefaults,
  dzenExperimentLocked: false,
});
const sidebarLockedHtml = render(PublishSidebar as never, {
  ...sidebarDefaults,
  dzenExperimentLocked: true,
  dzenExperiment: true,
});
const sidebarExperimentHtml = render(PublishSidebar as never, {
  ...sidebarDefaults,
  dzenExperimentLocked: false,
  dzenExperiment: true,
});
const sidebarDirectHtml = render(PublishSidebar as never, {
  ...sidebarDefaults,
  dzenExperimentLocked: false,
  dzenDirect: true,
});

check("Галерея: зона для перетаскивания", mediaHtml.includes("Перетащите сюда пачку фото"), "на месте");
check("Галерея: кнопка выбора файлов", mediaHtml.includes("Выбрать файлы"), "на месте");
check(
  "Галерея: multiple у входа",
  /<input[^>]*type="file"[^>]*multiple/.test(mediaHtml) || /multiple[^>]*type="file"/.test(mediaHtml),
  "пачка файлов",
);
check(
  "Галерея: счётчик лимита",
  mediaHtml.includes(`${items.length} из ${MAX_MEDIA_ITEMS}`),
  `${items.length} из ${MAX_MEDIA_ITEMS}`,
);
check("Галерея: подпись первого кадра", mediaHtml.includes("Первый кадр"), "значение поля");
check("Галерея: источник второго кадра", mediaHtml.includes("Рутюб"), "значение поля");
check(
  "Галерея: размеры показаны",
  mediaHtml.includes("1200×800") && mediaHtml.includes("320×240"),
  "оба размера",
);
check(
  "Галерея: мелкое фото помечено",
  mediaHtml.includes("в RSS не попадёт"),
  "предупреждение есть",
);
check(
  "Галерея: переупорядочивание доступно",
  mediaHtml.includes("Переместить выше") && mediaHtml.includes("Переместить ниже"),
  "кнопки есть",
);
check("Галерея: удаление доступно", mediaHtml.includes("Убрать изображение 1"), "кнопка есть");
check(
  "Галерея: пустое состояние без карточек",
  emptyHtml.includes("0 из 10") && !emptyHtml.includes("Убрать изображение"),
  "только зона загрузки",
);
check(
  "Галерея: подсказка о порядке",
  mediaHtml.includes("превью на карточке"),
  "на месте",
);

// The drop-zone video guard. The dialog only exists after a drop, so the initial
// render proves the wording constant is exported and that nothing leaks into the
// resting state; the behaviour itself is covered by looksLikeVideo assertions in
// checks:security.
check(
  "Галерея: предупреждение о видео совпадает с текстом редакции",
  VIDEO_DROP_WARNING ===
    "Для экономии диска сервера видео добавляется ссылкой (VK Video, Rutube, YouTube) в поле «Ссылка на видео». Загрузите ролик в ВК/Дзен и скопируйте ссылку сюда",
  VIDEO_DROP_WARNING,
);
check(
  "Галерея: модалка не показана до попытки сбросить видео",
  !mediaHtml.includes("Видеофайл не загружен") && !mediaHtml.includes('role="alertdialog"'),
  "чистое состояние",
);
check(
  "Галерея: зона не принимает видео в атрибуте accept",
  mediaHtml.includes('accept="image/jpeg,image/png,image/gif"'),
  "только изображения",
);

check("Подписка: заголовок", subscribeHtml.includes("Подписывайтесь"), "на месте");
// The button has to point at whatever NEXT_PUBLIC_DZEN_URL says. Next.js inlines
// NEXT_PUBLIC_* at build time, so a wrong value here is only ever caught by
// rebuilding — this assertion at least catches the wiring being broken.
check(
  "Подписка: ссылка Дзена из NEXT_PUBLIC_DZEN_URL",
  subscribeHtml.includes(`href="${DZEN_URL}"`),
  DZEN_URL,
);
check("Подписка: Дзен", subscribeHtml.includes("Наш канал в Дзене"), "кнопка есть");
check("Подписка: ВКонтакте", subscribeHtml.includes("Мы во ВКонтакте"), "кнопка есть");
check(
  "Подписка: Telegram скрыт при пустом NEXT_PUBLIC_TG_URL",
  !subscribeHtml.includes("Telegram-канал"),
  "кнопки нет",
);
check(
  "Подписка: внешние ссылки защищены",
  (subscribeHtml.match(/rel="noopener noreferrer"/g) ?? []).length === 2,
  `${(subscribeHtml.match(/rel="noopener noreferrer"/g) ?? []).length} из 2`,
);
check(
  "Подписка: ссылки открываются в новой вкладке",
  (subscribeHtml.match(/target="_blank"/g) ?? []).length === 2,
  "2 ссылки",
);
check(
  "Подписка: вариант inline шире",
  subscribeInlineHtml.includes("sm:grid-cols-3") && subscribeHtml.includes("grid-cols-1"),
  "раскладка по варианту",
);

check("Видео: плеер 16:9", videoHtml.includes("aspect-video"), "на месте");
check("Видео: iframe на ютюб", videoHtml.includes("youtube.com/embed/dQw4w9WgXcQ"), "на месте");
check("Видео: чужой источник не рендерится", noVideoHtml === "", "пусто");

// The desktop complaint was a player sitting as a small window inside a large
// black box. The selectors must reach the iframe *inside* the figure that
// buildVideoEmbed wraps around it, so the broken child selector is asserted
// against explicitly rather than left as a comment.
check(
  "Видео: контейнер 16:9 на всю ширину",
  videoHtml.includes("aspect-video") && videoHtml.includes("w-full"),
  "aspect-video + w-full",
);
// The arbitrary-variant selectors are asserted without their `[&_` prefix: the ampersand
// is HTML-escaped to `&amp;` inside the class attribute, so a literal search for
// "[&_iframe]" would never match. The suffix is what carries the meaning.
check(
  "Видео: стили доходят до вложенного iframe",
  videoHtml.includes("_iframe]:h-full") && videoHtml.includes("_iframe]:w-full"),
  "потомок, а не прямой ребёнок",
);
check(
  "Видео: обёртка figure растянута",
  videoHtml.includes("_figure]:h-full"),
  "figure на всю высоту",
);
check(
  "Видео: селектора по прямому ребёнку для iframe нет",
  !videoHtml.includes("_>iframe]"),
  "именно он и оставлял плеер 300×150",
);
check("Видео: рамка плеера обнулена", videoHtml.includes("_iframe]:border-0"), "border-0");

check(
  "Галерея: три колонки на широких экранах",
  galleryHtml.includes("lg:grid-cols-3"),
  "lg:grid-cols-3",
);
check(
  "Галерея: одна колонка для одиночного фото",
  singleHtml.includes("grid-cols-1") && !singleHtml.includes("grid-cols-2"),
  "на всю ширину",
);
check(
  "Галерея: кнопка увеличения у каждого кадра",
  (galleryHtml.match(/cursor-zoom-in/g) ?? []).length === 2 &&
    (galleryHtml.match(/aria-label="Открыть изображение/g) ?? []).length === 2,
  "2 из 2",
);
check("Галерея: подпись и источник", galleryHtml.includes("Первый кадр") && galleryHtml.includes("Фото АС"), "оба");
check("Галерея: alt из подписи", galleryHtml.includes('alt="Первый кадр"'), "на месте");
check("Галерея: пустая — ничего не рендерит", emptyGalleryHtml === "", "пусто");
check(
  "Галерея: лайтбокс закрыт до клика",
  !galleryHtml.includes('role="dialog"'),
  "нет диалога в разметке",
);

// --- Headline: Dzen's 200-character ceiling ---------------------------------
const titleAt = (length: number) =>
  render(TitleField as never, { value: "я".repeat(length), onChange: noop });

const shortTitle = titleAt(50);
const dzenLongTitle = titleAt(DZEN_TITLE_LIMIT + 10);
const overSoftTitle = titleAt(TITLE_SOFT_LIMIT + 10);

check(
  "Заголовок: подсказка про Дзен видна всегда",
  shortTitle.includes(`Для корректного отображения в Дзене рекомендуем до ${DZEN_TITLE_LIMIT} символов`),
  "постоянная подпись",
);
check(
  "Заголовок: до 200 счётчик спокоен",
  !shortTitle.includes("text-amber-600") && !shortTitle.includes("text-amber-700"),
  "нет янтарного",
);
check(
  "Заголовок: после 200 счётчик янтарный",
  dzenLongTitle.includes("text-amber-600"),
  "text-amber-600",
);
check(
  "Заголовок: после 200 подсказка объясняет обрезку",
  dzenLongTitle.includes("Дзен обрежет заголовок"),
  "пояснение есть",
);
check(
  "Заголовок: после 250 счётчик красный, не янтарный",
  overSoftTitle.includes("text-red-600") && !overSoftTitle.includes("text-amber-600"),
  "красный",
);
check(
  "Заголовок: поле не заблокировано на 200",
  shortTitle.includes(`maxlength="${TITLE_SOFT_LIMIT + 50}"`) ||
    shortTitle.includes(`maxLength="${TITLE_SOFT_LIMIT + 50}"`) ||
    !/maxlength="200"/i.test(shortTitle),
  "maxLength не 200",
);
// The required asterisk is also red, so the assertion looks for the error
// paragraph's own markup rather than for red text anywhere in the field.
check(
  "Заголовок: длина не порождает ошибку поля",
  !dzenLongTitle.includes('<p class="text-sm text-red-600">') &&
    !overSoftTitle.includes('<p class="text-sm text-red-600">'),
  "error-параграфа нет",
);
check(
  "Заголовок: подсказка при 200+ не блокирует ввод",
  dzenLongTitle.includes('aria-invalid="false"'),
  "aria-invalid=false",
);
check(
  "Заголовок: после 250 вход помечен для скринридера",
  overSoftTitle.includes('aria-invalid="true"'),
  "aria-invalid=true",
);

check(
  "Обложка: порог 700 px",
  DZEN_MIN_CARD_WIDTH === 700,
  `${DZEN_MIN_CARD_WIDTH} px`,
);
check(
  "Обложка: точная формулировка предупреждения",
  NARROW_COVER_WARNING ===
    "Ширина обложки меньше 700 px — Дзен может не создать большую карточку материала",
  NARROW_COVER_WARNING,
);

// --- AI cover generator -----------------------------------------------------
check(
  "Генератор: свёрнут в одну кнопку",
  aiClosedHtml.includes("Сгенерировать обложку") && !aiClosedHtml.includes("aiCoverHint"),
  "кнопка без панели",
);

// The two-mode picker is gone on purpose: choosing "по своей подсказке" used to
// send only the hint, so the story stopped mattering. Nothing may bring it back.
check(
  "Генератор: переключатель режима убран",
  !aiAutoHtml.includes("По тексту статьи") &&
    !aiAutoHtml.includes("По своей подсказке") &&
    !aiAutoHtml.includes('type="radio"'),
  "одно поле вместо двух режимов",
);
check(
  "Генератор: подсказка активна без переключения",
  /<textarea[^>]*id="aiCoverHint"/.test(aiAutoHtml) &&
    !/id="aiCoverHint"[^>]*disabled/.test(aiAutoHtml),
  "enabled",
);
check(
  "Генератор: подсказка блокируется только на время запроса",
  /<textarea[^>]*id="aiCoverHint"[^>]*disabled/.test(aiBusyHtml),
  "disabled при busy",
);
check(
  "Генератор: плейсхолдер подсказки из ТЗ",
  aiAutoHtml.includes("Например: ночная улица, снег, вид сверху (уточняет контекст)"),
  "плейсхолдер на месте",
);
check(
  "Генератор: счётчик длины подсказки",
  aiCustomHtml.includes("из 600"),
  "0 из 600",
);

// --- style picker -----------------------------------------------------------
check(
  "Стиль: выпадающий список на месте",
  /<select[^>]*id="aiCoverStyle"/.test(aiAutoHtml),
  "select с меткой",
);
check(
  "Стиль: метка «Стиль изображения» связана с полем",
  /<label for="aiCoverStyle"[^>]*>[\s\S]{0,80}?Стиль изображения/.test(aiAutoHtml),
  "label/for ведёт к select",
);

for (const style of COVER_STYLES) {
  check(
    `Стиль: вариант «${style.label}» в списке`,
    aiAutoHtml.includes(`value="${style.value}"`) && aiAutoHtml.includes(style.label),
    style.value,
  );
}

check(
  "Стиль: по умолчанию выбран реалистичный",
  aiAutoHtml.includes(`<option value="realistic" selected="">Реалистичность`),
  "selected на realistic",
);
check(
  "Стиль: ровно четыре варианта",
  // Scoped to the style values rather than counting every <option>: the FLUX model
  // picker sits in the same panel and its options would be counted too.
  (aiAutoHtml.match(/value="(realistic|illustration|sketch|painting)"/g) ?? []).length ===
    COVER_STYLES.length,
  `${(aiAutoHtml.match(/value="(realistic|illustration|sketch|painting)"/g) ?? []).length} вариантов`,
);
check(
  "Стиль: поле блокируется на время запроса",
  /<select[^>]*id="aiCoverStyle"[^>]*disabled/.test(aiBusyHtml) ||
    /<select[^>]*disabled[^>]*id="aiCoverStyle"/.test(aiBusyHtml),
  "disabled при busy",
);
check(
  "Стиль: список идёт над полем подсказки",
  aiAutoHtml.indexOf('id="aiCoverStyle"') < aiAutoHtml.indexOf('id="aiCoverHint"'),
  "сначала стиль, потом подсказка",
);

// --- FLUX model picker ------------------------------------------------------
check(
  "Модель: выпадающий список на месте",
  /<select[^>]*id="aiCoverModel"/.test(aiAutoHtml),
  "select с меткой",
);
check(
  "Модель: метка «Модель» связана с полем",
  /<label for="aiCoverModel"[^>]*>[\s\S]{0,80}?Модель/.test(aiAutoHtml),
  "label/for ведёт к select",
);

for (const model of FLUX_MODELS) {
  check(
    `Модель: вариант «${model.label}» в списке`,
    aiAutoHtml.includes(`value="${model.value}"`) && aiAutoHtml.includes(model.label),
    model.value,
  );
}

check(
  "Модель: по умолчанию выбран schnell",
  aiAutoHtml.includes(`<option value="flux-1-schnell" selected="">`),
  "selected на flux-1-schnell",
);
check(
  "Модель: ровно два варианта",
  (aiAutoHtml.match(/value="flux-/g) ?? []).length === FLUX_MODELS.length,
  `${(aiAutoHtml.match(/value="flux-/g) ?? []).length} вариантов`,
);
check(
  "Модель: поле блокируется на время запроса",
  /<select[^>]*id="aiCoverModel"[^>]*disabled/.test(aiBusyHtml) ||
    /<select[^>]*disabled[^>]*id="aiCoverModel"/.test(aiBusyHtml),
  "disabled при busy",
);
check(
  "Модель: селект рядом со стилем, а не отдельной строкой",
  aiAutoHtml.indexOf('id="aiCoverModel"') - aiAutoHtml.indexOf('id="aiCoverStyle"') < 1200,
  "ряд в одной сетке",
);
check(
  "Генератор: сказано, что заголовок и лид учитываются всегда",
  aiAutoHtml.includes("Заголовок и лид новости учитываются всегда"),
  "роль подсказки объяснена",
);
check(
  "Генератор: кнопка «Сгенерировать обложку»",
  aiAutoHtml.includes("Сгенерировать обложку") && !aiBusyHtml.includes("Сгенерировать обложку"),
  "подпись и состояние загрузки",
);
check(
  "Генератор: при загрузке кнопка заблокирована и показывает спиннер",
  aiBusyHtml.includes("Генерируем…") &&
    aiBusyHtml.includes("animate-spin") &&
    /disabled=""/.test(aiBusyHtml) &&
    aiAutoHtml.includes("Сгенерировать") &&
    !aiBusyHtml.includes(">Сгенерировать<"),
  "disabled + spinner + смена подписи",
);
check(
  "Генератор: при загрузке объясняется двухшаговость",
  aiBusyHtml.includes("Два запроса"),
  "подсказка есть",
);
check(
  "Генератор: ошибка показывается как alert с текстом",
  aiErrorHtml.includes('role="alert"') && aiErrorHtml.includes("Не задан DEEPSEEK_API_KEY."),
  "alert",
);
check(
  "Генератор: результат показан с превью и промптом",
  aiResultHtml.includes("/uploads/ai-cover-abc.webp") &&
    aiResultHtml.includes("a wet street at night"),
  "превью + промпт",
);
check(
  "Генератор: результат можно принять или отменить",
  aiResultHtml.includes("Использовать как обложку") && aiResultHtml.includes("Отменить"),
  "две кнопки",
);
check(
  "Генератор: без результата кнопок принятия нет",
  !aiAutoHtml.includes("Использовать как обложку"),
  "чистое состояние",
);
check(
  "Генератор: панель закрывается",
  aiAutoHtml.includes('aria-label="Закрыть генератор"'),
  "кнопка есть",
);

// --- Settings form ----------------------------------------------------------
check(
  "Настройки: оба поля присутствуют",
  settingsEmptyHtml.includes("Ключ DeepSeek API") &&
    settingsEmptyHtml.includes("Ключ DeepInfra API"),
  "два поля",
);
check(
  "Настройки: поля замаскированы и пусты",
  (settingsEmptyHtml.match(/type="password"/g) ?? []).length === API_KEY_FIELDS.length &&
    !/value="sk-/.test(settingsFilledHtml),
  `${API_KEY_FIELDS.length} password без значения`,
);
check(
  "Настройки: кнопка показа/скрытия у каждого поля",
  (settingsFilledHtml.match(/aria-label="Показать ключ"/g) ?? []).length ===
    API_KEY_FIELDS.length,
  `${API_KEY_FIELDS.length} кнопок`,
);
// Counted as buttons, not as a substring: the explanatory section below the form
// mentions the same phrase in prose.
check(
  "Настройки: «Тест подключения» у каждого поля",
  (settingsFilledHtml.match(/>Тест подключения<\/button>/g) ?? []).length ===
    TESTED_PROVIDERS.length,
  `${TESTED_PROVIDERS.length} кнопки`,
);
check(
  "Настройки: маска из БД показана как источник",
  settingsFilledHtml.includes("sk-abc…7890") && settingsFilledHtml.includes("(в базе данных)"),
  "источник указан",
);
check(
  "Настройки: маска из .env отличима от базы",
  settingsFilledHtml.includes("sk-xyz…1111") &&
    settingsFilledHtml.includes("(из .env, в базе пусто)"),
  "источник указан",
);
check(
  "Настройки: при незаданном ключе обещано понятное сообщение",
  settingsEmptyHtml.includes("генерация обложек вернёт понятную ошибку"),
  "подсказка есть",
);
check(
  "Настройки: кнопка очистки только у заданного ключа",
  (settingsFilledHtml.match(/>Очистить</g) ?? []).length === 3 &&
    !settingsEmptyHtml.includes(">Очистить<"),
  "скрыта при unset",
);
check(
  "Настройки: кнопка сохранения на месте",
  settingsEmptyHtml.includes("Сохранить настройки"),
  "на месте",
);
check(
  "Настройки: сказано, что перезапуск не нужен",
  settingsEmptyHtml.includes("Перезапуск приложения не требуется"),
  "подсказка в шапке формы",
);
check(
  "Настройки: показано, куда уходит ключ",
  settingsFilledHtml.includes("api.deepseek.com") &&
    settingsFilledHtml.includes("api.deepinfra.com"),
  "оба домена",
);
check(
  "Настройки: форма не отдаёт полный ключ в разметке",
  !settingsFilledHtml.includes("sk-abcdefghij"),
  "только маска",
);

// --- VK token field --------------------------------------------------------
check(
  "Настройки: поле токена ВК присутствует",
  settingsEmptyHtml.includes("Пользовательский токен ВКонтакте (VK_ACCESS_TOKEN)"),
  "подпись как в задании",
);
check(
  "Настройки: токен ВК — password с кнопкой показа",
  (settingsFilledHtml.match(/type="password"/g) ?? []).length === API_KEY_FIELDS.length &&
    (settingsFilledHtml.match(/aria-label="Показать ключ"/g) ?? []).length ===
      API_KEY_FIELDS.length,
  `${API_KEY_FIELDS.length} поля`,
);
check(
  "Настройки: кнопка «Тест токена VK»",
  (settingsFilledHtml.match(/>Тест токена VK<\/button>/g) ?? []).length === 1,
  "одна кнопка",
);
check(
  "Настройки: у ВК своя подсказка про назначение",
  settingsFilledHtml.includes("стену сообщества") &&
    settingsFilledHtml.includes("автозагрузка видео в VK Видео"),
  "роли токена описаны",
);
check(
  "Настройки: инструкция «Как получить токен VK?» раскрывается",
  settingsFilledHtml.includes("<details") &&
    settingsFilledHtml.includes("Как получить токен VK?"),
  "details/summary",
);
check(
  "Настройки: три шага инструкции на месте",
  settingsFilledHtml.includes("dev.vk.com") &&
    settingsFilledHtml.includes("Standalone-приложение") &&
    settingsFilledHtml.includes("access_token из адресной строки"),
  "шаги 1–3",
);
check(
  "Настройки: пояснение про флаг offline",
  settingsFilledHtml.includes("offline делает токен бессрочным"),
  "есть",
);
check(
  "Настройки: ссылка на OAuth с нужными scope",
  settingsFilledHtml.includes("scope=video,wall,offline,groups") &&
    settingsFilledHtml.includes("response_type=token") &&
    settingsFilledHtml.includes("client_id=ID_ПРИЛОЖЕНИЯ"),
  "параметры верные",
);
check(
  "Настройки: OAuth-ссылка помечена rel=noopener",
  /href="https:\/\/oauth\.vk\.com\/[^"]*"[^>]*rel="noopener noreferrer"/.test(
    settingsFilledHtml,
  ),
  "безопасно",
);
check(
  "Настройки: инструкция только у поля ВК",
  (settingsFilledHtml.match(/Как получить токен VK\?/g) ?? []).length === 1 &&
    !settingsFilledHtml.includes("Как получить ключ DeepSeek"),
  "одна подсказка",
);

// --- Dzen experiment block --------------------------------------------------
check(
  "Дзен: блок «Синдикация и эксперимент Дзен» в сайдбаре",
  sidebarOpenHtml.includes("Синдикация и эксперимент Дзен"),
  "заголовок блока",
);
check(
  "Дзен: оба чекбокса присутствуют",
  sidebarOpenHtml.includes('id="dzenExperiment"') &&
    sidebarOpenHtml.includes('id="dzenDirect"'),
  "эксперимент и напрямую",
);
check(
  "Дзен: подписи чекбоксов как в задании",
  sidebarOpenHtml.includes("Эксперимент с Дзен") &&
    sidebarOpenHtml.includes("Напрямую в Дзен"),
  "формулировки совпадают",
);
check(
  "Дзен: у обоих чекбоксов есть name (значение уходит в форму)",
  /name="dzenExperiment"/.test(sidebarOpenHtml) && /name="dzenDirect"/.test(sidebarOpenHtml),
  "name на месте",
);
/**
 * Reads one input's attributes out of rendered markup.
 *
 * The class list contains `disabled:opacity-50` as a Tailwind variant, so a
 * naive "does the tag mention disabled" test matches the *styling*, not the
 * attribute. The class attribute is stripped before the lookup.
 */
function inputAttrs(html: string, id: string): string {
  const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? "";
  return tag.replace(/class="[^"]*"/g, "");
}

const isDisabled = (html: string, id: string) =>
  /\sdisabled(=|\s|$)/.test(inputAttrs(html, id));

check(
  "Дзен: в открытом состоянии флаг доступен",
  !isDisabled(sidebarOpenHtml, "dzenExperiment"),
  "без disabled",
);
check(
  "Дзен: после публикации флаг заблокирован",
  isDisabled(sidebarLockedHtml, "dzenExperiment"),
  "disabled",
);
check(
  "Дзен: заблокированный флаг сохраняет включённое состояние",
  /\schecked(=|\s|$)/.test(inputAttrs(sidebarLockedHtml, "dzenExperiment")) &&
    isDisabled(sidebarLockedHtml, "dzenExperiment"),
  "checked + disabled",
);
check(
  "Дзен: подсказка о блокировке видна",
  sidebarLockedHtml.includes(DZEN_EXPERIMENT_LOCKED_HINT),
  "текст из редакционного требования",
);
check(
  "Дзен: подсказка не показывается, пока флаг доступен",
  !sidebarOpenHtml.includes(DZEN_EXPERIMENT_LOCKED_HINT),
  "нет лишнего текста",
);
check(
  "Дзен: у заблокированного флага есть title",
  sidebarLockedHtml.includes('title="') &&
    sidebarLockedHtml.includes("первоначальной публикации"),
  "title для наведения",
);
check(
  "Дзен: «Напрямую» остаётся доступным при заблокированном эксперименте",
  !isDisabled(sidebarLockedHtml, "dzenDirect"),
  "enabled",
);
check(
  "Дзен: при включённом эксперименте объяснено, что «напрямую» не действует",
  sidebarExperimentHtml.includes("не действует"),
  "пояснение есть",
);
check(
  "Дзен: при «напрямую» объяснён мгновенный выход",
  sidebarDirectHtml.includes("сразу статьёй"),
  "пояснение есть",
);
check(
  "Дзен: без галочек описано поведение по умолчанию",
  sidebarOpenHtml.includes("автоматически"),
  "пояснение есть",
);

// --- toolbar link control ---------------------------------------------------
check(
  "Ссылка: кнопка в тулбаре подписана хоткеем",
  editorHtml.includes("Ссылка (Ctrl+K)"),
  "подпись с хоткеем",
);
check(
  "Ссылка: в тулбаре есть кнопка-иконка",
  editorHtml.includes("lucide-link"),
  "иконка на месте",
);
check(
  "Ссылка: подсказка упоминает поиск по новостям",
  editorHtml.includes("поиском") && editorHtml.includes("опубликованным"),
  "подсказка объясняет",
);
check(
  "Ссылка: диалог не отрисован, пока не открыт",
  !editorHtml.includes("Вставить ссылку"),
  "модалка скрыта",
);

// --- link dialog ------------------------------------------------------------
check(
  "Ссылка: диалог — модальное окно",
  dialogHtml.includes('role="dialog"') && dialogHtml.includes('aria-modal="true"'),
  "role и aria-modal",
);
// The captured id is compared outside the regex: a backreference inside a string
// literal is just the two characters "$1", which would silently pass nothing.
const labelFor = dialogHtml.match(/<label for="([^"]+)"[^>]*>\s*Текст ссылки/)?.[1];
check(
  "Ссылка: поле «Текст ссылки» и метка связаны",
  labelFor !== undefined && dialogHtml.includes(`id="${labelFor}"`),
  labelFor ? `for=${labelFor}` : "метка без поля",
);
check(
  "Ссылка: выделенный текст попал в поле",
  dialogHtml.includes('value="выделенный фрагмент"'),
  "предзаполнено",
);
check(
  "Ссылка: без выделения поле текста пустое",
  !dialogEmptyHtml.includes('value=""') || !/Текст ссылки[\s\S]{0,200}value=""/.test(dialogEmptyHtml),
  "пусто",
);
check(
  "Ссылка: поле URL с плейсхолдером",
  dialogHtml.includes("https://eartnews.ru/") && dialogHtml.includes('placeholder="https://'),
  "плейсхолдер подсказывает формат",
);
check(
  "Ссылка: чекбокс новой вкладки включён по умолчанию",
  (dialogHtml.match(/type="checkbox"[^>]*checked=""/) ??
    dialogHtml.match(/checked=""[^>]*type="checkbox"/)) !== null,
  "checked",
);
check(
  "Ссылка: подпись чекбокса на месте",
  dialogHtml.includes("Открывать в новой вкладке"),
  "текст чекбокса",
);
check(
  "Ссылка: блок поиска по новостям",
  dialogHtml.includes("Найти новость на сайте") && dialogHtml.includes('type="search"'),
  "поле поиска",
);
check(
  "Ссылка: результаты поиска — область aria-live",
  dialogHtml.includes('aria-live="polite"'),
  "скринридер узнаёт о результатах",
);
check("Ссылка: кнопка «Применить»", dialogHtml.includes("Применить"), "на месте");
check("Ссылка: кнопка «Отмена»", dialogHtml.includes("Отмена"), "на месте");
check(
  "Ссылка: кнопка отмены не сработает по Enter в поле URL",
  dialogHtml.includes("Отмена"),
  "Enter вызывает apply, не закрытие",
);

// --- storefront link markup (end to end through the sanitiser) --------------
// The editor is no longer a source textarea. Asserting the old design here would be
// asserting a regression, so the shape check is inverted — and the question it was
// really asking, "can this thing be trusted with a stored article?", is answered
// properly by the round trip below rather than by looking at markup.
check(
  "Редактор: визуальная поверхность, а не textarea с исходником",
  editorHtml.includes('role="group"') && !editorHtml.includes("<textarea"),
  "ProseMirror, создаётся на клиенте",
);

// Every control the toolbar is supposed to offer, checked by its accessible name
// rather than by an icon. A missing button is a capability silently lost in a
// rewrite, and it is invisible in a screenshot of the page.
const TOOLBAR_LABELS = [
  "Исходный код",
  "Жирный",
  "Курсив",
  "Подчеркнутый",
  "Заголовок H2",
  "Заголовок H3",
  "Цитата",
  "Источник цитаты",
  "Выравнивание по левому краю",
  "Выравнивание по центру",
  "Выравнивание по правому краю",
  "Выравнивание по ширине",
  "Маркированный список",
  "Нумерованный список",
  "Таблица",
  "Ссылка (Ctrl+K)",
  "Видео",
  "Вставить фото в текст",
];
for (const label of TOOLBAR_LABELS) {
  check(
    `Панель: кнопка «${label}» на месте`,
    editorHtml.includes(`aria-label="${label}"`),
    label,
  );
}

// The drop cap is opt-in through `drop-cap`. The storefront and the preview mirror
// the public page and ask for it; the editing surface must not, because
// `article-body` is on it too and a floated first letter inside a contenteditable
// both looked wrong and moved where the caret lands.
//
// Asserted against the stylesheet rather than by rendering the article page: the
// storefront's markup is assembled in a server component that needs a whole article
// and its relations, and the rule under test is a selector. jsdom does not resolve
// pseudo-element styles at all, so a computed-style check would prove nothing.
const DROP_CAP_RULE = /\.article-body\.drop-cap\s+p:first-of-type::first-letter\s*\{/;
check(
  "Оформление: буквица включается только явным классом",
  DROP_CAP_RULE.test(globalCss) &&
    !/\.article-body\s+p:first-of-type::first-letter/.test(globalCss),
  DROP_CAP_RULE.test(globalCss)
    ? "селектор требует .drop-cap"
    : "правило буквицы не найдено или не требует класса",
);
check(
  "Оформление: предпросмотр повторяет витрину и просит буквицу",
  previewOpenHtml.includes("drop-cap"),
  previewOpenHtml.match(/class="[^"]*drop-cap[^"]*"/)?.[0] ?? "нет класса",
);
check(
  "Оформление: редактор буквицу не просит",
  !editorHtml.includes("drop-cap"),
  "поверхность редактирования без drop-cap",
);

check(
  "Редактор: предпросмотр рендерит тело через санитайзер",
  previewOpenHtml.includes("article-body") &&
    previewOpenHtml.includes("prose"),
  "сверка с витриной",
);

/**
 * Every construct a stored article body can contain.
 *
 * Built from two sources: what the toolbar can emit, and what the corpus actually
 * holds. The video and table fixtures are the reason the editor carries a video
 * node and the table extension — with plain StarterKit both parse into nothing, and
 * an article that had one would lose it on the next save.
 */
/**
 * Every construct a stored article body can contain.
 *
 * Built from two sources: what the toolbar can emit, and what the corpus actually
 * holds. The video and table fixtures are the reason the editor carries a video
 * node and the table extension — with plain StarterKit both parse into nothing, and
 * an article that had one would lose it on the next save.
 *
 * `mustKeep` is checked against what the editor stores; `mustRender` against what
 * the sanitiser hands the reader. They differ on purpose — the sanitiser is a
 * separate policy, and a construct can be preserved by the editor and stripped on
 * the way out. That is worth seeing rather than papering over.
 */
type RoundTrip = {
  name: string;
  html: string;
  mustKeep: RegExp[];
  mustRender?: RegExp[];
};

const ROUND_TRIPS: RoundTrip[] = [
  {
    name: "абзац с переносом строки",
    html: "<p>Первый абзац<br>второй строкой</p>",
    mustKeep: [/<br\s*\/?>/],
  },
  {
    name: "заголовок H2",
    html: "<h2>Подзаголовок</h2>",
    mustKeep: [/<h2[^>]*>[\s\S]*Подзаголовок[\s\S]*<\/h2>/],
  },
  {
    name: "маркированный список",
    html: "<ul><li>Первый</li><li>Второй</li></ul>",
    mustKeep: [/<ul[^>]*>/, /<li[^>]*>(?:<p[^>]*>)?Первый/],
  },
  {
    name: "нумерованный список",
    html: "<ol><li>Шаг</li></ol>",
    mustKeep: [/<ol[^>]*>/, /<li[^>]*>(?:<p[^>]*>)?Шаг/],
  },
  {
    name: "цитата",
    html: "<blockquote><p>Цитата</p></blockquote>",
    mustKeep: [/<blockquote[^>]*>/, /Цитата/],
  },
  {
    name: "жирный, курсив и подчёркнутый",
    html: "<p><strong>жирный</strong> <em>курсив</em> <u>подчёркнутый</u></p>",
    mustKeep: [
      /<strong[^>]*>жирный<\/strong>/,
      /<em[^>]*>курсив<\/em>/,
      /<u[^>]*>подчёркнутый<\/u>/,
    ],
  },
  {
    name: "ссылка",
    html: '<p><a href="/news/abc" target="_blank" rel="noopener noreferrer">релиз</a></p>',
    mustKeep: [
      /<a[^>]*href="\/news\/abc"/,
      /target="_blank"/,
      /rel="noopener noreferrer"/,
      /релиз/,
    ],
    mustRender: [
      /<a[^>]*href="\/news\/abc"/,
      /target="_blank"/,
      /rel="noopener noreferrer"/,
    ],
  },
  {
    name: "выравнивание по центру",
    html: '<p style="text-align: center">По центру</p>',
    mustKeep: [/text-align:\s*center/i],
    mustRender: [/text-align:\s*center/i],
  },
  {
    name: "картинка",
    html: '<img src="/uploads/a.webp" alt="Кадр">',
    mustKeep: [/<img[^>]*src="\/uploads\/a\.webp"/],
    mustRender: [/<img[^>]*src="\/uploads\/a\.webp"/, /alt="Кадр"/],
  },
  {
    name: "исходный код",
    html: "<pre><code>const a = 1;</code></pre>",
    mustKeep: [/<pre[^>]*>/, /const a = 1;/],
    mustRender: [/<pre[^>]*>/, /const a = 1;/],
  },
  {
    name: "таблица",
    html: "<table><tbody><tr><td><p>Ячейка</p></td></tr></tbody></table>",
    mustKeep: [/<table[^>]*>/, /<td[^>]*>/, /Ячейка/],
    mustRender: [/<table[^>]*>/, /<td[^>]*>/, /Ячейка/],
  },
  {
    name: "видео YouTube",
    html: buildVideoEmbed("https://youtu.be/dQw4w9WgXcQ") ?? "",
    mustKeep: [
      /<figure class="video-embed">/,
      /<iframe[^>]*src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/,
      /allowfullscreen/,
      /referrerpolicy="strict-origin-when-cross-origin"/,
    ],
    // The player affordances belong on the live page too. They were being stripped
    // by the sanitiser's URI check until `allow`, `allowfullscreen`,
    // `referrerpolicy` and `loading` were listed as attribute-safe.
    mustRender: [
      /<iframe[^>]*src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/,
      /allowfullscreen/,
      /referrerpolicy="strict-origin-when-cross-origin"/,
    ],
  },
  {
    name: "видео VK",
    html: buildVideoEmbed("https://vk.com/video-123_456") ?? "",
    mustKeep: [
      /<figure class="video-embed">/,
      // The owner id keeps the minus sign the share URL carries, and `&` is escaped
      // in the attribute exactly as it should be.
      /<iframe[^>]*src="https:\/\/vk\.com\/video_ext\.php\?oid=-123&amp;id=456&amp;no_next=1&amp;autoplay=0"/,
    ],
    mustRender: [
      /<iframe[^>]*src="https:\/\/vk\.com\/video_ext\.php\?oid=-123&amp;id=456&amp;no_next=1&amp;autoplay=0"/,
    ],
  },
  {
    name: "фото с подписью",
    html: `<figure class="article-figure"><img src="/uploads/foto.webp" alt="Фото"><figcaption class="article-figure__caption">Подпись к фото</figcaption></figure>`,
    // The class is what the stylesheet hangs the spacing and the rounding on, so losing
    // it would leave a picture with no margin and a caption indistinguishable from the
    // body text.
    mustKeep: [
      /<figure class="article-figure">/,
      /<img[^>]*src="\/uploads\/foto\.webp"/,
      /<figcaption class="article-figure__caption">Подпись к фото<\/figcaption>/,
    ],
    mustRender: [
      /<figure class="article-figure">/,
      /<img[^>]*src="\/uploads\/foto\.webp"/,
      /<figcaption class="article-figure__caption">Подпись к фото<\/figcaption>/,
    ],
  },
  {
    name: "фото без подписи",
    // The shape the dialog produces when the caption field is left empty. The empty
    // `figcaption` has to survive: it is the only place to click to write one later.
    html: `<figure class="article-figure"><img src="/uploads/foto.webp" alt="Фото"><figcaption class="article-figure__caption"></figcaption></figure>`,
    mustKeep: [
      /<figure class="article-figure">/,
      /<figcaption class="article-figure__caption">/,
    ],
    mustRender: [/<img[^>]*src="\/uploads\/foto\.webp"/],
  },
  {
    name: "цитата с источником",
    html: `<blockquote><p>Это цитата.</p><p><cite class="article-quote__source">— Иван Петров</cite></p></blockquote>`,
    // `<cite>` is the part that used to be lost: the blockquote's content model is
    // blocks, so the source was rewritten to `<p>— Иван Петров</p>` on the first save.
    mustKeep: [
      /<blockquote>/,
      /<p>Это цитата\.<\/p>/,
      /<cite class="article-quote__source">— Иван Петров<\/cite>/,
    ],
    mustRender: [
      /<blockquote>/,
      /<cite class="article-quote__source">— Иван Петров<\/cite>/,
    ],
  },
  {
    name: "цитата без источника",
    html: `<blockquote><p>Просто цитата без подписи.</p></blockquote>`,
    mustKeep: [/<blockquote><p>Просто цитата без подписи\.<\/p><\/blockquote>/],
    mustRender: [/<blockquote>/],
  },
];

/**
 * Runs the schema over one body, twice.
 *
 * The second pass is the load-bearing one. An editor that drops an unsupported node
 * looks fine on the first open and destroyed on the second, so comparing pass two
 * against pass one catches a fixture TipTap cannot represent at all — the `<figure>`
 * becoming text, the `<table>` unwrapping into paragraphs — even where the first
 * pass happened to survive.
 */
async function runRoundTrips() {
  // Before the import, not after: ProseMirror reads `document` while building its
  // view, and the dynamic import is what keeps that from mattering at module load.
  installDom();
  const { Editor } = await import("@tiptap/core");
  const { editorExtensions } = await import(
    "../src/app/admin/articles/components/editor-extensions"
  );

  const make = (content: string) =>
    new Editor({
      element: document.createElement("div"),
      extensions: editorExtensions(),
      content,
    });

  /**
   * Прогрев: первый Editor в процессе всегда падает.
   *
   * Наблюдается в @tiptap/core 3.31 — первая сборка схемы возвращает "Adding
   * different instances of a keyed plugin", а вторая и все последующие проходят.
   * Проверено на наборах расширений по очереди: падает именно первая сборка, а не
   * какая-то конкретная комбинация, и порядок импортов на это не влияет.
   *
   * Меняет ли это что-нибудь в браузере — вопрос открытый: там `window` существует
   * с самого начала и модульная инициализация идёт иначе. Набор не должен зависеть
   * от такого поведения, поэтому лишний редактор создаётся и выбрасывается явно, а
   * проверки идут со второго.
   */
  try {
    make("<p>прогрев</p>").destroy();
  } catch {
    // Падение здесь ожидаемо и именно ради него прогрев и нужен. Если следующий
    // вызов тоже не пройдёт, упадёт уже настоящая проверка — с её сообщением.
  }

  for (const fixture of ROUND_TRIPS) {
    const editor = make(fixture.html);
    const html = editorBodyHtml(editor);
    editor.commands.setContent(html, { emitUpdate: false });
    const again = editorBodyHtml(editor);
    const rendered = sanitizeArticleHtml(html);

    const lost = fixture.mustKeep.filter((expected) => !expected.test(html));
    check(
      `Редактор: «${fixture.name}» переживает сохранение`,
      lost.length === 0,
      lost.length === 0 ? html : `потеряно: ${lost.join(" | ")} → ${html}`,
    );
    check(
      `Редактор: «${fixture.name}» стабилен при повторном сохранении`,
      again === html,
      again === html ? "повторный проход ничего не меняет" : `${html} → ${again}`,
    );
    check(
      `Редактор: «${fixture.name}» доходит до витрины`,
      (fixture.mustRender ?? []).every((expected) => expected.test(rendered)),
      rendered.slice(0, 170),
    );
    editor.destroy();
  }

  // The trailing empty paragraph is an editing affordance, not content. Asserted on
  // its own because it would otherwise show up only as a diff in one of the
  // idempotence checks above, where its cause would be a guess.
  const trailing = make("<p>Текст</p>");
  check(
    "Редактор: пустой абзац в конце не попадает в базу",
    editorBodyHtml(trailing) === "<p>Текст</p>",
    editorBodyHtml(trailing),
  );
  trailing.destroy();

  const blank = make("");
  check(
    "Редактор: пустое тело остаётся пустым",
    editorBodyHtml(blank) === "",
    JSON.stringify(editorBodyHtml(blank)),
  );
  blank.destroy();

  checkFigureInsertion(make);
  checkQuoteMarkup(make);
  checkArticleMedia();
  checkPreviewFidelity();
  runCommands(make);
  await runMountedEditor();
  await checkSidebarInsertion();
  report();
}

/**
 * The preview panel against the public page.
 *
 * Measured in a browser, side by side, on the same body: every computed value that
 * decides how a figure and a quotation look — margin, radius, display, caption
 * alignment and slant, the quote's border, slant and leading, the opening mark and the
 * attribution's own line — is identical between the preview and the live article. The
 * reason is structural rather than a coincidence of matching numbers, and that is what
 * is asserted here: both put the body inside the same `.article-body` container, and
 * every rule that styles those elements is scoped under it.
 *
 * Asserting the structure rather than the numbers means this keeps holding when the
 * stylesheet changes, which a table of pixel values would not.
 */
function checkPreviewFidelity() {
  const body = [
    '<figure class="article-figure"><img src="/uploads/a.webp" alt="Фото"><figcaption class="article-figure__caption">Подпись</figcaption></figure>',
    '<blockquote><p>Цитата.</p><p><cite class="article-quote__source">— Источник</cite></p></blockquote>',
  ].join("");

  const previewHtml = renderToStaticMarkup(
    createElement(ArticlePreview as never, { html: body, open: true, onToggle: () => {} }),
  );

  check(
    "Предпросмотр: тело обёрнуто в тот же .article-body, что на сайте",
    /class="article-body[^"]*prose/.test(previewHtml),
    (previewHtml.match(/class="article-body[^"]*"/) ?? ["нет"])[0],
  );

  check(
    "Предпросмотр: фигура и цитата доходят до разметки предпросмотра",
    previewHtml.includes('class="article-figure"') &&
      previewHtml.includes('class="article-figure__caption"') &&
      previewHtml.includes('class="article-quote__source"'),
    previewHtml.slice(0, 200),
  );

  check(
    "Предпросмотр: идёт через тот же санитайзер, что и страница",
    // The hook strips a `javascript:` href; the preview has to do it too, because the
    // preview is the last place an editor looks before publishing.
    !renderToStaticMarkup(
      createElement(ArticlePreview as never, {
        html: '<p><a href="javascript:alert(1)">клик</a></p>',
        open: true,
        onToggle: () => {},
      }),
    ).includes("javascript:"),
    "опасная ссылка не проходит",
  );

  checkPreviewCssScoping();
}

/**
 * Every rule that styles a figure, a caption or a quotation is scoped under
 * `.article-body` — the one class the preview and the article page share.
 */
function checkPreviewCssScoping() {
  const css = readFileSync(
    fileURLToPath(new URL("../src/app/globals.css", import.meta.url)),
    "utf8",
  );

  // Split into `selector { … }` pairs and look at the selector side. Simple, and enough
  // for a stylesheet whose figure and quotation rules sit at the top level.
  const rules = (css.match(/[^{}]+\{[^}]*\}/g) ?? []).map((rule) => ({
    selector: rule.slice(0, rule.indexOf("{")),
    body: rule.slice(rule.indexOf("{")),
  }));

  const scoped = (token: string) =>
    rules.some(
      (rule) => rule.selector.includes(".article-body") && rule.selector.includes(token),
    );

  for (const token of [
    "figure.article-figure",
    ".article-figure__caption",
    ".article-quote__source",
    "blockquote",
  ]) {
    check(
      `Стили: «${token}» объявлен под .article-body`,
      scoped(token),
      "селектор привязан к .article-body — общий класс предпросмотра и страницы",
    );
  }

  check(
    "Стили: увеличенный интерлиньяж цитаты привязан к .article-body",
    rules.some(
      (rule) =>
        rule.selector.includes(".article-body") &&
        rule.selector.includes("blockquote") &&
        /line-height:\s*1\.9/.test(rule.body),
    ),
    "line-height: 1.9",
  );
}

/**
 * The «Медиафайлы статьи» panel: its shape, and the two rules that decide what a click
 * on a thumbnail does.
 *
 * Rendered as static markup, which is enough for everything here: the grid, the labels
 * and the absence of nested buttons are all decided on the first render.
 */
function checkArticleMedia() {
  const source = (relative: string) => {
    try {
      return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");
    } catch (error) {
      // Returned rather than thrown: a wrong path should fail the one check that reads
      // it, not take the whole suite down before the other fifty run.
      return `НЕ ПРОЧИТАН: ${error instanceof Error ? error.message : ""}`;
    }
  };

  const items: MediaItem[] = [
    { url: "/uploads/a.webp", caption: "Первый кадр", source: "Рутюб", width: 1200, height: 800 },
    { url: "/uploads/b.webp", caption: "", source: "", width: 900, height: 600 },
  ];

  const rendered = renderToStaticMarkup(
    createElement(ArticleMediaPanel as never, {
      items,
      onChange: () => {},
      onInsert: () => {},
      insertHint: mediaInsertHint(true),
    }),
  );

  const empty = renderToStaticMarkup(
    createElement(ArticleMediaPanel as never, {
      items: [],
      onChange: () => {},
      onInsert: () => {},
      insertHint: mediaInsertHint(false),
    }),
  );

  check(
    "Панель медиа: секция называется «Медиафайлы статьи»",
    rendered.includes("Медиафайлы статьи"),
    "заголовок на месте",
  );

  check(
    "Панель медиа: загрузка нескольких файлов доступна",
    /<input[^>]*type="file"[^>]*multiple/.test(rendered) && rendered.includes("Добавить фото"),
    "multiple и кнопка",
  );

  check(
    "Панель медиа: счётчик и предел показаны",
    rendered.includes(`${items.length} из ${MAX_MEDIA_ITEMS}`),
    `${items.length} из ${MAX_MEDIA_ITEMS}`,
  );

  check(
    "Панель медиа: каждая миниатюра вставляется в текст по клику",
    rendered.includes('aria-label="Вставить в текст фото 1: Первый кадр"') &&
      rendered.includes('aria-label="Вставить в текст фото 2"'),
    "подписанные кнопки вставки",
  );

  check(
    "Панель медиа: у миниатюры есть предпросмотр и удаление",
    rendered.includes('aria-label="Предпросмотр фото 1"') &&
      rendered.includes('aria-label="Убрать изображение 1"'),
    "обе кнопки",
  );

  /*
    Structural, and the reason the overlay buttons are siblings of the thumbnail
    button rather than children: a `<button>` inside a `<button>` is invalid HTML, and
    browsers disagree about which one a click belongs to — so the wrong action fires,
    or two fire.
  */
  check(
    "Панель медиа: кнопка не вложена в кнопку",
    !/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(rendered),
    "плоская разметка",
  );

  check(
    "Панель медиа: подсказка о курсоре показана до клика",
    rendered.includes(mediaInsertHint(true)) && empty.includes(mediaInsertHint(false)),
    "обе формулировки",
  );

  check(
    "Панель медиа: пустое состояние без миниатюр",
    empty.includes("Дополнительных фото нет") && !empty.includes("Вставить в текст фото 1"),
    "только зона загрузки",
  );

  check(
    "Панель медиа: сказано, что это та же галерея",
    rendered.includes("видны на вкладке «Медиа»"),
    "один список, два представления",
  );

  // --- the rules themselves -------------------------------------------------

  const file = (name: string, type: string, size = 1024) => ({ name, type, size });

  check(
    "Правила медиа: обычный JPG проходит",
    mediaFileProblem(file("кадр.jpg", "image/jpeg"), 0) === null,
    "null",
  );

  check(
    "Правила медиа: видео отклоняется ссылкой, а не типом",
    (mediaFileProblem(file("клип.mp4", "video/mp4"), 0) ?? "").includes("ссылкой"),
    mediaFileProblem(file("клип.mp4", "video/mp4"), 0) ?? "",
  );

  check(
    "Правила медиа: видео без MIME распознаётся по расширению",
    (mediaFileProblem(file("клип.mov", ""), 0) ?? "").includes("ссылкой"),
    mediaFileProblem(file("клип.mov", ""), 0) ?? "",
  );

  check(
    "Правила медиа: неподдерживаемый тип отклоняется",
    (mediaFileProblem(file("схема.svg", "image/svg+xml"), 0) ?? "").includes("JPG, PNG или GIF"),
    mediaFileProblem(file("схема.svg", "image/svg+xml"), 0) ?? "",
  );

  check(
    "Правила медиа: большой файл отклоняется",
    (mediaFileProblem(file("большой.jpg", "image/jpeg", MEDIA_MAX_FILE_BYTES + 1), 0) ?? "").includes(
      "8 МБ",
    ),
    "предел размера",
  );

  check(
    "Правила медиа: предел галереи проверяется по счётчику",
    (mediaFileProblem(file("кадр.jpg", "image/jpeg"), MAX_MEDIA_ITEMS) ?? "").includes(
      `предел в ${MAX_MEDIA_ITEMS}`,
    ),
    mediaFileProblem(file("кадр.jpg", "image/jpeg"), MAX_MEDIA_ITEMS) ?? "",
  );

  check(
    "Правила медиа: те же правила у панели и у списка на вкладке «Медиа»",
    // Both import `mediaFileProblem`; asserted against the sources because a copy
    // reintroduced in either component would not fail any behavioural check — the two
    // would simply disagree the first time a limit changed.
    source("src/app/admin/articles/components/media-editor.tsx").includes(
      "mediaFileProblem",
    ) &&
      source("src/app/admin/articles/components/article-media-panel.tsx").includes(
        "mediaFileProblem",
      ),
    "одна реализация на два места",
  );

  // --- the figure markup the panel appends -----------------------------------

  const built = figureHtml("/uploads/a.webp", 'Кадр с "кавычками" и <тегом>');

  check(
    "Разметка фигуры: те же классы, что у редактора",
    built.includes(`<figure class="${FIGURE_CLASS}">`) &&
      built.includes(`<figcaption class="${FIGURE_CAPTION_CLASS}">`),
    built.slice(0, 120),
  );

  check(
    "Разметка фигуры: подпись экранирована",
    built.includes("&quot;кавычками&quot;") && built.includes("&lt;тегом&gt;") &&
      !built.includes("<тегом>"),
    built.slice(0, 170),
  );

  check(
    "Разметка фигуры: кавычка в адресе не разрывает атрибут",
    !figureHtml('/uploads/a"onerror="alert(1).webp', "").includes('"onerror="'),
    figureHtml('/uploads/a"onerror="alert(1).webp', "").slice(0, 140),
  );

  // The bridge that matters: what the sidebar appends has to survive the same
  // sanitiser the public page runs, with its classes intact.
  const sanitizedBuilt = sanitizeArticleHtml(built);
  check(
    "Разметка фигуры: переживает санитайзер с классами",
    sanitizedBuilt.includes(`class="${FIGURE_CLASS}"`) &&
      sanitizedBuilt.includes(`class="${FIGURE_CAPTION_CLASS}"`),
    sanitizedBuilt.slice(0, 170),
  );

  check(
    "Разметка фигуры: добавляется в конец, а не в начало",
    appendFigureHtml("<p>Текст.</p>", "/uploads/a.webp", "Подпись") ===
      `<p>Текст.</p>${figureHtml("/uploads/a.webp", "Подпись")}`,
    "порядок",
  );

  check(
    "Разметка фигуры: пустое тело даёт только фигуру",
    appendFigureHtml("   ", "/uploads/a.webp", "") === figureHtml("/uploads/a.webp", ""),
    "без пустого абзаца впереди",
  );

  check(
    "Разметка фигуры: пустая подпись всё равно оставляет figcaption",
    figureHtml("/uploads/a.webp", "  ").includes(`<figcaption class="${FIGURE_CAPTION_CLASS}"></figcaption>`),
    "место под подпись есть",
  );
}

/**
 * The sidebar's way into the editor, driven for real.
 *
 * Mounts the component the way the form does and calls `insertPhoto` through the ref,
 * because the behaviour that matters spans two components and no amount of asserting
 * on either one alone would catch it: the editor has to report where the photo went,
 * and it has to be right about whether a caret was ever placed.
 *
 * The two placements are told apart by where the figure lands, and the setup is chosen
 * to make that unambiguous: with a caret placed and nothing else touched, ProseMirror's
 * selection is position zero, so the figure must come *before* the first paragraph;
 * with no caret it must come after the last one.
 *
 * What this cannot do is place the caret mid-paragraph: that needs the DOM selection,
 * and ProseMirror then calls `getClientRects`, which jsdom does not implement. The
 * mid-text case is covered from the other side — `checkFigureInsertion` drives
 * `insertFigureAtCaret` at four caret positions on a real editor — and by the browser
 * pass.
 */
async function checkSidebarInsertion() {
  const react = await import("react");
  const { createElement } = react;
  const { createRoot } = await import("react-dom/client");
  // Imported here rather than at module load: this module pulls in `@tiptap/react`,
  // which wants a DOM, and the suite installs one inside `runRoundTrips`.
  const { ContentEditor } = await import(
    "../src/app/admin/articles/components/content-editor"
  );

  const act = typeof react.act === "function" ? react.act : null;
  const settle = async () => {
    if (act) {
      await act(async () => {});
      return;
    }
    for (let turn = 0; turn < 5; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  const mount = async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);

    let handle: ContentEditorHandle | null = null;
    let latest = "";
    const caretReports: boolean[] = [];

    await actIfNeeded(act, () => {
      root.render(
        createElement(ContentEditor as never, {
          value: "<p>Первый абзац.</p><p>Второй абзац.</p>",
          onChange: (next: string) => {
            latest = next;
          },
          onCaretChange: (placed: boolean) => caretReports.push(placed),
          ref: (instance: unknown) => {
            handle = instance as ContentEditorHandle | null;
          },
        }),
      );
    });
    await settle();

    return {
      handle: () => handle,
      html: () => latest,
      caretReports,
      surface: host.querySelector('[contenteditable="true"]') as HTMLElement | null,
      async unmount() {
        root.unmount();
        await settle();
        host.remove();
      },
    };
  };

  // --- with no caret at all: the picture goes to the end ----------------------

  const fresh = await mount();

  check(
    "Сайдбар: редактор отдаёт handle и знает, что курсора нет",
    fresh.handle() !== null && fresh.handle()!.hasCaret() === false,
    `handle: ${fresh.handle() !== null}, hasCaret: ${fresh.handle()?.hasCaret()}`,
  );

  const withoutCaret = fresh.handle()!.insertPhoto("/uploads/side.webp", "Из панели");
  await settle();

  check(
    "Сайдбар: без курсора фото уходит в конец текста",
    withoutCaret === "end" &&
      fresh.html().trimEnd().endsWith(figureHtml("/uploads/side.webp", "Из панели")),
    `размещение ${withoutCaret}: ${fresh.html().slice(-120)}`,
  );

  await fresh.unmount();

  // --- with a caret placed: the picture follows the selection -----------------

  const placed = await mount();

  /*
    A click on a sidebar button takes the focus away from the editor, so the flag has to
    survive a blur — which is why it is set on the first focus rather than read from
    `isFocused` at click time. The synthetic event is what the suite can do here; the
    real browser pass covers the rest.
  */
  if (placed.surface) {
    await actIfNeeded(act, () => {
      placed.surface!.dispatchEvent(new Event("focus"));
    });
    await settle();
  }

  check(
    "Сайдбар: после установки курсора редактор это помнит",
    placed.handle()!.hasCaret() === true && placed.caretReports.includes(true),
    `hasCaret: ${placed.handle()?.hasCaret()}, отчёты: ${JSON.stringify(placed.caretReports)}`,
  );

  const withCaret = placed.handle()!.insertPhoto("/uploads/caret.webp", "");
  await settle();

  check(
    "Сайдбар: с курсором фото встаёт по каретке, а не в конец",
    withCaret === "caret" &&
      placed.html().indexOf("caret.webp") < placed.html().indexOf("Первый абзац"),
    `размещение ${withCaret}: ${placed.html().slice(0, 140)}`,
  );

  await placed.unmount();
}

/** Runs a state-updating callback inside `act` when React exports one. */
async function actIfNeeded(
  act: typeof import("react").act | null,
  run: () => void,
): Promise<void> {
  if (act) {
    await act(async () => {
      run();
    });
    return;
  }
  run();
}

/**
 * Inserting a photo at the caret.
 *
 * The two failures this guards are both invisible in a screenshot and obvious to a
 * writer: the caret ending up *inside* the caption, so the next sentence becomes part
 * of the caption, and a stray empty paragraph left between the picture and the text
 * that followed it, which publishes as a blank line. Both were measured against a real
 * editor before the insertion helper was written, and both are what the obvious
 * one-liner produces.
 */
/** The editor type, resolved from the package rather than imported at module load. */
type TipTapEditor = import("@tiptap/core").Editor;

function checkFigureInsertion(make: (content: string) => TipTapEditor) {
  const cases: { label: string; html: string; caret: number }[] = [
    { label: "в конец абзаца", html: "<p>Абзац.</p>", caret: 7 },
    { label: "между абзацами", html: "<p>Первый.</p><p>Второй.</p>", caret: 8 },
    { label: "в середину абзаца", html: "<p>Целиком абзац.</p>", caret: 8 },
    { label: "в пустой документ", html: "<p></p>", caret: 1 },
  ];

  for (const testCase of cases) {
    const editor = make(testCase.html);
    editor.commands.setTextSelection(testCase.caret);

    insertFigureAtCaret(editor, "/uploads/check.webp", "Фото", "Подпись");

    const inserted = editorBodyHtml(editor);
    const caretParent = editor.state.selection.$from.parent.type.name;

    check(
      `Вставка фото (${testCase.label}): картинка с подписью на месте`,
      /<figure class="article-figure">/.test(inserted) &&
        /<img[^>]*src="\/uploads\/check\.webp"[^>]*alt="Фото"/.test(inserted) &&
        /<figcaption class="article-figure__caption">Подпись<\/figcaption>/.test(inserted),
      inserted,
    );

    check(
      `Вставка фото (${testCase.label}): курсор встаёт под картинкой, а не в подписи`,
      caretParent === "paragraph",
      `курсор в <${caretParent}>`,
    );

    // Type, and check the character landed below the picture rather than in the caption.
    editor.chain().focus().insertContent("ДАЛЬШЕ").run();
    const typed = editorBodyHtml(editor);

    check(
      `Вставка фото (${testCase.label}): набранный текст уходит под фото`,
      typed.indexOf("ДАЛЬШЕ") > typed.indexOf("</figure>") &&
        !/ПодписьДАЛЬШЕ/.test(typed),
      typed,
    );

    check(
      `Вставка фото (${testCase.label}): нет висячего пустого абзаца`,
      !/<\/figure><p><\/p>/.test(typed),
      /<\/figure><p><\/p>/.test(typed) ? "есть <p></p> сразу под фигурой" : "чисто",
    );

    editor.destroy();
  }

  // The empty-caption case, which is what the dialog produces when the field is left
  // blank: the caption element must still be there to click into.
  const noCaption = make("<p>Текст.</p>");
  noCaption.commands.setTextSelection(6);
  insertFigureAtCaret(noCaption, "/uploads/check.webp", "Фото", "   ");
  const withoutCaption = editorBodyHtml(noCaption);
  check(
    "Вставка фото: пустая подпись оставляет место, куда её вписать",
    /<figcaption class="article-figure__caption"><\/figcaption>/.test(withoutCaption) &&
      !/Подпись/.test(withoutCaption),
    withoutCaption,
  );
  noCaption.destroy();

  // A picture inserted into an existing quotation must not escape it. Nothing in the
  // code prevents this and the schema decides, so the outcome is recorded rather than
  // assumed.
  const insideQuote = make("<blockquote><p>Цитата</p></blockquote>");
  insideQuote.commands.setTextSelection(4);
  insertFigureAtCaret(insideQuote, "/uploads/check.webp", "Фото", "Подпись");
  const quoted = editorBodyHtml(insideQuote);
  check(
    "Вставка фото: картинка внутри цитаты остаётся внутри цитаты",
    /<blockquote>[\s\S]*<figure class="article-figure">[\s\S]*<\/blockquote>/.test(quoted),
    quoted,
  );
  insideQuote.destroy();
}

/**
 * The quotation markup, and the attribution that used to be lost.
 *
 * The toolbar's own «Цитата» command is exercised in `runCommands`; what is checked
 * here is the part that cannot be seen from the button — that a `<cite>` inside a
 * blockquote survives the schema, and that the source line is only offered inside a
 * quotation.
 */
function checkQuoteMarkup(make: (content: string) => TipTapEditor) {
  const source =
    '<blockquote><p>Цитата.</p><p><cite class="article-quote__source">— Источник</cite></p></blockquote>';
  const sanitized = sanitizeArticleHtml(source);

  check(
    "Цитата: источник доходит до витрины как <cite>",
    /<cite[^>]*>— Источник<\/cite>/.test(sanitized),
    sanitized,
  );

  check(
    "Цитата: класс источника переживает санитайзер",
    /<cite class="article-quote__source">/.test(sanitized),
    sanitized.slice(0, 170),
  );

  // The classes the caption and the figure carry are what the stylesheet selects on.
  // Asserted on the sanitiser output because a class stripped here would leave the
  // element unstyled on the live page with nothing else to notice it.
  const figure =
    '<figure class="article-figure"><img src="/uploads/a.webp" alt="Фото"><figcaption class="article-figure__caption">Подпись</figcaption></figure>';
  const renderedFigure = sanitizeArticleHtml(figure);
  check(
    "Фото: классы фигуры и подписи переживают санитайзер",
    /<figure class="article-figure">/.test(renderedFigure) &&
      /<figcaption class="article-figure__caption">/.test(renderedFigure),
    renderedFigure.slice(0, 170),
  );
  check(
    "Фото: data-URI в src по-прежнему вырезается",
    !/src="data:image/i.test(
      sanitizeArticleHtml(
        '<figure class="article-figure"><img src="data:image/png;base64,AAAA" alt="x"></figure>',
      ),
    ),
    "защита не ослаблена вместе с расширением списка",
  );

  /*
    «Источник цитаты»: what the button does, and the one case where it refuses.

    The refusal matters as much as the insertion — the action puts a paragraph inside a
    blockquote, and running it with the caret in an ordinary paragraph would split the
    sentence and leave a stray attributed line in the middle of the article.
  */
  const insideQuote = make("<blockquote><p>Цитата.</p></blockquote>");
  insideQuote.commands.setTextSelection(5);
  const added = insertQuoteSourceAtCaret(insideQuote);
  const withSource = editorBodyHtml(insideQuote);

  check(
    "Цитата: «Источник цитаты» добавляет строку внутрь цитаты",
    added &&
      /<blockquote>[\s\S]*<p><cite class="article-quote__source">— <\/cite><\/p>[\s\S]*<\/blockquote>/.test(
        withSource,
      ),
    withSource,
  );

  check(
    "Цитата: источник вставляется с тире и готов к набору",
    withSource.includes("— ") && insideQuote.state.selection.$from.parent.type.name === "paragraph",
    withSource,
  );

  // Type the attribution and check the mark carries it.
  insideQuote.chain().focus().insertContent("Пётр Иванов").run();
  check(
    "Цитата: набранный источник остаётся внутри <cite>",
    /<cite class="article-quote__source">— Пётр Иванов<\/cite>/.test(editorBodyHtml(insideQuote)),
    editorBodyHtml(insideQuote),
  );
  insideQuote.destroy();

  /*
    The order a writer actually works in: select the paragraph, press «Цитата», then
    press «Источник цитаты» — with the selection still live.

    This is the check the browser pass earned. Every earlier call to the action used a
    bare caret, and the implementation of the day inserted at the *selection range*,
    which replaces it: the quotation's own text was destroyed and only the attribution
    was left behind. Nothing in the suite could see it because nothing had a selection
    when it called the function.
  */
  const stillSelected = make("<blockquote><p>Цитата целиком.</p></blockquote>");
  stillSelected.commands.setTextSelection({ from: 2, to: 16 });
  const addedOverSelection = insertQuoteSourceAtCaret(stillSelected);
  const afterSelection = editorBodyHtml(stillSelected);

  check(
    "Цитата: источник не стирает выделенный текст цитаты",
    addedOverSelection &&
      afterSelection.includes("Цитата целиком.") &&
      afterSelection.includes(">— </cite>"),
    afterSelection,
  );

  check(
    "Цитата: источник встаёт после цитаты, а не вместо неё",
    afterSelection.indexOf("Цитата целиком.") < afterSelection.indexOf("cite"),
    afterSelection,
  );
  stillSelected.destroy();

  const outsideQuote = make("<p>Обычный абзац.</p>");
  outsideQuote.commands.setTextSelection(5);
  const refused = insertQuoteSourceAtCaret(outsideQuote);
  check(
    "Цитата: вне цитаты источник не вставляется",
    refused === false && editorBodyHtml(outsideQuote) === "<p>Обычный абзац.</p>",
    editorBodyHtml(outsideQuote),
  );
  outsideQuote.destroy();
}

/**
 * The toolbar's actual commands, on a real editor.
 *
 * The round trip above proves nothing is lost; this proves the controls do
 * something. Rendered markup alone cannot show that — a button wired to a command
 * that does not exist still renders perfectly.
 */
function runCommands(make: (content: string) => import("@tiptap/core").Editor) {
  const select = (from: number, to: number) => ({ from, to });

  const bold = make("<p>Слово</p>");
  bold.chain().focus().setTextSelection(select(1, 6)).toggleBold().run();
  check(
    "Команда: toggleBold оборачивает выделение",
    /<strong[^>]*>Слово<\/strong>/.test(bold.getHTML()),
    bold.getHTML(),
  );
  bold.destroy();

  const italic = make("<p>Слово</p>");
  italic.chain().focus().setTextSelection(select(1, 6)).toggleItalic().run();
  check(
    "Команда: toggleItalic оборачивает выделение",
    /<em[^>]*>Слово<\/em>/.test(italic.getHTML()),
    italic.getHTML(),
  );
  italic.destroy();

  const underline = make("<p>Слово</p>");
  underline.chain().focus().setTextSelection(select(1, 6)).toggleUnderline().run();
  check(
    "Команда: toggleUnderline работает, хотя не входит в StarterKit",
    /<u[^>]*>Слово<\/u>/.test(underline.getHTML()),
    underline.getHTML(),
  );
  underline.destroy();

  const heading = make("<p>Заголовок</p>");
  heading.chain().focus().toggleHeading({ level: 2 }).run();
  const headingHtml = heading.getHTML();
  check(
    "Команда: toggleHeading даёт h2 и отмечает нужную кнопку",
    /<h2[^>]*>Заголовок<\/h2>/.test(headingHtml) &&
      heading.isActive("heading", { level: 2 }) &&
      !heading.isActive("heading", { level: 3 }),
    headingHtml,
  );
  heading.destroy();

  const quote = make("<p>Цитата</p>");
  quote.chain().focus().toggleBlockquote().run();
  check(
    "Команда: toggleBlockquote оборачивает абзац",
    /<blockquote[^>]*>[\s\S]*Цитата[\s\S]*<\/blockquote>/.test(quote.getHTML()),
    quote.getHTML(),
  );
  quote.destroy();

  const lists = make("<p>Пункт</p>");
  lists.chain().focus().toggleBulletList().run();
  const bullet = lists.getHTML();
  lists.chain().focus().toggleBulletList().toggleOrderedList().run();
  const ordered = lists.getHTML();
  check(
    "Команда: маркированный и нумерованный списки",
    /<ul[^>]*>[\s\S]*Пункт/.test(bullet) &&
      /<ol[^>]*>[\s\S]*Пункт/.test(ordered),
    `${bullet} | ${ordered}`,
  );
  lists.destroy();

  const align = make("<p>Текст</p>");
  align.chain().focus().setTextAlign("center").run();
  check(
    "Команда: setTextAlign пишет style, который читает и санитайзер",
    /text-align:\s*center/i.test(align.getHTML()) &&
      /text-align:\s*center/i.test(sanitizeArticleHtml(align.getHTML())),
    align.getHTML(),
  );
  align.destroy();

  const link = make("<p>релиз</p>");
  link
    .chain()
    .focus()
    .setTextSelection(select(1, 6))
    .extendMarkRange("link")
    .setLink({ href: "/news/abc", target: "_blank", rel: "noopener noreferrer" })
    .run();
  const linkHtml = link.getHTML();
  check(
    "Команда: setLink вешает ссылку на выделение целиком",
    /<a[^>]*href="\/news\/abc"[^>]*>релиз<\/a>/.test(linkHtml),
    linkHtml,
  );
  check(
    "Команда: ссылка выглядит ссылкой прямо в редакторе",
    linkHtml.includes("underline") && linkHtml.includes("text-amber-600"),
    linkHtml,
  );
  check(
    "Команда: link.isActive отмечает кнопку «Ссылка»",
    link.isActive("link"),
    linkHtml,
  );

  // unsetLink is what the dialog's empty-URL branch calls, and the only way an
  // editor takes a link off a word.
  link.chain().focus().extendMarkRange("link").unsetLink().run();
  check(
    "Команда: unsetLink снимает ссылку, а не оставляет пустой тег",
    !link.getHTML().includes("<a") && link.getHTML().includes("релиз"),
    link.getHTML(),
  );
  link.destroy();

  // A link with no target is what the old markup produced, and the storefront turns
  // it into target="_blank". So the mark has to carry the target itself, or the
  // dialog's "new tab" checkbox would do nothing on the page.
  const sameTab = make("<p>текст</p>");
  sameTab
    .chain()
    .focus()
    .setTextSelection(select(1, 6))
    .setLink({ href: "https://e.test", target: "_self" })
    .run();
  check(
    "Ссылка: «новая вкладка» выключена — явный _self",
    /target="_self"/.test(sameTab.getHTML()),
    sameTab.getHTML(),
  );
  check(
    "Ссылка: внутренняя ссылка не помечается nofollow",
    !/nofollow/.test(sameTab.getHTML()),
    sameTab.getHTML(),
  );
  sameTab.destroy();

  // Typing at the edge of a link. With the mark's default `inclusive` behaviour this
  // produced <a>рели后续з</a> — the new characters joined the link with nothing on
  // screen to say so, and would have been published that way.
  const afterLink = make('<p><a href="/news/abc" target="_blank">релиз</a></p>');
  afterLink.commands.insertContentAt(
    afterLink.state.doc.content.size - 1,
    " потом",
  );
  const afterLinkHtml = afterLink.getHTML();
  check(
    "Ссылка: текст после ссылки не становится её частью",
    afterLinkHtml.includes("релиз") &&
      afterLinkHtml.includes("потом") &&
      !/<a[^>]*>[^<]*потом/.test(afterLinkHtml),
    afterLinkHtml,
  );

  // The same at the leading edge, where the other trap sits.
  const beforeLink = make('<p><a href="/news/abc" target="_blank">релиз</a></p>');
  beforeLink.commands.insertContentAt(1, "начало ");
  const beforeLinkHtml = beforeLink.getHTML();
  check(
    "Ссылка: текст перед ссылкой не становится её частью",
    !/<a[^>]*>начало/.test(beforeLinkHtml),
    beforeLinkHtml,
  );

  // The link is still editable: selecting across it and applying the mark extends it
  // deliberately, which is how a link gets longer after all.
  const extended = make('<p><a href="/news/abc" target="_blank">релиз</a></p>');
  extended
    .chain()
    .focus()
    .setTextSelection({ from: 1, to: 8 })
    .setLink({ href: "/news/abc", target: "_blank" })
    .run();
  check(
    "Ссылка: выделенный текст всё ещё можно сделать ссылкой",
    /<a[^>]*href="\/news\/abc"[^>]*>[^<]*релиз/.test(extended.getHTML()),
    extended.getHTML(),
  );

  // Plain text is plain: no mark, no colour class, in a fresh paragraph.
  const plain = make("<p></p>");
  plain.commands.insertContent("Привет мир");
  check(
    "Ссылка: обычный текст не получает оформление ссылки",
    plain.getHTML() === "<p>Привет мир</p>",
    plain.getHTML(),
  );

  const video = make("<p>До</p>");
  video
    .chain()
    .focus()
    .insertContent({
      type: "videoEmbed",
      attrs: { src: "https://rutube.ru/play/embed/abc123" },
    })
    .run();
  const videoHtml = video.getHTML();
  check(
    "Команда: вставка видео даёт figure с iframe, как buildVideoEmbed",
    /<figure class="video-embed">/.test(videoHtml) &&
      /<iframe[^>]*src="https:\/\/rutube\.ru\/play\/embed\/abc123"/.test(videoHtml),
    videoHtml,
  );
  video.destroy();

  // A frame pasted from a site we do not embed. The sanitiser would strip it at
  // render time, but the editor must not frame it either: sanitising the stored HTML
  // says nothing about what runs on the admin origin while someone is editing.
  const foreign = make(
    '<p>До</p><iframe src="https://evil.example/steal"></iframe><p>После</p>',
  );
  check(
    "Видео: чужой iframe не превращается в узел редактора",
    !foreign.getHTML().includes("evil.example"),
    foreign.getHTML(),
  );
  foreign.destroy();

  // The link extension validates protocols, and the sanitiser blocks them again at
  // render. Both are asserted because they are independent guarantees and either
  // one alone would do.
  const scripted = make("<p>нажми</p>");
  scripted
    .chain()
    .focus()
    .setTextSelection(select(1, 6))
    .setLink({ href: "javascript:alert(1)" })
    .run();
  const scriptedHtml = scripted.getHTML();
  check(
    "Ссылка: javascript: не доходит до витрины",
    !sanitizeArticleHtml(scriptedHtml).includes("javascript:"),
    sanitizeArticleHtml(scriptedHtml),
  );
  scripted.destroy();

  // Attribute injection through the href. The markup builder this editor used to call
  // escaped quotes by hand and is gone; the guarantee has to be asserted where the
  // value is written now, which is the mark. TipTap serialises through the DOM, so the
  // quote is escaped rather than closing the attribute — and the sanitiser drops the
  // handler outright.
  const injected = make("<p>клик</p>");
  injected
    .chain()
    .focus()
    .setTextSelection(select(1, 5))
    .setLink({ href: '/x" onmouseover="alert(1)' })
    .run();
  const injectedHtml = injected.getHTML();
  // Parsed rather than pattern-matched: `onmouseover=&quot;` inside an href value is
  // escaped text, not an attribute, and a substring search cannot tell those apart.
  const probe = document.createElement("div");
  probe.innerHTML = sanitizeArticleHtml(injectedHtml);
  check(
    "Ссылка: кавычка в адресе не превращается в обработчик события",
    probe.querySelectorAll("[onmouseover]").length === 0 &&
      probe.querySelector("a")?.getAttribute("href") ===
        '/x" onmouseover="alert(1)',
    injectedHtml,
  );
  injected.destroy();
}

/**
 * The component itself, mounted for real.
 *
 * The round trip proves the schema; it says nothing about whether `<ContentEditor>`
 * comes up at all. That path has its own traps and none of them show up in rendered
 * markup: `useEditor` defers creation until the client, so a server render produces
 * no editing surface whatsoever, and the toolbar's pressed state depends on an editor
 * that does not exist yet.
 *
 * Mounted into jsdom with effects flushed, so what is checked is what a browser gets.
 */
async function runMountedEditor() {
  const react = await import("react");
  const { createElement } = react;
  const { createRoot } = await import("react-dom/client");
  const { ContentEditor } = await import(
    "../src/app/admin/articles/components/content-editor"
  );

  // `act` is exported only by React's development build, and NODE_ENV decides which
  // bundle Node resolves. Rather than depend on it, render and then give React a few
  // turns to settle — enough for the assertion below, and correct under either build.
  const act = typeof react.act === "function" ? react.act : null;
  if (act) {
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
      true;
  }
  const settle = async () => {
    if (act) {
      await act(async () => {});
      return;
    }
    for (let turn = 0; turn < 5; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  const render = async (value: string) => {
    if (act) {
      await act(async () => {
        root.render(
          createElement(ContentEditor as never, {
            value,
            onChange: () => {},
          }),
        );
      });
      return;
    }
    root.render(
      createElement(ContentEditor as never, { value, onChange: () => {} }),
    );
    await settle();
  };

  await render("<h2>Заголовок</h2><p>Текст материала</p>");

  const surfaces = host.querySelectorAll('[contenteditable="true"]');
  check(
    "Компонент: редактируемая поверхность появляется при монтировании",
    surfaces.length === 1,
    `поверхностей: ${surfaces.length}`,
  );

  const surface = surfaces[0];
  check(
    "Компонент: оформление редактора совпадает с витриной",
    Boolean(
      surface?.className.includes("article-body") &&
        surface.className.includes("prose"),
    ),
    surface?.className ?? "",
  );
  check(
    "Компонент: сохранённый текст загружен в редактор, а не потерян",
    Boolean(
      surface?.querySelector("h2")?.textContent === "Заголовок" &&
        surface.textContent?.includes("Текст материала"),
    ),
    (surface?.innerHTML ?? "").slice(0, 180),
  );

  // The path that matters for an editor at work: a restored snapshot or a body
  // generated by the AI tools replaces `value` from outside, and the surface has to
  // follow it. A controlled textarea did this for free; a rich-text editor does not.
  await render("<p>Текст из снимка</p>");
  check(
    "Компонент: внешнее значение переносится в редактор",
    Boolean(
      surface?.textContent?.includes("Текст из снимка") &&
        !surface.textContent?.includes("Текст материала"),
    ),
    (surface?.innerHTML ?? "").slice(0, 180),
  );

  await render("<p>Текст материала</p><p>Ещё абзац</p>");
  check(
    "Компонент: повторная смена значения не оставляет прежний текст",
    Boolean(
      surface?.textContent?.includes("Ещё абзац") &&
        !surface.textContent?.includes("Текст из снимка"),
    ),
    (surface?.innerHTML ?? "").slice(0, 180),
  );

  root.unmount();
  await settle();
  host.remove();
}

/**
 * The Metrika counter.
 *
 * Its `<Script>` tag cannot be asserted here: `next/script` emits nothing under a bare
 * `renderToStaticMarkup` — measured, it renders zero characters — because the inline
 * code is hoisted by the App Router's own render pipeline. The live tag is therefore
 * checked against the served page, and what is asserted here is the part that has to
 * be right regardless: the noscript pixel, the snippet's contents, the id validation,
 * and that the counter is wired into the public layout and not the editorial one.
 */
function checkMetrika() {
  const pixel = renderToStaticMarkup(createElement(MetrikaNoScript, { id: "113536956" }));

  check(
    "Метрика: пиксель без JS ведёт на счётчик",
    pixel.includes("https://mc.yandex.ru/watch/113536956"),
    pixel.slice(0, 120),
  );
  check(
    "Метрика: пиксель обёрнут в noscript",
    pixel.startsWith("<noscript>") && pixel.endsWith("</noscript>"),
    "иначе он грузился бы всем подряд и считал бы вдвое",
  );
  check(
    "Метрика: пиксель уведён за экран и не имеет alt-текста",
    pixel.includes("left:-9999px") && pixel.includes('alt=""'),
    "декоративная картинка не попадает в озвучку скринридером",
  );

  const snippet = metrikaSnippet("113536956", true);
  check(
    "Метрика: сниппет — официальный загрузчик",
    snippet.includes("https://mc.yandex.ru/metrika/tag.js") &&
      snippet.includes('(window, document, "script"') &&
      snippet.includes('"ym"'),
    "адрес тега и имя глобальной функции на месте",
  );
  check(
    "Метрика: в сниппет подставлен номер счётчика",
    snippet.includes('ym(113536956, "init"'),
    "номер передан в init",
  );
  check(
    "Метрика: вебвизор включается и выключается флагом",
    metrikaSnippet("1", true).includes("webvisor:true") &&
      metrikaSnippet("1", false).includes("webvisor:false"),
    "булево значение, а не строка",
  );
  check(
    "Метрика: остальные опции счётчика как в документации",
    snippet.includes("clickmap:true") &&
      snippet.includes("trackLinks:true") &&
      snippet.includes("accurateTrackBounce:true"),
    "карта кликов, внешние ссылки, точный отказ",
  );

  /*
    The validation is a security boundary, not a nicety: the id is interpolated into
    JavaScript inside a `<script>`, and React does not escape script children. An id
    taken from the environment is otherwise a way to append code to every public page.
  */
  check(
    "Метрика: номер счётчика проверяется перед подстановкой",
    isValidMetrikaId("113536956") &&
      !isValidMetrikaId("1);alert(1);//") &&
      !isValidMetrikaId("") &&
      !isValidMetrikaId(null) &&
      !isValidMetrikaId(" 12 "),
    "только цифры, без пробелов и скобок",
  );

  /*
    The counter must measure readers, not editors. Asserted against the source because
    the mistake is a one-line move between layouts and it is invisible on the site: the
    counter keeps working, it just counts the newsroom as well, and those visits land
    in the same report as the audience numbers.
  */
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

  const publicLayout = read("../src/app/(public)/layout.tsx");
  const rootLayout = read("../src/app/layout.tsx");
  const adminLayout = read("../src/app/admin/layout.tsx");

  check(
    "Метрика: счётчик подключён в витринном layout",
    publicLayout.includes("YandexMetrika"),
    "(public)/layout.tsx",
  );
  check(
    "Метрика: счётчика нет в корневом layout",
    !rootLayout.includes("YandexMetrika") && !rootLayout.includes("mc.yandex.ru"),
    "иначе он считал бы и админку",
  );
  check(
    "Метрика: счётчика нет в layout админки",
    !adminLayout.includes("YandexMetrika") && !adminLayout.includes("mc.yandex.ru"),
    "редакционные визиты — не аудитория",
  );
}

function report() {
  for (const { name, ok, detail } of checks) {
    console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} проверок пройдено`,
  );
  process.exitCode = failed.length > 0 ? 1 : 0;
}

runRoundTrips()
  .then(checkMetrika)
  .then(report)
  .catch((error: unknown) => {
    console.error("проверки редактора не выполнены:", error);
    process.exitCode = 1;
});
