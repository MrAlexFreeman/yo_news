"use client";

import { Send } from "lucide-react";

import { TG_URL } from "@/lib/site";

/**
 * Блок очевидца в подвале статьи — то, чем The Guardian заканчивает репортажи.
 *
 * Вместо «оставьте комментарий» читателю предлагают сделать то, что может сделать именно он:
 * рассказать, что видел, или прислать фото. Две двери, и обе ведут туда, куда редакция уже
 * смотрит: редакционный Telegram и форма предложки на самом сайте.
 *
 * Клиентский компонент только ради одной вещи — плавного скролла ко второй кнопке. Первая —
 * обычная внешняя ссылка, и если Telegram-канала не настроено, она не рендерится вовсе.
 */

/** Якорь формы предложки на той же странице. */
const STORY_FORM_ID = "reader-story-heading";

export function WitnessBox() {
  const scrollToStory = () => {
    document
      .getElementById(STORY_FORM_ID)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section className="border border-rule rounded-xl p-5 bg-paper-dim/30 my-8">
      <h2 className="font-[family-name:var(--font-lora)] font-bold text-lg text-ink">
        Знаете подробности или есть фото с места событий?
      </h2>
      <p className="text-sm text-ink-soft mt-1">
        Редакция «Ё-новости» собирает свидетельства очевидцев. Анонимность гарантируется.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {TG_URL ? (
          <a
            href={TG_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-yo px-4 py-2 text-xs font-semibold text-ink transition-opacity hover:opacity-90"
          >
            <Send className="size-4" aria-hidden />
            Написать в редакционный Telegram
          </a>
        ) : null}

        <button
          type="button"
          onClick={scrollToStory}
          className="inline-flex items-center gap-2 rounded-lg border border-rule bg-paper px-4 py-2 text-xs font-semibold text-ink transition-colors hover:border-yo hover:text-yo-ink"
        >
          Поделиться историей на сайте
        </button>
      </div>
    </section>
  );
}
