import { LoopCard, type LoopCardStory } from "@/components/loop-card";

/**
 * The block under the story: six cards, two rows, so the page never ends in a wall.
 *
 * Two rows with their own headings rather than one grid of six, because the two groups
 * answer different questions — "more from the desk this came from" and "what else
 * happened today" — and a reader scanning the end of an article picks on the heading.
 * On a wide screen each row is three across, which puts them on two rows of three;
 * below `sm` they stack one per line.
 *
 * The rows arrive already deduplicated from the query layer: nothing here can repeat the
 * story being read, or the one the plate inside the article offered.
 */

type ContinueReadingProps = {
  popular: LoopCardStory[];
  highlights: LoopCardStory[];
};

/** One labelled row of the grid. */
function LoopRow({
  title,
  headingId,
  stories,
}: {
  title: string;
  headingId: string;
  stories: LoopCardStory[];
}) {
  if (stories.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="mb-3 border-b border-rule pb-1.5 text-xs font-bold tracking-[0.14em] text-ink uppercase"
      >
        {title}
      </h3>

      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((story) => (
          <li key={story.id}>
            <LoopCard story={story} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ContinueReading({ popular, highlights }: ContinueReadingProps) {
  if (popular.length === 0 && highlights.length === 0) return null;

  return (
    <section
      aria-labelledby="continue-reading-heading"
      className="mt-10 border-t-2 border-ink pt-5"
    >
      <h2
        id="continue-reading-heading"
        className="font-[family-name:var(--font-lora)] text-xl font-bold text-ink sm:text-2xl"
      >
        Продолжить чтение
      </h2>

      <div className="mt-5 space-y-8">
        <LoopRow
          title="Популярное в этой рубрике"
          headingId="loop-popular"
          stories={popular}
        />
        <LoopRow
          title="Главные расследования и события дня"
          headingId="loop-highlights"
          stories={highlights}
        />
      </div>
    </section>
  );
}