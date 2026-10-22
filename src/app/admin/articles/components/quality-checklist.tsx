"use client";

import {
  articleQuality,
  qualitySummary,
  type QualityCheck,
  type QualityInput,
  type QualityLevel,
} from "@/lib/article-quality";

/**
 * «Чек-лист качества статьи» — сворачиваемая карточка в сайдбаре редактора.
 *
 * **Советует, а не запрещает.** Ни одна строка не блокирует публикацию: редактор решает сам, а
 * чек-лист существует, чтобы то, что легко проглядеть (короткий лид, стена текста без подзаголовка,
 * снимок без источника), было видно в одном месте до нажатия «Опубликовать», а не после.
 *
 * **Свёрнут по умолчанию.** Открытая коробка с четырьмя строками в сайдбаре — это ещё один блок,
 * который прокручивают не читая. Свёрнутая строка сообщает главное: всё в порядке или есть
 * замечания, — и разворачивается, когда редактор сам захочет подробностей.
 *
 * `<details>` вместо состояния в React: браузер сам держит раскрытие, работает без JavaScript и
 * переживает перерисовку формы (публикация, ошибка сохранения, повторный рендер после `useActionState`).
 */
const LEVEL_STYLE: Record<QualityLevel, { dot: string; text: string }> = {
  good: { dot: "bg-emerald-500", text: "text-emerald-700" },
  warn: { dot: "bg-amber-500", text: "text-amber-700" },
  bad: { dot: "bg-red-500", text: "text-red-700" },
};

function Row({ check }: { check: QualityCheck }) {
  const style = LEVEL_STYLE[check.level];

  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className={`mt-1.5 size-2 shrink-0 rounded-full ${style.dot}`}
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-neutral-800">{check.label}</span>
        <span className="block text-[11px] leading-snug text-neutral-500">{check.detail}</span>
        {check.hint ? (
          <span className={`mt-0.5 block text-[11px] leading-snug ${style.text}`}>{check.hint}</span>
        ) : null}
      </span>
    </li>
  );
}

import { useMemo } from "react";

export function QualityChecklist({ title, lead, contentHtml, coverImage, photoSource }: QualityInput) {
  /*
    Разбор пересчитывается только когда меняется то, из чего он сделан. Форма перерисовывается
    на каждое нажатие клавиши (поля контролируемые), и без этого список проверок пересобирался бы
    на любой чих — включая переключение вкладки или ошибку сохранения.
  */
  const checks = useMemo(
    () => articleQuality({ title, lead, contentHtml, coverImage, photoSource }),
    [title, lead, contentHtml, coverImage, photoSource],
  );
  const summary = qualitySummary(checks);
  const style = LEVEL_STYLE[summary.level];

  return (
    <details className="group rounded border border-neutral-300 bg-white open:pb-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-neutral-800 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className={`size-2 rounded-full ${style.dot}`} />
        <span className="flex-1">
          Чек-лист качества
          <span className="block text-[11px] font-normal text-neutral-500">{summary.text}</span>
        </span>
        <span
          aria-hidden
          className="text-neutral-400 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>

      <ul className="space-y-2 px-3 pt-1">
        {checks.map((check) => (
          <Row key={check.id} check={check} />
        ))}
      </ul>
    </details>
  );
}
