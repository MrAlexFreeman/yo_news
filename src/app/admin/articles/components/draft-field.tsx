"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CharCounter } from "@/app/admin/articles/components/char-counter";

/**
 * Значение поля, которое держит набранное у себя и отдаёт наверх по потере фокуса.
 *
 * **Зачем.** Все текстовые поля формы держали значение в состоянии `ArticleForm`, а форма — это
 * родитель `ContentEditor`. Замер по коду 13 октября: набранная буква в заголовке вызывала
 * `setTitle`, перерисовку всей формы и вместе с ней панели инструментов редактора — сорок
 * кнопок и весь текст статьи. Набор заголовка в сорок символов — сорок перерисовок Tiptap.
 *
 * Теперь набранное живёт здесь, в листе дерева, и родитель о нём узнаёт один раз — когда поле
 * покидают. Редактор Яны перестаёт перерисовываться от того, что она пишет в заголовок.
 *
 * **Почему не только `onChange` без `onBlur`.** Наверх значение обязано попасть до сохранения:
 * заголовок читает санитайзер, из него строится ЧПУ, и он нужен редактору для alt у картинок.
 * `onBlur` — момент, когда редактор закончил фразу, и он наступает раньше, чем нажатие кнопки
 * «Сохранить».
 *
 * **Почему не `useDeferredValue`.** Он откладывает рендер, но не отменяет его: React всё равно
 * перерисует форму, просто позже. Задача — не перерисовывать вовсе, и решает её только
 * локальное состояние.
 */
export function useDraftValue(
  value: string,
  commit: (next: string) => void,
  /**
   * Куда писать набранное, помимо собственного состояния поля.
   *
   * Это запись в скрытый двойник в корне формы — тот, что реально уезжает на сервер. Он нужен, и
   * это не перестраховка: панели вкладок размонтируются, а поле внутри размонтированной панели в
   * форму не попадает вовсе. Сохранение с вкладки «Медиа» без двойника отправило бы пустой
   * заголовок и упало бы на серверной проверке — ровно так уже было с `contentHtml`.
   *
   * Колбэк, а не ссылка на элемент: запись выполняет тот, кто владеет двойником, — форма. Ссылка,
   * переданная пропом, читается как аргумент хука, и присваивание `ref.current` в ней правило
   * `react-hooks/immutability` справедливо запрещает: со стороны поля это изменение чужого
   * значения, и однажды оно окажется чьим-то ещё.
   *
   * Значение `value` на двойник не вешается: он неуправляемый, и пишем в него мы — иначе каждое
   * нажатие клавиши снова поднималось бы в состояние формы и перерисовывало редактор.
   */
  writeMirror?: (value: string) => void,
) {
  const [draft, setDraft] = useState(value);
  /**
   * Что уже отдано наверх.
   *
   * Нужен, чтобы отличить «родитель изменил значение» от «родитель просто перерисовался»:
   * сравнение с `value` путало эти два случая, и черновик затирался бы при каждом рендере
   * формы — то есть ровно то, от чего мы уходим.
   */
  const committed = useRef(value);
  /** То же значение, но для обработчиков: `flush` не должен зависеть от `draft`. */
  const current = useRef(value);

  /*
    Внешнее изменение перебивает черновик.

    Значение приходит снаружи, когда его подставил не редактор: «Рерайт» заполнил заголовок,
    страница загрузила статью, «Отменить» вернуло снимок. Без этой синхронизации поле осталось
    бы пустым при непустом значении в состоянии — и сохранение записало бы старое.
  */
  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    current.current = value;
    setDraft(value);
    writeMirror?.(value);
  }, [value, writeMirror]);

  const change = useCallback(
    (next: string) => {
      current.current = next;
      // Двойник обновляется прямо в DOM: состояние формы не трогается, перерисовки нет, а
      // FormData при этом читает именно то, что редактор только что набрал.
      writeMirror?.(next);
      setDraft(next);
    },
    [writeMirror],
  );

  const flush = useCallback(() => {
    if (current.current === committed.current) return;
    committed.current = current.current;
    commit(current.current);
  }, [commit]);

  return { draft, change, flush };
}

type SubtitleFieldProps = {
  value: string;
  onCommit: (value: string) => void;
  error?: string;
  /** Запись набранного в скрытый двойник — см. `useDraftValue`. */
  onDraft?: (value: string) => void;
};

/** Подзаголовок: необязательное поле, с живым счётчиком знаков. */
export function SubtitleField({ value, onCommit, error, onDraft }: SubtitleFieldProps) {
  const { draft, change, flush } = useDraftValue(value, onCommit, onDraft);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor="subtitle" className="text-sm font-medium text-neutral-700">
          Подзаголовок
        </label>
        <CharCounter value={draft} />
      </div>
      <input
        id="subtitle"
        type="text"
        value={draft}
        onChange={(event) => change(event.target.value)}
        onBlur={flush}
        placeholder="Необязательно"
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

type LeadFieldProps = {
  value: string;
  onCommit: (value: string) => void;
  /** Порог счётчика знаков. Наблюдательный: длиннее — предупреждение, а не запрет. */
  limit?: number;
  /** Запись набранного в скрытый двойник — см. `useDraftValue`. */
  onDraft?: (value: string) => void;
};

/** Лид: анонс для ленты и соцсетей, с живым счётчиком знаков. */
export function LeadField({ value, onCommit, limit, onDraft }: LeadFieldProps) {
  const { draft, change, flush } = useDraftValue(value, onCommit, onDraft);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor="lead" className="text-sm font-medium text-neutral-700">
          Внутренний анонс (Лид)
        </label>
        <CharCounter value={draft} limit={limit} />
      </div>
      {/*
        Предела длины здесь нет намеренно, как и раньше: счётчик показывает бюджет, но не
        запрещает писать длиннее. Появление `maxLength` молча обрезало бы лид, который редактор
        уже написал, — это смена поведения, а не оптимизация.
      */}
      <textarea
        id="lead"
        value={draft}
        onChange={(event) => change(event.target.value)}
        onBlur={flush}
        rows={3}
        placeholder="Краткое описание материала для анонсов"
        className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
      />
    </div>
  );
}
