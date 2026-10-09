import { ArticleCard } from "@/components/article-card";
import Link from "next/link";

import { cn } from "@/lib/utils";

type SectionGridProps = {
  title: string;
  slug: string;
  articles: Parameters<typeof ArticleCard>[0]["article"][];
};

/**
 * One rubric's strip on the front page: a rubric line, then four flat cards across.
 *
 * Four columns, not three, because this is a strip and not a feature: a reader is looking
 * for a headline to click, not reading a story, and four titles per row put eight on screen
 * where three put six. The cards drop their shadows and borders for the same reason — a
 * newspaper column is separated by white space and a hairline, not by a box.
 *
 * Flat and square by choice: `ArticleCard` rounds its thumbnails because it also renders
 * inside the rails, where a rounded tile reads as an item in a feed. Here it is a page of
 * print, and the rule above the block is the only frame it needs.
 */
export function SectionGrid({ title, slug, articles }: SectionGridProps) {
  if (articles.length === 0) return null;

  const lead = articles[0];
  const rest = articles.slice(1);

  return (
    <section
      aria-labelledby={`section-${slug}`}
      // The rule above each rubric is what separates one from the next; the section
      // carries no bottom rule, because the next section's top rule is already that line.
      className="border-t-2 border-ink pt-3"
    >
      {/*
        `rubric-line` draws the hairline as a flex sibling, so the line starts after the
        rubric name and runs flush to the right edge of the block — the shape a newspaper
        prints its section headings in.
      */}
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2
          id={`section-${slug}`}
          className="rubric-line font-[family-name:var(--font-lora)] text-xl font-bold tracking-tight text-ink sm:text-2xl"
        >
          {title}
        </h2>

        <Link
          href={`/category/${slug}`}
          className="inline-flex min-h-6 shrink-0 items-center text-[11px] font-semibold tracking-wide text-accent uppercase hover:underline decoration-1 underline-offset-4"
        >
          Все материалы →
        </Link>
      </div>

      {/* Column count follows the item count. A rubric with a single story must not
          stretch one card across the full 1280px page, so that case caps the grid width
          instead. */}
      <div
        className={cn(
          "grid gap-x-6 gap-y-5",
          articles.length === 1 && "max-w-md",
          articles.length === 2 && "sm:grid-cols-2",
          articles.length === 3 && "sm:grid-cols-3",
          articles.length >= 4 && "sm:grid-cols-2 lg:grid-cols-4",
        )}
      >
        {lead ? <ArticleCard article={lead} /> : null}

        {rest.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>
    </section>
  );
}