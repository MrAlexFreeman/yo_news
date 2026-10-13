"use client";

import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Умная полоса чтения — узкая лента под компактной шапкой, как у The Verge и Axios.
 *
 * Появляется только когда мачта уже уехала (после 300px прокрутки) и прячется, когда читатель
 * листает вниз, — возвращается, когда он листает вверх (ищет, где остановился). Над полосой —
 * тончайшая линия прогресса чтения по самой статье, а внутри — заголовок, расчётное время и
 * кнопка «Поделиться» в Telegram.
 *
 * Всё дешёвое: прогресс считается в `requestAnimationFrame`, ширина линии — через `transform`,
 * чтобы браузер не пересчитывал раскладку на каждый скролл. Никакой тяжёлой логики и никакого
 * влияния на бандл сверх одного маленького клиентского компонента.
 */

const SCROLL_THRESHOLD = 300;
const HEADER_HEIGHT = 52;

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

    const measure = () => {
      frame = null;
      const y = window.scrollY;

      // Направление прокрутки решает видимость: вверх — показать (читатель ищет место), вниз —
      // спрятать (не мешать читать). Ниже порога полосы нет вовсе.
      if (y <= SCROLL_THRESHOLD) {
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

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    measure();

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [targetId]);

  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(articleUrl)}&text=${encodeURIComponent(title)}`;

  return (
    <div
      className={`fixed left-0 right-0 z-30 bg-paper/95 backdrop-blur border-b border-rule/60 transition-transform duration-300 ${
        visible ? "translate-y-0" : "-translate-y-full"
      }`}
      style={{ top: HEADER_HEIGHT }}
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
