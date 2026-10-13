"use client";

import { useEffect, useState } from "react";

/**
 * Тонкая линия прогресса чтения под компактной шапкой.
 *
 * Показывает, сколько материала читатель уже прошёл. Одна линия, а не процент и не индикатор с
 * цифрами: цель — ощущение «я на 60%», а не число, которое надо прочесть. Тонкая (2px) и в
 * акцентном цвете, чтобы её было видно, но чтобы она не спорила с шапкой, под которой висит.
 *
 * Позиция `top: 52px` — ровно высота компактной шапки (`header-shell.tsx`). Шапка `fixed`
 * появляется только после 120px прокрутки, и к этому моменту прогресс уже больше нуля, поэтому
 * линия никогда не висит посреди мачты: при нулевом прогрессе заполнение имеет нулевую ширину и
 * невидимо.
 *
 * Прогресс считается по высоте самой статьи, а не всей страницы: футер и сайдбар читатель не
 * «читает», и линия должна дойти до конца ровно тогда, когда он дочитал материал, а не когда
 * домотал страницу до подписки внизу.
 */
export function ReadingProgress({ targetId }: { targetId: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame: number | null = null;

    const measure = () => {
      frame = null;
      const article = document.getElementById(targetId);
      if (!article) return;

      const total = article.offsetHeight;
      const viewport = window.innerHeight;
      // Сколько из статьи ещё прокручивается: статья ниже высоты окна.
      const readable = total - viewport;
      if (readable <= 0) {
        setProgress(0);
        return;
      }

      // `rect.top` уходит в минус по мере прокрутки; насколько статья ушла за верх окна.
      const top = article.getBoundingClientRect().top;
      const scrolled = Math.max(0, Math.min(-top, readable));
      setProgress(scrolled / readable);
    };

    const schedule = () => {
      // `requestAnimationFrame`, а не прямой подсчёт: событие scroll приходит чаще кадра, и
      // пересчитывать чаще, чем браузер рисует, — работа впустую.
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

  return (
    <div
      aria-hidden
      // Зазор 1px под шапкой — не промах по границе: линия отделена от линии-бордера шапки, а
      // не сливается с ней. `z-40` ниже `z-50` шапки, чтобы при скролле линия уходила под неё,
      // а не рисовалась поверх.
      className="fixed inset-x-0 z-40 h-[2px]"
      style={{ top: "53px" }}
    >
      {/*
        `transform` вместо `width`: изменение ширины заставляет браузер пересчитывать layout на
        каждый скролл, изменение transform — только композицию. Линия должна быть дешёвой.
      */}
      <div
        className="h-full origin-left bg-accent"
        style={{
          transform: `scaleX(${progress})`,
          transition: "transform 120ms linear",
        }}
      />
    </div>
  );
}
