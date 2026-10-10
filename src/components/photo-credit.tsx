import { stockCreditLinks } from "@/lib/unsplash";

/**
 * The photo credit under a cover.
 *
 * **Why an Unsplash credit is not just text.** Unsplash's attribution rules ask for the
 * photographer's name to link to their profile and for the reference to link to the photo's
 * page. `photoSource` is rendered as a text node and travels into the RSS feed as text, so
 * a link cannot live there. That is what the four `stock*` columns are for.
 *
 * When those links check out, the linked credit *replaces* the plain one rather than
 * following it. `photoSource` already reads «Фото: Иван Иванов / Unsplash» — printing the
 * linked version underneath would say the same thing twice on the same line, and the
 * second occurrence is what a reader notices. The plain string stays in the database for
 * the datalist and the feed, which cannot render a link at all.
 *
 * Nothing here trusts a stored URL: both addresses are re-parsed and checked to be https
 * on unsplash.com, because they end up in `href` attributes on a public page. A row with a
 * name and no valid profile — a half-written credit, or one left by an older deploy — falls
 * back to the plain text.
 */
export function PhotoCredit({
  author,
  source,
  stock,
}: {
  author?: string | null;
  source?: string | null;
  stock?: {
    stockPhotoId?: string | null;
    stockAuthorName?: string | null;
    stockAuthorUrl?: string | null;
    stockPhotoUrl?: string | null;
  } | null;
}) {
  const links = stock
    ? stockCreditLinks({
        authorName: stock.stockAuthorName ?? "",
        authorUrl: stock.stockAuthorUrl ?? "",
        photoUrl: stock.stockPhotoUrl ?? "",
      })
    : null;

  if (links) {
    return (
      <>
        {author ? <span>© {author} · </span> : null}
        <span>
          {"Фото: "}
          {/*
            The name links to the photographer's profile and the word Unsplash to the
            photograph — the two links the licence asks for, in the order it asks for them.
            `rel="noopener noreferrer"` is explicit rather than inherited: these leave the
            site, and `target="_blank"` is deliberate so that following Unsplash does not
            replace the article the reader is in the middle of.
          */}
          <a href={links.authorUrl} target="_blank" rel="noopener noreferrer">
            {links.authorName}
          </a>{" на "}
          <a href={links.photoUrl} target="_blank" rel="noopener noreferrer">
            Unsplash
          </a>
        </span>
      </>
    );
  }

  const text = [author ? `© ${author}` : "", source ?? ""]
    .filter(Boolean)
    .join(" · ")
    .trim();

  if (!text) return null;

  return <span>{text}</span>;
}