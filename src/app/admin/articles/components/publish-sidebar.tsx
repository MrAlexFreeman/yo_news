"use client";

import type { ArticleStatus } from "@/lib/article-status";
import type { CategoryOption } from "@/app/admin/articles/types";
import { DZEN_EXPERIMENT_LOCKED_HINT } from "@/lib/dzen-experiment";
import { cn } from "@/lib/utils";

type PublishSidebarProps = {
  categories: CategoryOption[];
  categoryId: string;
  onCategoryChange: (value: string) => void;
  status: ArticleStatus;
  onStatusChange: (value: ArticleStatus) => void;
  isDzen: boolean;
  onIsDzenChange: (value: boolean) => void;
  isVk: boolean;
  onIsVkChange: (value: boolean) => void;
  isTelegram: boolean;
  onIsTelegramChange: (value: boolean) => void;
  isMax: boolean;
  onIsMaxChange: (value: boolean) => void;
  /**
   * Why a messenger checkbox is off when the editor did not turn it off — shown as a
   * note under the pair, so an empty box reads as a decision rather than a fault.
   */
  messengerHint?: string;
  isExclusive: boolean;
  onIsExclusiveChange: (value: boolean) => void;
  is18plus: boolean;
  onIs18plusChange: (value: boolean) => void;
  dzenExperiment: boolean;
  onDzenExperimentChange: (value: boolean) => void;
  dzenDirect: boolean;
  onDzenDirectChange: (value: boolean) => void;
  /** True once the publication moment has passed; locks the experiment flag. */
  dzenExperimentLocked: boolean;
  categoryError?: string;
};

const STATUS_LABELS: Record<ArticleStatus, string> = {
  draft: "Черновик",
  published: "Опубликован",
};

/** Distribution and moderation flags, both on by default for syndication. */
function Checkbox({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-neutral-700 hover:text-neutral-900"
    >
      <input
        id={id}
        name={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 shrink-0 rounded-sm border-neutral-400 accent-blue-700"
      />
      {label}
    </label>
  );
}

/** Right-hand column: the "Свойства" card from the editorial CMS. */
export function PublishSidebar({
  categories,
  categoryId,
  onCategoryChange,
  status,
  onStatusChange,
  isDzen,
  onIsDzenChange,
  isVk,
  onIsVkChange,
  isTelegram,
  onIsTelegramChange,
  isMax,
  onIsMaxChange,
  messengerHint,
  isExclusive,
  onIsExclusiveChange,
  is18plus,
  onIs18plusChange,
  dzenExperiment,
  onDzenExperimentChange,
  dzenDirect,
  onDzenDirectChange,
  dzenExperimentLocked,
  categoryError,
}: PublishSidebarProps) {
  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <section className="rounded border border-neutral-300 bg-white shadow-xs">
        <h2 className="rounded-t border-b border-neutral-300 bg-gradient-to-b from-neutral-100 to-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-800">
          Свойства
        </h2>

        <div className="space-y-4 p-3">
          <div className="space-y-1">
            <span className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
              Распространение
            </span>
            <Checkbox
              id="isDzen"
              label="В Дзен-блог"
              checked={isDzen}
              onChange={onIsDzenChange}
            />
            <Checkbox
              id="isVk"
              label="Репост в ВК"
              checked={isVk}
              onChange={onIsVkChange}
            />
            <Checkbox
              id="isTelegram"
              label="Репост в Telegram"
              checked={isTelegram}
              onChange={onIsTelegramChange}
            />
            <Checkbox
              id="isMax"
              label="Репост в MAX"
              checked={isMax}
              onChange={onIsMaxChange}
            />
            {/*
              A single note for both messengers rather than one each: they are
              configured together, and two notes saying the same thing in two places is
              noise an editor learns to skip.
            */}
            {messengerHint ? (
              <p className="pl-6 pt-1 text-[11px] leading-snug text-neutral-400">
                {messengerHint}
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <span className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
              Синдикация и эксперимент Дзен
            </span>
            {/*
              Disabled rather than hidden: an editor looking at a story that has
              been live for a week needs to see that the experiment option exists
              and why it is no longer available. Hiding it would leave them
              wondering whether the newsroom has a feature nobody told them about.

              The server enforces the same rule — see src/lib/dzen-experiment.ts —
              so this attribute is an explanation, not the lock.
            */}
            <label
              htmlFor="dzenExperiment"
              title={dzenExperimentLocked ? DZEN_EXPERIMENT_LOCKED_HINT : undefined}
              className={cn(
                "flex items-start gap-2 py-0.5 text-sm",
                dzenExperimentLocked ? "cursor-not-allowed" : "cursor-pointer",
              )}
            >
              <input
                id="dzenExperiment"
                name="dzenExperiment"
                type="checkbox"
                checked={dzenExperiment}
                disabled={dzenExperimentLocked}
                onChange={(event) => onDzenExperimentChange(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 rounded-sm border-neutral-400 accent-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className={dzenExperimentLocked ? "text-neutral-400" : "text-neutral-700"}>
                Эксперимент с Дзен
              </span>
            </label>

            {dzenExperimentLocked ? (
              <p className="mb-1 pl-6 text-[11px] leading-snug text-amber-700">
                {DZEN_EXPERIMENT_LOCKED_HINT}
              </p>
            ) : null}

            <label
              htmlFor="dzenDirect"
              className="flex cursor-pointer items-center gap-2 py-0.5 text-sm text-neutral-700 hover:text-neutral-900"
            >
              <input
                id="dzenDirect"
                name="dzenDirect"
                type="checkbox"
                checked={dzenDirect}
                onChange={(event) => onDzenDirectChange(event.target.checked)}
                className="size-4 shrink-0 rounded-sm border-neutral-400 accent-blue-700"
              />
              Напрямую в Дзен
            </label>

            <p className="pl-6 text-[11px] leading-snug text-neutral-400">
              {dzenExperiment
                ? "Материал придёт в Дзен как черновик — «Напрямую» при включённом эксперименте не действует."
                : dzenDirect
                  ? "Материал уйдёт в Дзен сразу статьёй, минуя ручную вычитку."
                  : "Без галочек материал публикуется в Дзен автоматически при выходе на сайте."}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
              Метки
            </span>
            <Checkbox
              id="isExclusive"
              label="Эксклюзив"
              checked={isExclusive}
              onChange={onIsExclusiveChange}
            />
            <Checkbox
              id="is18plus"
              label="18+"
              checked={is18plus}
              onChange={onIs18plusChange}
            />
          </div>

          <hr className="border-neutral-200" />

          <div className="space-y-1.5">
            <label
              htmlFor="categoryId"
              className="text-sm font-medium text-neutral-700"
            >
              Рубрика
            </label>
            <select
              id="categoryId"
              name="categoryId"
              value={categoryId}
              onChange={(event) => onCategoryChange(event.target.value)}
              className={cn(
                "w-full rounded-sm border bg-white px-2 py-1.5 text-sm outline-none",
                "focus:ring-2",
                categoryError
                  ? "border-red-500 focus:ring-red-200"
                  : "border-neutral-400 focus:border-neutral-600 focus:ring-neutral-200",
              )}
            >
              <option value="">— без рубрики —</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {categoryError ? (
              <p className="text-sm text-red-600">{categoryError}</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium text-neutral-700">Статус</span>
            <div
              role="radiogroup"
              aria-label="Статус публикации"
              className="rounded-sm border border-neutral-400 bg-neutral-100 p-0.5"
            >
              {(["draft", "published"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={status === value}
                  onClick={() => onStatusChange(value)}
                  className={cn(
                    "block w-full rounded-sm px-2 py-1 text-left text-sm font-medium transition-colors",
                    status === value
                      ? "bg-white text-neutral-900 shadow-xs"
                      : "text-neutral-500 hover:text-neutral-800",
                  )}
                >
                  {STATUS_LABELS[value]}
                </button>
              ))}
            </div>
            {/* Mirrors the segmented control above so the value reaches the action. */}
            <input type="hidden" name="status" value={status} />
          </div>
        </div>
      </section>
    </aside>
  );
}
