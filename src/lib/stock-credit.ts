import { stockCreditLinks } from "@/lib/unsplash";

/**
 * The Unsplash credit columns, read out of a submitted form.
 *
 * Four hidden fields carrying what the licence requires to be clickable: the
 * photographer's name, their profile and the photo's page. They ride in the same
 * `FormData` as everything else, which means an editor — or anything that can post to
 * this action — can write them by hand. So they are re-checked here rather than stored on
 * trust, and all four are set together or dropped together.
 *
 * Dropping them together is the point. A half-written credit is worse than none: the
 * caption would print a name with no link, or a link to a page that is not the photograph,
 * and the attribution would look complete while breaking the terms it exists to satisfy.
 *
 * `stockCreditLinks` is the same function the public caption uses, so what is stored and
 * what a reader sees cannot come to disagree — one rule, two places that must agree.
 */

export type StockCreditColumns = {
  stockPhotoId: string | null;
  stockAuthorName: string | null;
  stockAuthorUrl: string | null;
  stockPhotoUrl: string | null;
};

const EMPTY: StockCreditColumns = {
  stockPhotoId: null,
  stockAuthorName: null,
  stockAuthorUrl: null,
  stockPhotoUrl: null,
};

/** Unsplash photo ids are short and URL-safe. */
const PHOTO_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

export function stockCreditColumns(formData: FormData): StockCreditColumns {
  const read = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value.trim() : "";
  };

  const photoId = read("stockPhotoId");
  const links = stockCreditLinks({
    authorName: read("stockAuthorName"),
    authorUrl: read("stockAuthorUrl"),
    photoUrl: read("stockPhotoUrl"),
  });

  // Any one of them missing or wrong and the whole credit is discarded.
  if (!links || !PHOTO_ID_PATTERN.test(photoId)) return EMPTY;

  return {
    stockPhotoId: photoId,
    stockAuthorName: links.authorName,
    stockAuthorUrl: links.authorUrl,
    stockPhotoUrl: links.photoUrl,
  };
}