import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EntityFacts, EntityGallery } from "@/components/entity-card";
import { entityHref, isValidEntitySlug } from "@/lib/entity-card";
import { getEntityCard } from "@/lib/entities";
import { siteUrl } from "@/lib/site";

/**
 * `/entities/<slug>` — the card as its own page.
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
    description: card.summary.slice(0, 160),
    alternates: { canonical: entityHref(card.slug) },
    openGraph: {
      title,
      description: card.summary.slice(0, 200),
      url: entityHref(card.slug),
      // The first picture is the card's face; a reference entry with a photograph is
      // worth the link, and without one the page would share the site's default image.
      ...(card.images[0]
        ? { images: [{ url: `${siteUrl}${card.images[0]}`, width: 1200, height: 675 }] }
        : {}),
    },
  };
}

export default async function EntityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!isValidEntitySlug(slug)) notFound();

  const card = await getEntityCard(slug);
  if (!card) notFound();

  return (
    <div className="mx-auto max-w-2xl py-8">
      <nav aria-label="Хлебные крошки" className="mb-4 text-[11px] text-ink-soft">
        <Link href="/" className="hover:text-accent">
          Главная
        </Link>
        <span aria-hidden className="px-1.5">
          /
        </span>
        <span>Карточка объекта</span>
      </nav>

      <article>
        {card.category ? (
          <p className="entity-card-eyebrow mb-1 text-ink-soft">{card.category}</p>
        ) : null}

        <h1 className="text-3xl font-serif font-bold leading-tight text-ink">{card.title}</h1>

        {card.images.length > 0 ? (
          <div className="mt-5">
            <EntityGallery images={card.images} alt={card.title} />
          </div>
        ) : null}

        <EntityFacts card={card} />

        <p className="mt-4 text-base leading-relaxed text-neutral-700">{card.summary}</p>

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
    </div>
  );
}