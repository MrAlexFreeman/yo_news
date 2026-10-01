import type { Metadata } from "next";

import { SITE_LEGAL_NAME, SITE_NAME, absoluteUrl } from "@/lib/site";

export const revalidate = 86400;

export const metadata: Metadata = {
  title: "О редакции и правовая информация",
  description: `Сведения об издателе, редакции и правовая информация ${SITE_NAME}.`,
  alternates: { canonical: "/about" },
};

const BLOCKS = [
  {
    title: "Об издании",
    body: `${SITE_LEGAL_NAME}. Учредитель и издатель: редакция ${SITE_NAME}. Тираж: электронная версия, публикация в сети Интернет.`,
  },
  {
    title: "Редакция",
    body: "Редакция несёт ответственность за достоверность и полноту материалов. Авторство материала указывается в подписи. За точность фактов редакция не отвечает, если иное прямо не установлено нормативным актом.",
  },
  {
    title: "Авторские права",
    body: "Все материалы, изображения и элементы оформления охраняются законом об авторском праве. Использование материалов без письменного разрешения правообладателя не допускается. Гиперссылка на первоисточник при цитировании обязательна.",
  },
  {
    title: "Реклама и партнёрские материалы",
    body: "Рекламные материалы публикуются в соответствии с Федеральным законом «О рекламе». Ответственность за достоверность рекламных сведений несёт рекламодатель. Пометка «На правах рекламы» обязательна.",
  },
  {
    title: "Персональные данные",
    body: "Обработка персональных данных пользователей осуществляется в соответствии с Федеральным законом «О персональных данных». Cookie-файлы используются для корректной работы сервисов.",
  },
  {
    title: "RSS-лента",
    body: `Лента для агрегаторов доступна по адресу ${absoluteUrl("/api/feed/dzen.xml")}.`,
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="border-b-2 border-ink pb-3">
        <h1 className="masthead text-3xl text-ink sm:text-4xl">
          О редакции
        </h1>
      </header>

      <div className="mt-6 space-y-6">
        {BLOCKS.map((block) => (
          <section key={block.title}>
            <h2 className="text-sm font-bold tracking-wide text-ink uppercase">
              {block.title}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
              {block.body}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
