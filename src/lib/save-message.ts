/**
 * The line the editor reads under the save button.
 *
 * Pure, and deliberately so. The text used to be assembled inline in `createArticleAction`,
 * which put it out of reach of any test: calling the action from a plain Node process dies
 * on `revalidatePath` — "static generation store missing" — before the return value carrying
 * the message exists. That is not a theoretical inconvenience. This exact line is what the
 * admin was showing as unreadable text, because the string literals had been through a
 * UTF-8 → Windows-1251 → UTF-8 round trip: "Материал обновлён." reached the editor with
 * every letter doubled and a punctuation mark welded to it. Nothing in the suite could have
 * noticed — the HTTP route never reaches a Server Action, and the unit-level call dies
 * before returning anything to assert on.
 *
 * So the words live here, where `encoding:check` can read them, and the action supplies the
 * facts. Everything the message can say is an argument, which is also what makes the
 * combinations checkable: a save that published, was refused the Dzen flag and lost its VK
 * video rename is three sentences, and before this it was assembled by someone reading three
 * booleans in the wrong order.
 *
 * Note that the damaged form is described here and not quoted. Writing the corrupted string
 * into this comment made `encoding:check` fail on this very file, which was the guard doing
 * exactly its job — a literal of the corruption is indistinguishable from the real thing.
 */

/** What the editor did, as far as the message is concerned. */
export type SaveMessageInput = {
  /** True when an existing article was saved rather than a new one created. */
  isUpdate: boolean;
  /** True when the submitted Dzen-experiment checkbox was not honoured. */
  experimentRejected: boolean;
  /** Explanation to quote when the experiment checkbox was refused. */
  experimentHint: string;
  /** A problem with the VK video rename, which is reported but not fatal. */
  vkVideoWarning: string | null | undefined;
};

/**
 * Composes the toast text.
 *
 * Order is fixed and deliberate: the headline first, so the editor reads the outcome before
 * any caveats; then the caveats, separated by a single space. Empty parts are dropped rather
 * than joined as blanks, which is what produced a message with a trailing space in an earlier
 * revision.
 */
export function saveMessage({
  isUpdate,
  experimentRejected,
  experimentHint,
  vkVideoWarning,
}: SaveMessageInput): string {
  const parts = [
    isUpdate ? "Материал обновлён." : "Материал создан.",
    experimentRejected ? `Эксперимент с Дзен не включён: ${experimentHint}.` : "",
    vkVideoWarning ?? "",
  ];

  return parts.filter(Boolean).join(" ");
}
