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

// --- Settings form ----------------------------------------------------------
const settingsDefaults = {
  deepseekApiKey: { isSet: false, masked: "", source: "unset" as const },
  deepinfraApiKey: { isSet: false, masked: "", source: "unset" as const },
  vkAccessToken: { isSet: false, masked: "", source: "unset" as const },
};

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
  (settingsEmptyHtml.match(/type="password"/g) ?? []).length === 3 &&
    !/value="sk-/.test(settingsFilledHtml),
  "три password без значения",
);
check(
  "Настройки: кнопка показа/скрытия у каждого поля",
  (settingsFilledHtml.match(/aria-label="Показать ключ"/g) ?? []).length === 3,
  "3 кнопки",
);
// Counted as buttons, not as a substring: the explanatory section below the form
// mentions the same phrase in prose.
check(
  "Настройки: «Тест подключения» у каждого поля",
  (settingsFilledHtml.match(/>Тест подключения<\/button>/g) ?? []).length === 2,
  "2 кнопки",
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
  (settingsFilledHtml.match(/type="password"/g) ?? []).length === 3 &&
    (settingsFilledHtml.match(/aria-label="Показать ключ"/g) ?? []).length === 3,
  "три поля",
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
  "Выравнивание по левому краю",
  "Выравнивание по центру",
  "Выравнивание по правому краю",
  "Выравнивание по ширине",
  "Маркированный список",
  "Нумерованный список",
  "Таблица",
  "Ссылка (Ctrl+K)",
  "Видео",
  "Изображение",
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

  runCommands(make);
  await runMountedEditor();
  report();
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

runRoundTrips().catch((error: unknown) => {
  console.error("проверки редактора не выполнены:", error);
  process.exitCode = 1;
});
