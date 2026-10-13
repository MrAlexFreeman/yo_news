"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import { votePollAction } from "@/app/(public)/polls/actions";
import {
  POLL_VOTES_STORAGE_KEY,
  pollPercentages,
  pollTotal,
  readPollVotes,
  rememberPollVote,
  type PollOption,
} from "@/lib/polls";
import { cn } from "@/lib/utils";

/**
 * Опрос под материалом: вопрос, варианты и проценты сразу после нажатия.
 *
 * **Голос браузера читается через `useSyncExternalStore`, а не эффектом.** Эффект с
 * `setState` отрисовал бы виджет дважды у каждого читателя, и правило линтера
 * `react-hooks/set-state-in-effect` справедливо это запрещает. Хранилище — то, для чего
 * хук и сделан: значение живёт вне React и отличается между сервером и браузером.
 * `getServerSnapshot` отвечает «не голосовал», поэтому гидратируется ровно та разметка,
 * которую отдал сервер, а свой ответ читатель видит сразу следом.
 */
type PollView = {
  id: string;
  question: string;
  options: PollOption[];
};

/** Стабильная ссылка для серверного прохода: хук сравнивает снимки по идентичности. */
const NOTHING_VOTED: Record<string, string> = {};

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function ArticlePoll({ poll }: { poll: PollView }) {
  const [options, setOptions] = useState<PollOption[]>(poll.options);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /*
    Разобранная карта голосов кэшируется по сырой строке: `useSyncExternalStore` требует одну
    и ту же ссылку, пока данные не изменились, иначе получается бесконечная перерисовка.
  */
  const cache = useRef<{ raw: string | null; votes: Record<string, string> } | null>(null);

  const getSnapshot = useCallback(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(POLL_VOTES_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (!cache.current || cache.current.raw !== raw) {
      cache.current = { raw, votes: readPollVotes(window.localStorage) };
    }
    return cache.current.votes;
  }, []);

  const votes = useSyncExternalStore(subscribe, getSnapshot, () => NOTHING_VOTED);
  const myVote = votes[poll.id] ?? null;

  async function vote(optionId: string) {
    if (myVote || pending) return;

    setPending(true);
    setFailed(null);

    try {
      const result = await votePollAction(poll.id, optionId);
      if (!result.ok) {
        setFailed(result.message);
        return;
      }

      // Сначала показываем результат, потом записываем голос: если запись не удалась,
      // читатель всё равно видит то, что уже принято сервером.
      setOptions(result.options);
      rememberPollVote(window.localStorage, poll.id, optionId);
      // Заставляем хук перечитать хранилище, чтобы `myVote` встал на место.
      cache.current = null;
      window.dispatchEvent(new Event("storage"));
    } catch (error) {
      setFailed(
        error instanceof Error ? error.message : "Не удалось отправить голос.",
      );
    } finally {
      setPending(false);
    }
  }

  const percents = pollPercentages(options);
  const total = pollTotal(options);
  const showResults = myVote !== null;

  return (
    <section
      aria-labelledby={`poll-${poll.id}`}
      className="mt-10 border border-rule bg-paper-dim/40 p-4 sm:p-5"
    >
      <p className="text-xs font-semibold tracking-[0.14em] text-accent uppercase">
        Опрос
      </p>
      <h2
        id={`poll-${poll.id}`}
        className="mt-1.5 font-[family-name:var(--font-lora)] text-lg font-bold text-ink sm:text-xl"
      >
        {poll.question}
      </h2>

      <ul className="mt-4 space-y-2">
        {options.map((option, index) => {
          const percent = percents[index] ?? 0;
          const chosen = myVote === option.id;

          return (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => void vote(option.id)}
                disabled={showResults || pending}
                aria-pressed={chosen}
                className={cn(
                  "relative block w-full overflow-hidden rounded-sm border px-3 py-2.5 text-left text-sm transition-colors",
                  showResults
                    ? chosen
                      ? "border-accent bg-accent/10"
                      : "border-rule bg-paper"
                    : "border-rule bg-paper hover:border-ink-soft hover:bg-paper-dim",
                  pending && "opacity-70",
                )}
              >
                {/* Полоса результата: видна только после голосования.
                    Лежит под текстом за счёт порядка в DOM: она стоит раньше, а текст — это
                    `relative`, поэтому рисуется поверх. Отдельный z-index не нужен. */}
                {showResults ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute inset-y-0 left-0",
                      chosen ? "bg-accent/20" : "bg-ink/10",
                    )}
                    style={{ width: `${percent}%` }}
                  />
                ) : null}

                <span className="relative flex items-baseline justify-between gap-3">
                  <span className={cn("min-w-0", chosen && "font-medium text-ink")}>
                    {option.text}
                  </span>
                  {showResults ? (
                    <span className="shrink-0 text-right tabular-nums">
                      {/* Процент и число голосов: «64% · 14». Процент — итог, число — масштаб:
                          «64%» из трёх голосов значит меньше, чем из трёхсот, и цифра рядом
                          говорит это без слов. */}
                      <span className="text-xs font-semibold text-ink">{percent}%</span>
                      <span className="ml-1.5 text-xs text-ink-soft/70">{option.votes}</span>
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-xs text-ink-soft">
        {showResults
          ? `Ваш голос учтён. Всего голосов: ${total}.`
          : "Выберите один вариант — результаты появятся сразу."}
      </p>

      {failed ? (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {failed}
        </p>
      ) : null}
    </section>
  );
}
