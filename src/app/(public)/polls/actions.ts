"use server";

import { prisma } from "@/lib/prisma";
import { parsePollOptions, type PollOption } from "@/lib/polls";

/**
 * Голос в опросе под материалом.
 *
 * Принимает идентификаторы, а не индекс варианта: редактор может переставить варианты местами,
 * и голос, названный по порядку, после этого попал бы не туда.
 *
 * Считается в приложении, а не в SQL: вариантов не больше пяти, они лежат в одной JSON-колонке,
 * и `UPDATE` целого массива — это одно чтение и одна запись, без гонки между ними в пределах
 * одного процесса. Пара голосов, поданных в одну миллисекунду, может потеряться — для опроса
 * под новостью это не тот риск, ради которого стоит заводить отдельную таблицу голосов.
 *
 * Итоги возвращаются вызывающему коду, чтобы проголосовавший сразу увидел свежие проценты, не
 * дожидаясь перерисовки кэшированной страницы.
 */
export type PollVoteResult =
  | { ok: true; options: PollOption[] }
  | { ok: false; message: string };

export async function votePollAction(
  pollId: string,
  optionId: string,
): Promise<PollVoteResult> {
  if (!pollId.trim() || !optionId.trim()) {
    return { ok: false, message: "Голос не принят." };
  }

  try {
    const poll = await prisma.articlePoll.findUnique({
      where: { id: pollId },
      select: { options: true },
    });
    if (!poll) return { ok: false, message: "Опрос больше не доступен." };

    const options = parsePollOptions(poll.options);
    if (!options.some((option) => option.id === optionId)) {
      return { ok: false, message: "Такого варианта в опросе нет." };
    }

    const updated = options.map((option) =>
      option.id === optionId ? { ...option, votes: option.votes + 1 } : option,
    );

    await prisma.articlePoll.update({ where: { id: pollId }, data: { options: updated } });

    return { ok: true, options: updated };
  } catch (error) {
    console.error("[poll] голос не сохранён:", error);
    return { ok: false, message: "Не удалось сохранить голос. Попробуйте ещё раз." };
  }
}
