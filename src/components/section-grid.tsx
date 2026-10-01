import { ArticleCard } from "@/components/article-card";
import Link from "next/link";

import { cn } from "@/lib/utils";

type SectionGridProps = {
  title: string;
  slug: string;
  articles: Parameters<typeof ArticleCard>[0]["article"][];
};

/** One rubric block on the front page: heading, then a dense card grid. */
export function SectionGrid({ title, slug, articles }: SectionGridProps) {
  if (articles.length === 0) return null;

  const [lead, ...rest] = articles;

  return (
    <section
      aria-labelledby={`section-${slug}`}
      className="border-t-2 border-ink pt-3"
    >
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2
          id={`section-${slug}`}
          className="font-[family-name:var(--font-lora)] text-xl font-bold text-ink sm:text-2xl"
        >
          {title}
        </h2>
        <Link
          href={`/category/${slug}`}
          className="inline-flex min-h-6 shrink-0 items-center text-[11px] font-semibold tracking-wide text-accent uppercase hover:underline"
        >
          Все материалы →
        </Link>
      </div>

      {/* Column count follows the item count. A rubric with a single story must
          not stretch one card across the full 1280px page, so that case caps
          the grid width instead. */}
      <div
        className={cn(
          "grid gap-5",
          articles.length === 1 && "max-w-md",
          articles.length === 2 && "sm:grid-cols-2",
          articles.length === 3 && "sm:grid-cols-2 lg:grid-cols-3",
          articles.length >= 4 && "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {lead ? (
          <div className={articles.length >= 4 ? "sm:col-span-2 lg:col-span-1" : undefined}>
            <ArticleCard article={lead} />
          </div>
        ) : null}

        {rest.map((article) => (
          <ArticleCard key={article.id} article={article} />
        ))}
      </div>
    </section>
  );
}
