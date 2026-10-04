/**
 * Dzen's own vocabulary for how a syndicated item should be placed.
 *
 * Source: https://dzen.ru/help/ru/website/rss-modify.html — «Способ публикации».
 * Dzen reads this from a single `<category>` element per `<item>`, and every
 * value below is theirs, not ours.
 *
 * There is deliberately no `dzen:native` element here. It is not in the
 * specification and no namespace for it is documented; an element a syndicator
 * does not recognise is at best ignored and at worst a reason to reject the feed.
 * What the specification does document is a *publication method*, and that is what
 * the editorial experiment maps onto.
 */
export type DzenPublicationMethod =
  /** Held on the platform as a draft for a human to review, not auto-published. */
  | "native-draft"
  /** Auto-converted to a Dzen article and published immediately. */
  | "format-article"
  /** Auto-converted to a short post. */
  | "format-post";

export type DzenMethodInput = {
  /** Editor opted the story into the Dzen experiment. */
  dzenExperiment: boolean;
  /** Editor asked for it to go straight out rather than be held for review. */
  dzenDirect: boolean;
};

/**
 * Picks the publication method for one item.
 *
 * When neither flag is set the function returns null and the feed omits
 * `<category>` entirely, which is the documented default: «Если этого не сделать,
 * материал будет автоматически опубликован и сразу появится на канале».
 *
 * When both flags are set, `native-draft` wins. The two contradict each other —
 * one says "do not publish this yet", the other says "publish it now" — and the
 * single `<category>` element can only carry one method, so a precedence has to be
 * chosen. Holding the item is the safe side of that choice: an experiment nobody
 * reviews can put a wrong headline in front of readers, whereas a draft that was
 * meant to go straight out is one click away in the Zen Studio.
 */
export function dzenPublicationMethod(
  input: DzenMethodInput,
): DzenPublicationMethod | null {
  if (input.dzenExperiment) return "native-draft";
  if (input.dzenDirect) return "format-article";
  return null;
}

/**
 * Indexing preference, from the same <category> element in Dzen's docs.
 *
 * Kept as a helper but deliberately NOT emitted by the feed: the element holds
 * one value, and the publication method is the one that decides where the piece
 * lands. Emitting both would mean either two competing <category> elements or
 * silently dropping the experiment flag, and neither is a trade worth making for
 * an axis Dzen applies by default.
 */
export function dzenIndexing(noIndex: boolean): "index" | "noindex" {
  return noIndex ? "noindex" : "index";
}

/**
 * Content rating, from the markup in Dzen's own sample item:
 * `<media:rating scheme="urn:simple">nonadult</media:rating>`.
 *
 * Emitted only for 18+ material. Their sample shows the "nonadult" spelling, so
 * that is what a non-adult item would carry; since every unmarked item is already
 * treated as such, the element is emitted only when it actually changes something.
 */
export function dzenRating(is18plus: boolean): "adult" | null {
  return is18plus ? "adult" : null;
}