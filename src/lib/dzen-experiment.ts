/**
 * The editorial rule behind "Эксперимент с Дзен": the flag may only be switched on
 * at the moment of first publication.
 *
 * Two things make this worth its own module. First, it has to be enforced on the
 * server, not only by disabling a checkbox — a disabled input is a UI
 * convention, not a guarantee, and every flag in this form is a plain text field
 * or checkbox that a crafted POST can set. Second, the rule spans the stored
 * article and the incoming form values, and getting the precedence wrong is how a
 * backdated article sneaks an experiment in.
 *
 * Dzen's own documentation backs the rule independently: «Материалы из RSS-ленты
 * обновляются в течение 7 дней после первой загрузки. Если материал был загружен
 * через RSS-ленту более недели назад, изменения в источнике уже не будут влиять на
 * публикацию в Дзене» — so a flag flipped after the first week would be silently
 * ignored anyway. Claiming an experiment that never reaches the platform is
 * worse than not having the flag at all.
 */

/**
 * How long after the publication moment the flag may still be toggled.
 *
 * Non-zero on purpose. An editor who presses «Опубликовать» and only then
 * remembers the experiment gets a short window to add it; without a window the
 * rule would make the flag unreachable in the most common ordering, and they
 * would have to unpublish, which is worse than editing one field.
 */
export const DZEN_EXPERIMENT_WINDOW_MS = 5 * 60 * 1000;

/** Tooltip shown on the locked checkbox, exactly as specified by editorial. */
export const DZEN_EXPERIMENT_LOCKED_HINT =
  "Эксперимент Дзен активируется только в момент первоначальной публикации";

type CanSetInput = {
  /** Publication date already in the database, for an existing article. */
  storedPublishedAt?: Date | null;
  /** Publication date the editor just submitted. */
  chosenPublishedAt?: Date | null;
  /** Compared against "now"; defaults to the current time so the rule is testable. */
  now?: Date;
};

/**
 * True while the flag may still be changed.
 *
 * The earlier of the two dates is what matters. Checking only the submitted date
 * would let an article published three days ago be re-stamped to now and then
 * marked as an experiment; checking only the stored one would ignore a scheduled
 * publication in the past that is being backdated right now.
 */
export function canSetDzenExperiment({
  storedPublishedAt,
  chosenPublishedAt,
  now = new Date(),
}: CanSetInput): boolean {
  const cutoff = now.getTime() - DZEN_EXPERIMENT_WINDOW_MS;

  const candidates = [storedPublishedAt, chosenPublishedAt].filter(
    (date): date is Date => date instanceof Date && !Number.isNaN(date.getTime()),
  );

  // Never published yet: the flag is exactly what this window is for.
  if (candidates.length === 0) return true;

  return candidates.every((date) => date.getTime() >= cutoff);
}

/**
 * Resolves what to actually store.
 *
 * An existing flag is never cleared by a locked save. Once granted, the flag
 * belongs to the publication it was granted for; a later edit that happens to be
 * outside the window must not quietly turn the experiment off and change what the
 * feed emits.
 */
export function resolveDzenExperiment({
  submitted,
  stored,
  ...window
}: CanSetInput & { submitted: boolean; stored: boolean }): boolean {
  if (canSetDzenExperiment(window)) return submitted;
  return stored;
}