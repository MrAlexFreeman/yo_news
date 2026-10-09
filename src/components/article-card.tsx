import Link from "next/link";

import { CoverImage } from "@/components/cover-image";
import type { ArticleListItem } from "@/lib/public-queries";
import { formatDate, formatTime } from "@/lib/date";
import { SITE_SHORT_NAME } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * The headline link's hover behaviour, shared by every card variant.
 *
 * A one-pixel underline set a little away from the text (WaPo's house style) plus the
 * accent colour. `group-hover` so the whole card is the target — pointing anywhere on
 * it, including the picture, reacts — and the plain `hover` so the link still responds
 * when the pointer is on the text itself and for the keyboard focus ring.
 */
const HEADLINE_LINK =
  "transition-colors hover:text-accent group-hover:text-accent hover:underline group-hover:underline decoration-1 underline-offset-4";

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
      <span
        className={cn(
          "text-[10px] font-bold tracking-[0.14em] uppercase",
          className,
        )}
      >
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
        "inline-flex min-h-6 items-center py-0.5 text-[10px] font-bold tracking-[0.14em] text-accent uppercase hover:underline decoration-1 underline-offset-4",
        className,
      )}
    >
      {name}
    </Link>
  );
}

/**
 * Exclusive / 18+ badges shown next to the rubric.
 *
 * Exported because the front page's lead column prints its own rubric line and still has
 * to carry the badges: «Эксклюзив» is the one marker that tells an editor and a reader the
 * story is the desk's own, and dropping it from the front page would make the flagship
 * position look like any other.
 */
export function Badges({ article }: { article: ArticleListItem }) {
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
      <CoverImage
        src={article.coverImage}
        alt=""
        sizes={sizes}
        // Next 16 deprecated `priority`; `preload` is the replacement and is
        // only correct for the single LCP candidate on the page.
        preload={preload}
        className={className}
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
  /**
   * `default` for section grids, `compact` for rails and sidebars.
   *
   * There was a third, `lead`, for the hero slot. It is gone because the front page's lead
   * column is its own component now — `FrontPageHero` — and it prints the headline before
   * the picture, with a metadata line under it, which is the order a newspaper uses and
   * the reverse of what the old variant did. Keeping both would mean two ways to render the
   * same thing, and the one nobody edits.
   */
  variant?: "default" | "compact";
  /**
   * Thumbnail size for `compact` only.
   *
   * `sm` is an 80px square for narrow columns like the "Читайте сейчас" rail.
   * `lg` is a 4:3 block for wide slots like "Другие события дня", where an 80px square
   * reads as a stamp rather than as a picture of the story. Two sizes rather than one
   * because one number cannot serve both: the rail is four columns on a desktop
   * screen and `lg` thumbnails there would crowd out the headlines.
   */
  preview?: "sm" | "lg";
  /** Set only on the single above-the-fold cover that is the LCP candidate. */
  preload?: boolean;
  /**
   * Heading level for the story headline. Defaults to 3, which is correct inside
   * a section that already carries an h2. On pages where the cards sit directly
   * under the page h1, pass 2 so the outline does not skip a level.
   */
  headingLevel?: 2 | 3;
};

/** Thumbnail box and the `sizes` hint that has to agree with it. */
const COMPACT_PREVIEW = {
  sm: { box: "aspect-square w-20 rounded-sm", sizes: "80px" },
  lg: { box: "h-18 w-24 sm:h-20 sm:w-28 rounded-md", sizes: "112px" },
} as const;

/**
 * The reusable story card. One component keeps padding, headline sizes and
 * badge placement consistent across the hero, the rails and the section grids.
 */
export function ArticleCard({
  article,
  variant = "default",
  preview = "sm",
  preload = false,
  headingLevel = 3,
}: ArticleCardProps) {
  const href = `/news/${article.slug}`;
  const timestamp = article.publishedAt ?? article.createdAt;

  if (variant === "compact") {
    const thumb = COMPACT_PREVIEW[preview];

    return (
      <article className="group flex gap-3 border-b border-rule/70 py-2.5 last:border-b-0">
        {/*
          `self-start` is load-bearing, not decoration. The card is a flex row and
          flex items stretch across the cross axis by default, so the thumbnail was
          being pulled to the height of the text column beside it — 80 wide and 86 tall
          in practice, which silently defeats `aspect-square` and makes the crop
          something other than the square it asks for. Opting out of the stretch lets
          the box keep the height its ratio implies.
        */}
        <div className={cn("relative shrink-0 self-start overflow-hidden bg-paper-dim", thumb.box)}>
          <Cover article={article} sizes={thumb.sizes} className="transition-transform duration-300 group-hover:scale-105" />
        </div>
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {article.category ? (
              <RubricLabel name={article.category.name} slug={article.category.slug} />
            ) : null}
            <Badges article={article} />
          </div>
          <h3 className="clamp-3 text-sm leading-snug font-semibold text-ink">
            {/*
              Two hover rules on one headline, and the second is the wider one. The
              card is the `group` — its thumbnail already zooms on hover from anywhere
              in the card — so pointing at the group keeps the headline reacting to the
              same gesture as the picture beside it. The plain `hover` on the link is
              kept for the case where the pointer is over the text itself, which the
              group rule already covers, and because it is the rule a keyboard focus
              ring inherits.
            */}
            <Link href={href} className={HEADLINE_LINK}>
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
          className="clamp-3 font-[family-name:var(--font-lora)] text-base leading-snug font-bold tracking-tight text-ink"
        >
          <Link href={href} className={HEADLINE_LINK}>
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
