/**
 * Fills the database with realistic demo material so the public pages have a
 * newspaper-shaped dataset to render. Run with: npm run db:seed:demo
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "../src/generated/prisma/client";
import { UPLOAD_DIR } from "../src/lib/upload-dir";
import { coverFileName, renderCoverPng } from "./cover-art";

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  }),
});

const HOUR = 60 * 60 * 1000;

/**
 * Cover art for a demo story, written into UPLOAD_DIR and referenced locally.
 *
 * This used to return a picsum.photos URL. That shipped broken: the VPS gets a
 * 403 from picsum, the optimiser forwards the 403, and the front page rendered
 * broken-image icons. Generating the art keeps `db:seed:demo` hermetic — no
 * network, same bytes on every machine.
 */
function cover(slug: string): string {
  const file = coverFileName(slug);
  writeFileSync(path.join(UPLOAD_DIR, file), renderCoverPng(slug));
  return `/uploads/${file}`;
}

type Demo = {
  slug: string;
  title: string;
  subtitle?: string;
  lead: string;
  body: string;
  category: string;
  hoursAgo: number;
  isExclusive?: boolean;
  is18plus?: boolean;
};

const BODY = `
<p>Решение обсуждали на заседании редакционной коллегии. Участники сходятся во мнении, что изменения затронут ключевые процессы.</p>
<h2>Что именно изменилось</h2>
<p>В работе затронуты несколько направлений. В частности, уточнён порядок взаимодействия между подразделениями и пересмотрены сроки согласования документов.</p>
<blockquote>Мы исходили из того, что читатель должен получать проверенную информацию в первые часы события, — отметил источник в редакции.</blockquote>
<p>Параллельно обсуждались дополнительные меры поддержки. Итоговый план предполагает поэтапное внедрение с промежуточной оценкой результатов.</p>
<ul>
  <li>первый пункт программы;</li>
  <li>второй пункт — уточнение регламента;</li>
  <li>третий пункт — контроль исполнения.</li>
</ul>
<p>Ожидается, что изменения вступят в силу в ближайшем квартале. Детальные разъяснения будут опубликованы позднее.</p>
`;

const DEMOS: Demo[] = [
  {
    slug: "transportnyy-reform-goroda",
    title: "Транспортную сеть города ждёт масштабная реформа",
    subtitle:
      "Маршруты перестроят к осени, а на трёх линиях появятся выделенные полосы",
    lead: "Новая схема движения затронет 14 маршрутов. Что меняется для пассажиров и когда вступят в силу поправки.",
    body: BODY,
    category: "society",
    hoursAgo: 1,
    isExclusive: true,
  },
  {
    slug: "nauka-obnaryzhili-novyy-katalizator",
    title: "Химики получили катализатор, удешевляющий производство водорода",
    lead: "Разработка сокращает число технологических операций почти вдвое, сообщают в лаборатории.",
    body: BODY,
    category: "science",
    hoursAgo: 2,
  },
  {
    slug: "sport-final-kubka-goroda",
    title: "Финал Кубка города: счёт 2:1 и драма в добавленное время",
    lead: "Победу команде принёс гол на 94-й минуте. Трибуны не расходились до полуночи.",
    body: BODY,
    category: "sport",
    hoursAgo: 3,
  },
  {
    slug: "ekonomika-indeks-potrebitelskih-cen",
    title: "Индекс потребительских цен прибавил 0,4% за месяц",
    lead: "Больше всего подорожали продовольственные товары, сообщает статистическая служба.",
    body: BODY,
    category: "economy",
    hoursAgo: 4,
  },
  {
    slug: "proisshestvie-vyshi-na-promyshlennuyu-zonu",
    title: "На промышленной зоне произошёл пожар: эвакуированы 200 человек",
    lead: "Возгорание локализовано за час. Пострадавших нет, причины выясняются.",
    body: BODY,
    category: "incident",
    hoursAgo: 5,
    is18plus: false,
  },
  {
    slug: "politika-seссиya-obshchestva-palaty",
    title: "На сессии общественной палаты обсудили новый городской бюджет",
    subtitle: "Проект рассмотрят в ноябре после доработки замечаний",
    lead: "Главный спор вызвали расходы на благоустройство набережной.",
    body: BODY,
    category: "politics",
    hoursAgo: 6,
  },
  {
    slug: "tehnologii-zapusk-novogo-datalina",
    title: "В городе заработал новый дата-центр мощностью 18 мегаватт",
    lead: "Площадка рассчитана на размещение оборудования для региональных сервисов.",
    body: BODY,
    category: "tech",
    hoursAgo: 7,
  },
  {
    slug: "kultura-vystavka-v-promyshlennom-korpus",
    title: "В бывшем промышленном корпусе открыли выставку о городской истории",
    lead: "Экспозиция разместилась в цехах площадью 1,2 тысячи квадратных метров.",
    body: BODY,
    category: "culture",
    hoursAgo: 8,
  },
  {
    slug: "sport-legkoye-poruchenie-marafon",
    title: "На старт марафона вышли более 8 тысяч бегунов",
    lead: "Дистанция преодолена новым рекордом трассы, пасмурная погода не помешала.",
    body: BODY,
    category: "sport",
    hoursAgo: 9,
  },
  {
    slug: "obshchestvo-novye-marshruty-avtobusov",
    title: "В Городском управлении транспортом сообщили о новых маршрутах автобусов",
    lead: "Изменения коснутся 14 маршрутов и вступят в силу с первого числа следующего месяца.",
    body: BODY,
    category: "society",
    hoursAgo: 11,
  },
  {
    slug: "nauka-issledovanie-lednikov",
    title: "Исследователи описали изменения ледников за последние 30 лет",
    lead: "Данные получены со спутников и уточняют климатические прогнозы для региона.",
    body: BODY,
    category: "science",
    hoursAgo: 13,
  },
  {
    slug: "ekonomika-rynok-arendy-ofisov",
    title: "Рынок аренды офисов замедлил рост после весны",
    lead: "Ставки снижаются в сегменте класса B, свободные площади растут.",
    body: BODY,
    category: "economy",
    hoursAgo: 15,
  },
  {
    slug: "politika-vibory-glavnogo-inzhenera",
    title: "Утверждены кандидатуры на пост главного инженера города",
    lead: "Конкурсная комиссия рассмотрела 14 резюме, окончательное решение — в октябре.",
    body: BODY,
    category: "politics",
    hoursAgo: 18,
  },
  {
    slug: "tehnologii-obyavlenie-gorodskoy-seti",
    title: "В трёх районах обновят городскую сеть связи",
    lead: "Работы пройдут по ночам и не потребуют перебоев в сервисах.",
    body: BODY,
    category: "tech",
    hoursAgo: 20,
  },
  {
    slug: "kultura-teatr-v-odezhde-po-istoriiam",
    title: "Театр представил спектакль по городским легендам",
    lead: "Премьера собрала полный зал в первый же вечер.",
    body: BODY,
    category: "culture",
    hoursAgo: 22,
  },
  {
    slug: "proisshestvie-avtousadilsya-v-metro",
    title: "В метро зафиксировано ДТП с участием служебного транспорта",
    lead: "Пострадавших нет, движение восстановлено в течение часа.",
    body: BODY,
    category: "incident",
    hoursAgo: 26,
  },
  // Enough Спорт material to push the rubric past one 12-item page.
  {
    slug: "sport-sborniki-otpravilis-na-sbory",
    title: "Сборники команды отправились на летние сборы",
    lead: "В заявке 26 футболистов, тренерский штаб объявил состав на вторую неделю подготовки.",
    body: BODY,
    category: "sport",
    hoursAgo: 28,
  },
  {
    slug: "sport-legendarnyy-bombardir-zavershil-kareru",
    title: "Легендарный бомбардир завершил карьеру",
    lead: "Форвард провёл в клубе одиннадцать сезонов и провёл 340 матчей.",
    body: BODY,
    category: "sport",
    hoursAgo: 30,
  },
  {
    slug: "sport-himicheskiy-turnir-smenil-format",
    title: "Химический турнир сменил формат: теперь пятёрка на площадке",
    lead: "Организаторы объяснили решение ростом числа команд-участниц.",
    body: BODY,
    category: "sport",
    hoursAgo: 32,
  },
  {
    slug: "sport-legkoatletika-novye-stan-danny",
    title: "На стадионе открыли восемь новых дорожек",
    lead: "Покрытие отвечает последним требованиям международных стандартов.",
    body: BODY,
    category: "sport",
    hoursAgo: 34,
  },
  {
    slug: "sport-voleybolistki-vysheli-v-final",
    title: "Волейболистки вышли в финал плей-офф",
    lead: "Матч-пятисетка завершился победой хозяек площадки.",
    body: BODY,
    category: "sport",
    hoursAgo: 36,
  },
  // Enough Спорт material to push the rubric past one 12-item page.
  {
    slug: "sport-shahmatist-obigral-grandmastera",
    title: "Шахматист обыграл гроссмейстера в турнире претендентов",
    lead: "Партия завершилась на 38-м ходу и обещала ничью до последнего момента.",
    body: BODY,
    category: "sport",
    hoursAgo: 38,
  },
  {
    slug: "sport-bokser-naibolshiy-nokaut",
    title: "Боксёр удержал пояс после самого короткого нокаута в году",
    lead: "Бой остановили на 47-й секунде второго раунда.",
    body: BODY,
    category: "sport",
    hoursAgo: 40,
  },
  {
    slug: "sport-plovchik-ustanovil-rekord",
    title: "Пловчиха установила рекорд турнира на дистанции 200 метров",
    lead: "Прежнее достижение продержалось четыре года.",
    body: BODY,
    category: "sport",
    hoursAgo: 42,
  },
  {
    slug: "sport-veloprokat-otkryt-prokat",
    title: "В городе открыли новый велопрокат на 800 велосипедов",
    lead: "Пункты выдачи работают круглосуточно, абонементы доступны онлайн.",
    body: BODY,
    category: "sport",
    hoursAgo: 44,
  },
  {
    slug: "sport-stadion-gotovy-k-chempionatu",
    title: "Стадион готов к чемпионату: осталось проверить трибуны",
    lead: "Проверку комиссии назначили на конец недели.",
    body: BODY,
    category: "sport",
    hoursAgo: 46,
  },
  {
    slug: "sport-lyubitelskiy-sport-bez-limitov",
    title: "Любительский спорт без ограничений: кто смотрит такие трансляции",
    lead: "Матчи любительских лиг собирают больше зрителей, чем ожидалось.",
    body: BODY,
    category: "sport",
    hoursAgo: 48,
  },
  {
    slug: "sport-sportivnaya-akciya-sbor-sredstv",
    title: "Спортивная акция собрала средства на новые площадки",
    lead: "В акции приняли участие более двух тысяч человек.",
    body: BODY,
    category: "sport",
    hoursAgo: 50,
  },
];

async function main() {
  // The uploads directory is outside public/ and is not in version control, so a
  // fresh checkout or a wiped deploy volume has to have it created before the
  // covers below are written.
  mkdirSync(UPLOAD_DIR, { recursive: true });

  const categories = await prisma.category.findMany({
    select: { id: true, name: true, slug: true },
  });
  const bySlug = new Map(categories.map((c) => [c.slug, c.id]));

  // Ensure every rubric used below exists.
  const needed = [...new Set(DEMOS.map((demo) => demo.category))];
  const names: Record<string, string> = {
    politics: "Политика",
    society: "Общество",
    science: "Наука",
    sport: "Спорт",
    economy: "Экономика",
    culture: "Культура",
    tech: "Технологии",
    incident: "Происшествия",
  };

  for (const slug of needed) {
    if (!bySlug.has(slug)) {
      const created = await prisma.category.create({
        data: { slug, name: names[slug] ?? slug },
        select: { id: true },
      });
      bySlug.set(slug, created.id);
    }
  }

  const now = Date.now();

  for (const demo of DEMOS) {
    // `category` is a slug here but a relation in the schema, so it is pulled
    // out of the spread and passed as categoryId.
    const { hoursAgo, body, category, ...rest } = demo;
    const coverImage = cover(demo.slug);
    await prisma.article.upsert({
      where: { slug: demo.slug },
      // Re-run the cover rewrite on every seed: the artwork lives outside the
      // database, so converging it is what makes the fixture reproducible after
      // a schema change, a new palette, or a half-finished previous run.
      update: { coverImage },
      create: {
        ...rest,
        subtitle: rest.subtitle ?? null,
        contentHtml: body.trim(),
        coverImage,
        status: "published",
        publishedAt: new Date(now - hoursAgo * HOUR),
        categoryId: bySlug.get(category) ?? null,
        isDzen: true,
        isVk: false,
        isExclusive: demo.isExclusive ?? false,
        is18plus: demo.is18plus ?? false,
      },
    });
  }

  console.log(`Демо-материалы готовы: ${DEMOS.length}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
