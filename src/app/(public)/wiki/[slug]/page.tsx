import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EntityFacts, EntityGallery } from "@/components/entity-card";
import { entityHref, isValidEntitySlug } from "@/lib/entity-card";
import {
  countPublishedMentions,
  getArticlesMentioningEntity,
  getEntityCard,
} from "@/lib/entities";
import { formatDateTime } from "@/lib/date";
import { siteUrl } from "@/lib/site";

/**
 * `/wiki/<slug>` — the card as its own page.
 *
 * Not a convenience: a link to a card is a real address inside a published article, and
 * the popover that usually opens it is script. A reader whose JavaScript is off, a
 * crawler, and every syndicated copy of the story all arrive here instead of a blank
 * anchor or, worse, a dead link nobody had checked. The popover is the enhancement; this
 * is the link.
 *
 * Metadata is generated per card, which is what makes the page worth indexing — it is a
 * reference entry, not a duplicate of the article that mentions it.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!isValidEntitySlug(slug)) return { title: "Карточка не найдена", robots: { index: false } };

  const card = await getEntityCard(slug);
  if (!card) return { title: "Карточка не найдена", robots: { index: false } };

  const title = card.category ? `${card.title} — ${card.category}` : card.title;

  return {
    title,
    // The description is a paragraph now, not a sentence: cut for the meta tag rather than
    // sent whole, and cut at a word so the snippet does not end mid-syllable.
    description: excerpt(card.summary, 160),
    alternates: { canonical: entityHref(card.slug) },
    openGraph: {
      title,
      description: excerpt(card.summary, 200),
      url: entityHref(card.slug),
      // The first picture is the card's face; a reference entry with a photograph is
      // worth the link, and without one the page would share the site's default image.
      ...(card.images[0]
        ? { images: [{ url: `${siteUrl}${card.images[0]}`, width: 1200, height: 675 }] }
        : {}),
    },
  };
}

/** A summary cut to a length, preferring to end on a word rather than inside one. */
function excerpt(text: string, limit: number): string {
  const value = text.trim().replace(/\s+/g, " ");
  if (value.length <= limit) return value;

  const cut = value.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export default async function WikiPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isValidEntitySlug(slug)) notFound();

  const card = await getEntityCard(slug);
  if (!card) notFound();

  const [articles, mentions] = await Promise.all([
    getArticlesMentioningEntity(slug),
    countPublishedMentions(slug),
  ]);

  return (
    <div className="mx-auto max-w-2xl py-8">
      <nav aria-label="Хлебные крошки" className="mb-4 text-[11px] text-ink-soft">
        <Link href="/" className="hover:text-accent">
          Главная
        </Link>
        <span aria-hidden className="px-1.5">
          /
        </span>
        <span>Справочник</span>
      </nav>

      <article>
        {card.category ? (
          <p className="entity-card-eyebrow mb-1 text-ink-soft">{card.category}</p>
        ) : null}

        <h1 className="font-serif text-3xl font-bold leading-tight text-ink">{card.title}</h1>

        {card.images.length > 0 ? (
          <div className="mt-5">
            <EntityGallery images={card.images} alt={card.title} />
          </div>
        ) : null}

        <EntityFacts card={card} />

        {/*
          The description is printed whole and split into paragraphs on its own blank lines.

          A reference entry is allowed to be a page long — that is what the raised limit is
          for — and a single `<p>` of eight hundred words is unreadable. Splitting on the
          blank lines the editor typed keeps their structure without needing markup in the
          column, and `whitespace-pre-line` is deliberately *not* used: it would render the
          single newlines inside a paragraph as breaks too, which is not what they mean.
        */}
        {card.summary
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
          .map((paragraph, index) => (
            <p
              key={index}
              className={index === 0 ? "mt-4 text-base leading-relaxed text-neutral-700" : "mt-3 text-base leading-relaxed text-neutral-700"}
            >
              {paragraph}
            </p>
          ))}

        {card.websiteUrl ? (
          <a
            href={card.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
          >
            Официальный сайт
          </a>
        ) : null}
      </article>

      {/*
        The way back out.

        A card is reached from a story, so the page that explains the place should show the
        stories that talk about it — otherwise the reader who followed a link from an
        article lands on a dead end and goes back where they came from. Rendered only when
        there is something to show: an empty heading under a finished entry reads as a
        mistake rather than as a card nothing links yet.
      */}
      {articles.length > 0 ? (
        <section aria-labelledby="mentions-heading" className="mt-10 border-t border-rule/70 pt-5">
          <h2
            id="mentions-heading"
            className="text-xs font-semibold tracking-wider text-ink-soft uppercase"
          >
            Материалы по теме
            <span className="ml-1.5 font-normal normal-case">({mentions})</span>
          </h2>

          <ul className="mt-3 divide-y divide-rule/50">
            {articles.map((item) => (
              <li key={item.id} className="py-2.5">
                <Link
                  href={`/news/${item.slug}`}
                  className="text-base font-semibold leading-snug text-ink transition-colors hover:text-accent hover:underline decoration-1 underline-offset-4"
                >
                  {item.title}
                </Link>
                {item.publishedAt ? (
                  <p className="mt-0.5 text-[11px] text-ink-soft">
                    {formatDateTime(item.publishedAt)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
