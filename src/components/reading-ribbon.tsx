"use client";

import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Умная полоса чтения — узкая лента под компактной шапкой, как у The Verge и Axios.
 *
 * Появляется только когда мачта уже уехала и заголовок остался позади, и прячется, когда читатель
 * листает вниз, — возвращается, когда он листает вверх (ищет, где остановился). Над полосой —
 * тончайшая линия прогресса чтения по самой статье, а внутри — заголовок, расчётное время и
 * кнопка «Поделиться» в Telegram.
 *
 * Всё дешёвое: прогресс считается в `requestAnimationFrame`, ширина линии — через `transform`,
 * чтобы браузер не пересчитывал раскладку на каждый скролл. Никакой тяжёлой логики и никакого
 * влияния на бандл сверх одного маленького клиентского компонента.
 */

/**
 * Высота компактной шапки вместе с её нижней линией-разделителем: `h-[52px]` плюс `border-b`
 * в `header-shell.tsx`. Слагаемое неочевидно, но замерено: с чистым 52px верхняя строка полосы
 * уходила под бордюр шапки, и двухпиксельная линия прогресса читалась как однопиксельная
 * (`gapUnderBar: -1` в замере). Разъехаться эти числа не должны: ошибёшься вниз — полоса вылезет
 * из-под шапки, вверх — повиснет под ней полосой пустого фона.
 */
const COMPACT_HEADER_HEIGHT = "53px";

/**
 * Верх полосы. Безопасный отступ сверху: в Android-приложении шапка начинается из-под системной
 * строки статуса, и без того же слагаемого полоса наехала бы на неё. `env()` вне жестового
 * режима даёт 0.
 */
const RIBBON_TOP = `calc(${COMPACT_HEADER_HEIGHT} + env(safe-area-inset-top))`;

/**
 * Скрытое положение — выше верхней кромки экрана **целиком**.
 *
 * `-translate-y-full` здесь недостаточно, и это была настоящая поломка: сдвиг на собственную
 * высоту (39px) при `top: 52px` оставляет полосу на 13..52px экрана, то есть ровно поверх строки
 * даты, погоды и курса ЦБ (0..29px). Замер на статье: `ribbonTop: 13, ribbonBottom: 52,
 * overlapWithStrip: true` при нулевом скролле. Сдвигать нужно на собственную высоту **плюс
 * `top`** — тогда нижняя кромка встаёт в 0 и полоса действительно уходит за экран.
 */
const RIBBON_HIDDEN = `translateY(calc(-100% - ${COMPACT_HEADER_HEIGHT} - env(safe-area-inset-top)))`;

/**
 * Порог, с которого полоса вообще имеет право появиться.
 *
 * Считается по документу, а не зашитым числом. Мачта на телефоне и на десктопе разной высоты —
 * на телефоне скрыты и подпись под логотипом, и строка курсов, — поэтому «450px» из задания на
 * одном экране срабатывает уже в теле статьи, а на другом посреди заголовка. Замер этой страницы:
 * шапка 179px, полоса тем 219px, заголовок 308..387px. Порог берётся по низу того, что читатель
 * видит первым: шапка сайта, полоса тем сразу под ней и заголовок материала. Пока хоть что-то из
 * этого на экране, полоса молчит — она не имеет права закрывать мачту или заголовок.
 */
function measureThreshold(): number {
  const bottom = (element: Element | null) =>
    element ? element.getBoundingClientRect().bottom + window.scrollY : 0;

  const header = document.querySelector("header");
  /*
    Полоса тем лежит сразу за `<header>` и визуально его продолжает, но в разметке это сосед.
    Проверка на `MAIN` — на случай, когда тем у выпуска нет вовсе: тогда соседом шапки
    оказывается основное содержимое страницы, и брать его низ за порог было бы ошибкой.
  */
  const afterHeader = header?.nextElementSibling;
  const strip = afterHeader && afterHeader.tagName !== "MAIN" ? afterHeader : null;
  const headline = document.querySelector("h1");

  return Math.max(bottom(header), bottom(strip), bottom(headline));
}

export function ReadingRibbon({
  title,
  minutes,
  articleUrl,
  targetId = "article",
}: {
  title: string;
  minutes: number;
  articleUrl: string;
  /** Элемент, по высоте которого считается прогресс чтения. */
  targetId?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const lastY = useRef(0);

  useEffect(() => {
    let frame: number | null = null;

    /*
      Порог пересчитывается на `resize`: поворот телефона меняет высоту мачты, и застывший
      порог открывал бы полосу поверх неё. Пересчёт на каждый кадр прокрутки не нужен —
      `getBoundingClientRect` на трёх элементах в каждом кадре вернул бы ту самую пересборку
      раскладки, ради ухода от которой прогресс считается через `transform`. Расхождение на
      несколько пикселей после подстановки шрифта полосе не вредит: сдвиг порога на десять
      пикселей вниз не поднимает её к мачте, потому что порог всё равно ниже её низа.
    */
    let threshold = measureThreshold();

    const measure = () => {
      frame = null;
      const y = window.scrollY;

      // Направление прокрутки решает видимость: вверх — показать (читатель ищет место), вниз —
      // спрятать (не мешать читать). Пока читатель не прошёл мачту и заголовок, полосы нет вовсе.
      if (y <= threshold) {
        setVisible(false);
      } else if (y < lastY.current - 4) {
        setVisible(true);
      } else if (y > lastY.current + 4) {
        setVisible(false);
      }
      lastY.current = y;

      const article = document.getElementById(targetId);
      if (article) {
        const total = article.offsetHeight;
        const viewport = window.innerHeight;
        const readable = total - viewport;
        const top = article.getBoundingClientRect().top;
        const scrolled = Math.max(0, Math.min(-top, readable));
        setProgress(readable > 0 ? scrolled / readable : 0);
      }
    };

    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(measure);
    };

    const onResize = () => {
      threshold = measureThreshold();
      schedule();
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", onResize);
    measure();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", onResize);
    };
  }, [targetId]);

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(articleUrl)}&text=${encodeURIComponent(title)}`;

  return (
    <div
      /*
        Скрытая полоса полностью за экраном, поэтому `opacity-0` не нужен — он превратил бы
        выезд в проявление. Доступность закрывает `inert`: скрытая полоса не должна ловить
        таб и читаться скринридером, как весь остальной невидимый хром сайта.
      */
      inert={visible ? undefined : true}
      className={[
        "fixed left-0 right-0 z-30 border-b border-rule/60 bg-paper/95 backdrop-blur",
        "transition-transform duration-300 ease-out motion-reduce:transition-none",
        /* `pointer-events-none` на время выезда: пока полоса идёт через верх экрана, она не
           должна перехватывать клики по мачте под ней. */
        visible ? "pointer-events-auto" : "pointer-events-none",
      ].join(" ")}
      style={{
        top: RIBBON_TOP,
        transform: visible ? "translateY(0)" : RIBBON_HIDDEN,
      }}
    >
      {/* Тончайшая линия прогресса. `transform` вместо `width`, чтобы не пересчитывать layout. */}
      <div className="h-[2px] bg-yo" aria-hidden>
        <div
          className="h-full origin-left bg-yo"
          style={{ transform: `scaleX(${progress})`, transition: "transform 120ms linear" }}
        />
      </div>

      <div className="flex h-9 items-center justify-between gap-4 px-4 text-xs">
        <span className="truncate max-w-[60%] font-[family-name:var(--font-lora)] font-bold text-ink">
          {title}
        </span>

        <div className="flex shrink-0 items-center gap-3">
          <span className="tabular-nums text-ink-soft">~{minutes} мин чтения</span>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-yo/10 px-2.5 py-1 font-semibold text-yo-ink transition-colors hover:bg-yo/20"
          >
            <Send className="size-3.5" aria-hidden />
            Поделиться
          </a>
        </div>
      </div>
    </div>
  );
}
