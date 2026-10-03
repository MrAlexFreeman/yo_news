import type { Metadata } from "next";
import Link from "next/link";

import { getTagsWithPublishedArticles } from "@/lib/public-queries";
import { plural } from "@/lib/date";
import { SITE_NAME } from "@/lib/site";

export const revalidate = 300;

export const metadata: Metadata = {
  title: `Тэги — ${SITE_NAME}`,
  description: "Все теги издания и материалы по каждому из них.",
  alternates: { canonical: "/tags" },
};

export default async function TagsIndexPage() {
  const tags = await getTagsWithPublishedArticles();

  return (
    <div>
      <header className="border-b-2 border-ink pb-3">
        <h1 className="masthead text-3xl text-ink sm:text-4xl">Тэги</h1>
        <p className="mt-1.5 text-xs text-ink-soft">
          {tags.length} {plural(tags.length, "тэг", "тэга", "тэгов")}
        </p>
      </header>

      {tags.length === 0 ? (
        <p className="py-16 text-center text-sm text-ink-soft">
          Пока ни один материал не размечен тэгами.
        </p>
      ) : (
        <ul className="mt-6 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag.id}>
              <Link
                href={`/tags/${tag.slug}`}
                className="inline-flex items-center rounded-full border border-rule bg-white px-3.5 py-1.5 text-sm font-semibold tracking-wide text-ink-soft transition-all hover:border-yo hover:bg-yo/5 hover:text-yo-ink hover:shadow-xs"
              >
                {tag.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}