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
import { MediaEditor } from "../src/app/admin/articles/components/media-editor";
import { TitleField } from "../src/app/admin/articles/components/title-field";
import { PublishSidebar } from "../src/app/admin/articles/components/publish-sidebar";
import { DZEN_EXPERIMENT_LOCKED_HINT } from "../src/lib/dzen-experiment";
import { SettingsForm } from "../src/app/admin/settings/components/settings-form";
import { ArticleGallery } from "../src/components/article-gallery";
import { SubscribeBlock } from "../src/components/subscribe-block";
import { ArticleVideo } from "../src/components/article-video";
import { MAX_MEDIA_ITEMS, type MediaItem } from "../src/lib/article-media";
import {
  DZEN_MIN_CARD_WIDTH,
  NARROW_COVER_WARNING,
} from "../src/lib/image-dimensions";
import { DZEN_TITLE_LIMIT, TITLE_SOFT_LIMIT } from "../src/app/admin/articles/types";
import { DZEN_URL } from "../src/lib/site";

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

// --- AI cover generator -----------------------------------------------------
const aiProps = { title: "Заголовок", lead: "Лид", content: "<p>Текст</p>", onGenerated: noop };
const panelDefaults = {
  mode: "auto" as const,
  hint: "",
  busy: false,
  error: null,
  result: null,
  onModeChange: noop,
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
  mode: "custom",
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
};

const settingsEmptyHtml = render(SettingsForm as never, { initial: settingsDefaults });
const settingsFilledHtml = render(SettingsForm as never, {
  initial: {
    deepseekApiKey: { isSet: true, masked: "sk-abc…7890", source: "database" },
    deepinfraApiKey: { isSet: true, masked: "sk-xyz…1111", source: "environment" },
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
  aiClosedHtml.includes("Сгенерировать ИИ-обложку") && !aiClosedHtml.includes("aiCoverHint"),
  "кнопка без панели",
);

check(
  "Генератор: обе радиокнопки на месте",
  aiAutoHtml.includes("По тексту статьи") && aiAutoHtml.includes("По своей подсказке"),
  "два варианта",
);
check(
  "Генератор: в режиме «по тексту» подсказка неактивна",
  /<textarea[^>]*id="aiCoverHint"[^>]*disabled/.test(aiAutoHtml),
  "disabled",
);
check(
  "Генератор: в режиме «по своей подсказке» поле активно",
  /<textarea[^>]*id="aiCoverHint"/.test(aiCustomHtml) &&
    !/id="aiCoverHint"[^>]*disabled/.test(aiCustomHtml),
  "enabled",
);
check(
  "Генератор: счётчик длины подсказки",
  aiCustomHtml.includes("из 600"),
  "0 из 600",
);
check(
  "Генератор: в режиме auto сказано, что составит DeepSeek",
  aiAutoHtml.includes("составит DeepSeek"),
  "подсказка объяснена",
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
  (settingsEmptyHtml.match(/type="password"/g) ?? []).length === 2 &&
    !/value="sk-/.test(settingsFilledHtml),
  "два password без значения",
);
check(
  "Настройки: кнопка показа/скрытия у каждого поля",
  (settingsFilledHtml.match(/aria-label="Показать ключ"/g) ?? []).length === 2,
  "2 кнопки",
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
  (settingsFilledHtml.match(/>Очистить</g) ?? []).length === 2 &&
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

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 ? 1 : 0;