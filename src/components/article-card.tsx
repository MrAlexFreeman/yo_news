import Image from "next/image";
import Link from "next/link";

import type { ArticleListItem } from "@/lib/public-queries";
import { formatDate, formatTime } from "@/lib/date";
import { SITE_SHORT_NAME } from "@/lib/site";
import { cn } from "@/lib/utils";

/** Small caps rubric label used above headlines. */
export function RubricLabel({
  name,
  slug,
  className,
}: {
  name: string;
  slug?: string;
  className?: string;
}) {
  if (!slug) {
    return (
      <span className={cn("text-[10px] font-semibold tracking-wider uppercase", className)}>
        {name}
      </span>
    );
  }

  return (
    // Inline-flex with padding: a bare 10px uppercase label is only ~15px tall,
    // which is below the 24px WCAG 2.2 minimum target size on touch screens.
    <Link
      href={`/category/${slug}`}
      className={cn(
        "inline-flex min-h-6 items-center py-0.5 text-[10px] font-semibold tracking-wider text-accent uppercase hover:underline",
        className,
      )}
    >
      {name}
    </Link>
  );
}

/** Exclusive / 18+ badges shown next to the rubric. */
function Badges({ article }: { article: ArticleListItem }) {
  if (!article.isExclusive && !article.is18plus) return null;

  return (
    <span className="flex items-center gap-1">
      {article.isExclusive ? (
        <span className="rounded-sm bg-accent px-1.5 py-px text-[9px] font-bold tracking-wide text-white uppercase">
          Эксклюзив
        </span>
      ) : null}
      {article.is18plus ? (
        <span className="rounded-sm border border-ink-soft px-1 py-px text-[9px] font-bold tracking-wide text-ink-soft">
          18+
        </span>
      ) : null}
    </span>
  );
}

/**
 * Cover image, or a typographic placeholder when the story has none. Keeps the
 * grid from collapsing without requiring every article to have artwork.
 */
function Cover({
  article,
  sizes,
  preload = false,
  className,
}: {
  article: ArticleListItem;
  sizes: string;
  /** Load eagerly: only the above-the-fold LCP candidate should set this. */
  preload?: boolean;
  className?: string;
}) {
  if (article.coverImage) {
    return (
      <Image
        src={article.coverImage}
        alt=""
        fill
        sizes={sizes}
        // Next 16 deprecated `priority`; `preload` is the replacement and is
        // only correct for the single LCP candidate on the page.
        preload={preload}
        className={cn("object-cover", className)}
      />
    );
  }

  return (
    <div
      aria-hidden
      className={cn(
        "flex items-center justify-center bg-gradient-to-br from-paper-dim to-rule/60",
        className,
      )}
    >
      <span className="masthead px-3 text-center text-2xl text-ink-soft/40">
        {article.category?.name ?? SITE_SHORT_NAME}
      </span>
    </div>
  );
}

/** Renders a dynamic h2/h3 with matching classes. */
function Heading({
  level,
  className,
  children,
}: {
  level: 2 | 3;
  className?: string;
  children: React.ReactNode;
}) {
  return level === 2 ? (
    <h2 className={className}>{children}</h2>
  ) : (
    <h3 className={className}>{children}</h3>
  );
}

type ArticleCardProps = {
  article: ArticleListItem;
  /** `lead` for the hero slot, `default` for section grids, `compact` for rails. */
  variant?: "lead" | "default" | "compact";
  /** Set only on the single above-the-fold cover that is the LCP candidate. */
  preload?: boolean;
  /**
   * Heading level for the story headline. Defaults to 3, which is correct inside
   * a section that already carries an h2. On pages where the cards sit directly
   * under the page h1, pass 2 so the outline does not skip a level.
   */
  headingLevel?: 2 | 3;
};

/**
 * The reusable story card. One component keeps padding, headline sizes and
 * badge placement consistent across the hero, the rails and the section grids.
 */
export function ArticleCard({
  article,
  variant = "default",
  preload = false,
  headingLevel = 3,
}: ArticleCardProps) {
  const href = `/news/${article.slug}`;
  const timestamp = article.publishedAt ?? article.createdAt;

  if (variant === "compact") {
    return (
      <article className="group flex gap-3 py-3">
        <div className="relative aspect-square w-20 shrink-0 overflow-hidden rounded-sm bg-paper-dim">
          <Cover article={article} sizes="80px" className="transition-transform duration-300 group-hover:scale-105" />
        </div>
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {article.category ? (
              <RubricLabel name={article.category.name} slug={article.category.slug} />
            ) : null}
            <Badges article={article} />
          </div>
          <h3 className="clamp-3 text-sm leading-snug font-semibold text-ink">
            <Link href={href} className="hover:text-accent">
              {article.title}
            </Link>
          </h3>
          {article.lead ? (
            <p className="clamp-2 mt-1 text-xs leading-relaxed text-ink-soft">
              {article.lead}
            </p>
          ) : null}
          <time
            dateTime={timestamp.toISOString()}
            className="mt-1 block text-[10px] text-ink-soft"
          >
            {formatDate(timestamp)}
          </time>
        </div>
      </article>
    );
  }

  if (variant === "lead") {
    return (
      <article className="group">
        <div className="relative aspect-[16/9] overflow-hidden rounded-sm bg-paper-dim">
          <Cover article={article} sizes="(max-width: 1024px) 100vw, 640px" preload={preload} className="transition-transform duration-500 group-hover:scale-[1.03]" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {article.category ? (
            <RubricLabel name={article.category.name} slug={article.category.slug} />
          ) : null}
          <Badges article={article} />
          {/* Decorative separator; the divider colour is too light to pass a
              contrast audit, so it is muted instead. */}
          <span aria-hidden className="text-ink-soft/40">
            |
          </span>
          <time
            dateTime={timestamp.toISOString()}
            className="text-[10px] text-ink-soft"
          >
            {formatTime(timestamp)} · {formatDate(timestamp)}
          </time>
        </div>

        <h1 className="mt-2 font-[family-name:var(--font-lora)] text-3xl leading-[1.12] font-bold text-ink sm:text-4xl lg:text-[2.75rem]">
          <Link href={href} className="transition-colors hover:text-accent">
            {article.title}
          </Link>
        </h1>

        {article.subtitle || article.lead ? (
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-soft sm:text-lg">
            {article.subtitle ?? article.lead}
          </p>
        ) : null}
      </article>
    );
  }

  return (
    <article className="group flex h-full flex-col">
      <div className="relative aspect-[3/2] overflow-hidden rounded-sm bg-paper-dim">
        <Cover article={article} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 300px" preload={preload} className="transition-transform duration-300 group-hover:scale-105" />
      </div>

      <div className="mt-2.5 flex flex-1 flex-col">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          {article.category ? (
            <RubricLabel name={article.category.name} slug={article.category.slug} />
          ) : null}
          <Badges article={article} />
        </div>

        <Heading
          level={headingLevel}
          className="clamp-3 font-[family-name:var(--font-lora)] text-base leading-snug font-bold text-ink"
        >
          <Link href={href} className="transition-colors hover:text-accent">
            {article.title}
          </Link>
        </Heading>

        {article.lead ? (
          <p className="clamp-2 mt-1.5 text-xs leading-relaxed text-ink-soft">
            {article.lead}
          </p>
        ) : null}

        <time
          dateTime={timestamp.toISOString()}
          className="mt-auto pt-2 text-[10px] text-ink-soft"
        >
          {formatDate(timestamp)}
        </time>
      </div>
    </article>
  );
}
