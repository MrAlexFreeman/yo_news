import { Rss } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import {
  SITE_LEGAL_NAME,
  SITE_TAGLINE_LONG,
  VK_COMMUNITY_URL,
} from "@/lib/site";

// The CMS lives behind /admin and is deliberately absent here: a reader should
// not be offered a link to the editorial desk.
const NAV_LINKS = [
  { href: "/", label: "Главная" },
  { href: "/category/tech", label: "Технологии" },
  { href: "/tags", label: "Тэги" },
  { href: "/forum", label: "Форум" },
  { href: "/about", label: "О редакции" },
];

const LEGAL_LINKS = [
  { href: "/about", label: "О редакции" },
  { href: "/about", label: "Реклама" },
  { href: "/about", label: "Политика конфиденциальности" },
];

/** Slim footer with the syndication feed and the mandatory media disclaimers. */
export function PublicFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t-4 border-double border-rule bg-paper-dim">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="flex flex-col gap-6 md:flex-row md:justify-between">
          <div className="max-w-md">
            <Link href="/">
              <Logo size="md" />
            </Link>
            <p className="mt-2 text-xs font-medium text-ink-soft">
              {SITE_LEGAL_NAME}
            </p>
            <p className="mt-1 text-xs text-ink-soft">{SITE_TAGLINE_LONG}</p>
            <p className="mt-3 text-xs leading-relaxed text-ink-soft">
              Материалы, опубликованные на сайте, охраняются законом об авторском
              праве. Перепечатка и цитирование допускаются со ссылкой на
              источник. За содержание рекламных материалов редакция не отвечает.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Link
                href="/api/feed/dzen.xml"
                className="inline-flex min-h-6 items-center gap-1.5 text-xs font-medium text-accent-ink hover:underline"
              >
                <Rss className="size-3.5" aria-hidden />
                RSS-лента для Яндекс Дзена
              </Link>
              <a
                href={VK_COMMUNITY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-6 items-center text-xs font-medium text-ink-soft hover:text-accent"
              >
                Мы во ВКонтакте
              </a>
            </div>
          </div>

          <nav aria-label="Разделы сайта" className="text-xs">
            <p className="mb-2 font-semibold tracking-wide text-ink uppercase">
              Разделы
            </p>
            <ul className="space-y-1.5">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-6 items-center text-ink-soft transition-colors hover:text-accent"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Правовая информация" className="text-xs">
            <p className="mb-2 font-semibold tracking-wide text-ink uppercase">
              Правовая информация
            </p>
            <ul className="space-y-1.5">
              {LEGAL_LINKS.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-6 items-center text-ink-soft transition-colors hover:text-accent"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <p className="mt-8 border-t border-rule pt-4 text-[11px] text-ink-soft">
          © {year} {SITE_LEGAL_NAME}. Все права защищены.
        </p>
      </div>
    </footer>
  );
}
