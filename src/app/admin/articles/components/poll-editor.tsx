"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
  newPollOptionId,
} from "@/lib/polls";
import { cn } from "@/lib/utils";

/** Новая пустая строка с уже выданным идентификатором. */
function emptyRow(): { id: string; text: string } {
  return { id: newPollOptionId(), text: "" };
}

/**
 * «Прикрепить опрос» в редакторе материала.
 *
 * Вводы названы так, как их читает действие сохранения (`pollQuestion`, `pollOption`), и лежат
 * внутри общей формы: ничего не нужно протаскивать через состояние формы, и опрос уезжает
 * вместе с остальными полями одним запросом.
 *
 * Свёрнут по умолчанию. Опрос прикрепляют к меньшинству материалов, а панель, которая
 * разворачивает пять пустых полей под каждой новостью, — это пять пустых полей, которые надо
 * пролистать пятьдесят раз в день.
 *
 * Убрать строку ниже двух нельзя, а не «можно, но сохранится пусто»: опрос из одного варианта
 * не опрос, и лучше сказать это здесь, чем молча удалить его при сохранении.
 */
export function PollEditor({
  initial,
}: {
  initial: { question: string; options: { id: string; text: string }[] };
}) {
  const [question, setQuestion] = useState(initial.question);

  /*
    Строка — это пара «идентификатор + текст», а не просто текст.

    Идентификатор выдаётся один раз: при открытии существующего опроса берётся из базы, новым
    строкам чеканится при добавлении. Он едет в форме скрытым полем, и по нему сохранение
    переносит уже поданные голоса на тот же вариант.

    Так было не всегда: идентификатор был номером места в списке, поэтому удаление второго
    варианта из трёх сдвигало третий на `o2`, и голоса, поданные за него, переезжали к соседу.
    На боевой базе оба опроса хранят варианты как `o1`/`o2` — то есть поломка была не
    гипотезой, а тем, как устроены идентификаторы.
  */
  const [options, setOptions] = useState<{ id: string; text: string }[]>(() =>
    initial.options.length > 0
      ? initial.options
      : [emptyRow(), emptyRow()],
  );

  const filled = options.filter((row) => row.text.trim().length > 0).length;
  const active = question.trim().length > 0 || filled > 0;

  return (
    <details
      open={active}
      className={cn(
        "rounded-sm border bg-white",
        active ? "border-amber-300" : "border-neutral-300",
      )}
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-neutral-800 hover:text-neutral-950">
        Прикрепить опрос
        {active ? (
          <span className="ml-2 text-xs font-normal text-amber-700">
            {question.trim() ? "вопрос задан" : "вопрос не заполнен"}
          </span>
        ) : (
          <span className="ml-2 text-xs font-normal text-neutral-500">не прикреплён</span>
        )}
      </summary>

      <div className="space-y-3 border-t border-neutral-200 px-3 py-3">
        <div className="space-y-1">
          <label htmlFor="pollQuestion" className="text-xs font-medium text-neutral-700">
            Вопрос
          </label>
          <input
            id="pollQuestion"
            name="pollQuestion"
            value={question}
            maxLength={POLL_QUESTION_MAX}
            placeholder="Например: нужен ли городу этот проект?"
            onChange={(event) => setQuestion(event.target.value)}
            className="w-full rounded-sm border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
          />
        </div>

        <div className="space-y-1">
          <span className="text-xs font-medium text-neutral-700">Варианты ответа</span>
          {options.map((option, index) => (
            <div key={option.id} className="flex items-center gap-2">
              {/*
                Идентификатор строки едет вместе с текстом и в том же порядке, что и `pollOption`.

                Действие читает оба списка через `getAll` и складывает их попарно, поэтому
                порядок в DOM здесь и порядок чтения — одно и то же.
              */}
              <input type="hidden" name="pollOptionId" value={option.id} readOnly />
              <input
                // Named identically for every row: the action reads them with `getAll`.
                name="pollOption"
                value={option.text}
                maxLength={POLL_OPTION_MAX}
                placeholder={`Вариант ${index + 1}`}
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((row, position) =>
                      position === index ? { ...row, text: event.target.value } : row,
                    ),
                  )
                }
                className="w-full rounded-sm border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-neutral-500"
              />
              <button
                type="button"
                onClick={() => setOptions((current) => current.filter((_, p) => p !== index))}
                disabled={options.length <= POLL_MIN_OPTIONS}
                title={
                  options.length <= POLL_MIN_OPTIONS
                    ? `В опросе не может быть меньше ${POLL_MIN_OPTIONS} вариантов`
                    : "Убрать вариант"
                }
                className="shrink-0 rounded-sm border border-neutral-300 p-1.5 text-neutral-500 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-40"
              >
                <Trash2 className="size-3.5" aria-hidden />
                <span className="sr-only">Убрать вариант {index + 1}</span>
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setOptions((current) => [...current, emptyRow()])}
            disabled={options.length >= POLL_MAX_OPTIONS}
            className="mt-1 inline-flex items-center gap-1.5 rounded-sm border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden />
            Добавить вариант
          </button>
        </div>

        <p className="text-xs text-neutral-500">
          Пустые варианты не сохраняются, но и не считаются: чтобы опрос появился, нужен вопрос и
          минимум {POLL_MIN_OPTIONS} заполненных варианта. Голоса, уже поданные читателями,
          сохраняются при правке текста варианта, при его перестановке и при удалении соседнего
          варианта.
        </p>
      </div>
    </details>
  );
}
