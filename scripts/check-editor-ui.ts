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

import { MediaEditor } from "../src/app/admin/articles/components/media-editor";
import { TitleField } from "../src/app/admin/articles/components/title-field";
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

/** createElement, not a direct call: these are function components using hooks. */
const render = (Component: never, props: object) =>
  renderToStaticMarkup(createElement(Component, props));

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

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail}`);
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 ? 1 : 0;