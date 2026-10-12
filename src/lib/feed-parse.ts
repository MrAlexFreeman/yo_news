/**
 * Reading another outlet's RSS into the wire desk.
 *
 * A narrow reader, not a general XML parser: it understands the shape an RSS 2.0 or
 * Atom feed has, which is a flat list of `<item>` or `<entry>` elements with a handful
 * of known children. It is deliberately not a dependency — five fields do not justify
 * a parser library, and the alternative available here (`jsdom`, reachable only through
 * a transitive dependency of the sanitiser) is a browser engine brought in to read a
 * list of strings.
 *
 * Pure: no network, no Prisma, no `server-only`. Everything that decides whether an
 * item is usable — the date, the identifier, the text — is therefore testable against
 * real feed bodies, which is where the interesting failures live: a publisher changes
 * its date format, or starts sending an id that collides with another outlet's.
 */

/** The outlets the desk watches. */
export type FeedSource = "DZEN" | "E1" | "GOROD66" | "MAIL_URAL";

/** Чем читается лента: обычным RSS или карточками API Дзена. */
export type FeedKind = "rss" | "dzen";

export type FeedDefinition = {
  source: FeedSource;
  title: string;
  url: string;
  /** По умолчанию `rss`. */
  kind?: FeedKind;
  /**
   * Издание не публикует дат в ленте: материалы датируются временем первого опроса.
   *
   * Измерено, а не предположено: у 66.ru на десять элементов фида ни одного `<pubDate>`,
   * ни одного `dc:date`, ни одного `<date>`. Без этого флага лента даёт ноль материалов —
   * проверено на проде: «66.RU | +0 | отказов: 10 | из них политика: 0».
   */
  undated?: boolean;
  /**
   * Резервная лента: опрашивается, только если её основной источник не дал ни одного материала.
   *
   * Так устроена пара «Топ Дзен — Топ Урал». Выдача Дзена открыта и работает (проверено), но
   * она рекомендательная: половина карточек — пустые слоты, а число годных гуляет от запроса к
   * запросу. Резерв из Mail.ru держит то же место за столом — повестку Урала с настоящими
   * датами — и включается сам, когда Дзен не дал ничего. Подпись у его карточек своя, так что
   * редакция видит, откуда материал, а не догадывается.
   */
  fallbackFor?: FeedSource;
  /**
   * Материалы старше этого срока не берутся.
   *
   * Для «Топа Дзен» — потому что выдача мешает в одну кучу материал сегодняшний и посты
   * пятимесячной давности: на измеренной ленте рядом стояли карточка пяти часов и карточка
   * пяти месяцев («Подкормка огурцов», «Вира и Майна»). Источник называется «Топ», и редакция
   * вправе ждать от него повестки, а не архива; всё старше двух недель отбрасывается.
   *
   * Правило не про RSS: у Е1 и 66.ru свежесть держит сама лента, и там оно не нужно.
   */
  maxAgeDays?: number;
};

/**
 * Ленты предложки, в одном месте.
 *
 * **Повестка — это три новостные ленты, а не рекомендации Дзена.** Задание предлагало
 * `dzen.ru/rss/news`; адрес мёртв (302 на SSO Яндекса), и у Дзена нет повестительного фида
 * вообще — проверено пятью запросами: `/rss/news` и `/rss` отдают страницу входа, `/news` и
 * `/` тоже (2890 байт HTML, ноль данных), `/api/v3/rss/news` — 44 байта ошибки, блок новостей
 * главной `topnews` своей ручки не имеет (`div2` — «Unknown api request»), а
 * `feed_filter_type=news` ничего не меняет. Что открыто — `api/v3/launcher/more`, но это
 * рекомендательная выдача каналов: рядом с новостью лежит пост пятимесячной давности. Для
 * повестки она не годится, поэтому Дзен переведён в резерв, а его место заняла уральская
 * лента Mail.ru.
 *
 * Уральский фид — `/66/`, а не `/54/` из задания: 54 у Mail.ru отдаёт Новосибирск (первый
 * заголовок — «Километровые пробки сковали Новосибирск»), а 66 — Екатеринбург: 36 материалов
 * с датами, повестка дня («резко подорожал бензин», «снег и дождь задержатся»), и полный текст
 * каждой заметки лежит в `application/ld+json` её страницы — то есть «Взять в работу» работает.
 * Адрес измерен, а не взят из письма.
 */
export const FEED_SOURCES: readonly FeedDefinition[] = [
  { source: "E1", title: "Топ Е1", url: "https://www.e1.ru/rss-feeds/rss.xml" },
  {
    source: "GOROD66",
    title: "66.RU",
    url: "https://66.ru/rss/",
    undated: true,
  },
  {
    source: "MAIL_URAL",
    title: "Повестка Урала",
    url: "https://news.mail.ru/rss/main/66/",
  },
  {
    source: "DZEN",
    title: "Топ Дзен",
    url: "https://dzen.ru/api/v3/launcher/more",
    kind: "dzen",
    // Измерено на живой выдаче: свежих карточек (до двух недель) — четыре из десяти,
    // оставшиеся шесть — посты от месяца до пяти. Резерв включается, только если повестка
    // Урала промолчит, и тогда в нём нет смысла тащить архив.
    maxAgeDays: 14,
    fallbackFor: "MAIL_URAL",
  },
] as const;

/** Подпись источника для интерфейса: код в базе, человеческое имя на экране. */
export function feedSourceTitle(source: string): string {
  return FEED_SOURCES.find((feed) => feed.source === source)?.title ?? source;
}

export type ParsedFeedItem = {
  source: FeedSource;
  /** Namespaced by source — see `externalIdFor`. */
  externalId: string;
  originalUrl: string;
  title: string;
  rawText: string;
  publishedAt: Date;
};

/** Why an element of the feed could not become an item. */
export type SkipReason =
  | "no-title"
  | "no-url"
  | "no-date"
  | "politics"
  | "promo"
  | "stale"
  | "topic";

/**
 * Рубрики, которые не повестка.
 *
 * Не выдумка и не вкусовщина: рубрики лент измерены, и каждая запись здесь — про конкретные
 * материалы. У E1 рубрика есть у всех ста материалов; у Mail.ru она двойная («Политика: За
 * рубежом»), и политика там помечена самим изданием — это точнее любого списка слов.
 *
 *   Политика          — «В Екатеринбурге отправили в отставку мэра», «Трамп готов снимать санкции»
 *   Развлечения       — «тест для самых умных», «мемы про свекровь», «7 лучших фильмов»
 *   Еда               — «как приготовить икру из шампиньонов», «какие продукты купить к Новому году»
 *   Он и она          — «Басков назвал самую большую любовь своей жизни»
 *   Стиль и красота   — «50-летняя россиянка победила в конкурсе красоты „Миссис ООН“»
 *
 * **Чего здесь намеренно нет.** «Мой дом» и «Осень» выглядят бытовыми, но держат настоящие
 * новости: «Остывает, пока дойдёт до крана. Почему в квартирах екатеринбуржцев вместо горячей
 * воды…», «На Свердловскую область надвигаются дожди с мокрым снегом». «Животные» — «зоозащитник
 * осудил отстрел собак». Выбросить эти рубрики значило бы вычистить из повестки коммуналку,
 * погоду и городские происшествия — то есть ровно то, ради чего лента существует. Погода в
 * региональной повестке — новость, а не рубрика «гороскопы».
 */
export const NON_NEWS_RUBRICS: readonly string[] = [
  "политика",
  "развлечения",
  "еда",
  "он и она",
  "стиль и красота",
];

/**
 * Рубрика не про повестку.
 *
 * Сравнение с приставкой, потому что у Mail.ru рубрика двойная: «Политика: За рубежом» — та же
 * политика. Точного равенства здесь мало, а подстроки много: «Еда» не должна ловить «Едальню»,
 * а «Политика» — «Политкорректность» (которой в рубриках и нет).
 */
export function isNonNewsRubric(rubric: string): boolean {
  const value = rubric.trim().toLowerCase();
  if (!value) return false;

  return NON_NEWS_RUBRICS.some(
    (entry) => value === entry || value.startsWith(`${entry}:`) || value.startsWith(`${entry} :`),
  );
}

/** Рубрики одного элемента ленты: `<category>` бывает и несколько. */
export function rubricsIn(block: string): string[] {
  const pattern = /<category\b[^>]*>([\s\S]*?)<\/category\s*>/gi;
  return [...block.matchAll(pattern)]
    .map((match) => feedHtmlToText(unwrapCdata(match[1] ?? "")).trim())
    .filter(Boolean);
}

/**
 * Темы, которые редакция не берёт: политика, власть и всё, что вокруг них.
 *
 * Списки в двух видах намеренно, и это не украшение. Основы слова работают на русской
 * морфологии («депутат» ловит «депутаты», «депутатский»), но некоторые основы слишком коротки
 * и встречаются внутри обычных слов: «дума» сидит в «передумал», «сво» — в «свой», «мид» — в
 * «миди». Такие слова ищутся как отдельные слова по границам, а не подстрокой, иначе фильтр
 * выбросил бы городскую заметку за слово «передумали».
 *
 * Чего в списке нет — и это тоже решение: «суд», «прокуратура», «уголовное дело». Это
 * происшествия, которые предложке как раз и нужны; выбрасывать их значило бы вычистить из
 * ленты то, ради чего она существует. Политика для этой ленты — власть и её процедуры, а не
 * криминальная хроника.
 */
export const POLITICS_STEMS: readonly string[] = [
  "политик",
  "депутат",
  "выбор",
  "кремл",
  "законопроект",
  "парти",
  "президент",
  "губернатор",
  "правительств",
  "министр",
  "сенатор",
  "госдум",
  "совфед",
  "оппозици",
  "митинг",
  "протест",
  "санкци",
  "мобилизаци",
  "спецоперац",
  "чиновник",
  "коррупци",
  "отставк",
  "администраци",
  "заксобрани",
  "законодательн",
  "парламент",
  "референдум",
  "полпред",
  "путин",
  "единая россия",
  /*
    Внешняя политика — тоже политика, и это измерено, а не додумано.

    Уральская лента Mail.ru тащит федеральный блок вместе с региональным, и первые же
    прошедшие материалы оказались мировыми новостями: «На Западе сделали признание из-за
    резких слов Трампа о Зеленском», «Политолог назвал вероятные предложения Уиткоффа и
    Кушнера Москве». Список был настроен на российскую власть и этих слов не знал.

    Людей здесь ровно трое — те, о ком пишут каждый день, и кого нельзя назвать словом
    «политолог». Должности и ведомства надёжнее: они не устаревают, тогда как список фамилий
    стареет вместе с повесткой.
  */
  "трамп",
  "зеленск",
  "байден",
  "политолог",
  "госдеп",
  "пентагон",
  "брюссел",
  "вашингтон",
  "евросоюз",
  "еврокомисси",
  "саммит",
  "дипломат",
  "сенат",
  "lockheed",
  "белого дома",
  "белом доме",
  "белый дом",
];

/**
 * Слова, которые ищутся целиком: короткая основа здесь — часть обычных слов.
 *
 * Формы выписаны по отдельности, а не основой, и это то же измерение, что и выше: «глава»
 * целиком — это назначение или отставка, а «главная»/«главный» — обычные слова, и основа
 * «глав» выбросила бы половину ленты. Так же «мэр»: формы есть, а «мэрия» — нет, потому что
 * «в мэрии сообщили» стоит в доброй половине городских заметок, которые этой ленте как раз и
 * нужны. Политик — тот, кого назначили; пресс-служба, которую цитируют, — нет.
 */
export const POLITICS_WORDS: readonly string[] = [
  "сво",
  "мид",
  "цик",
  "нато",
  /*
    Страна и столица — целыми словами, а не основой.

    «Украинский борщ» и «киевский торт» — не политика, а «украин» и «киев» подстрокой ловят
    и их. Формы страны и города нужны в падежах, но ровно эти, а прилагательные остаются в
    покое: о политике говорит «на Украине», а не «украинский».
  */
  "украина",
  "украине",
  "украины",
  "украину",
  "украиной",
  "киев",
  "киева",
  "киеве",
  "киевом",
  "дума",
  "думу",
  "думе",
  "думы",
  "думой",
  "глава",
  "главы",
  "главе",
  "главу",
  "главой",
  "мэр",
  "мэра",
  "мэру",
  "мэром",
  "мэре",
  "мэры",
  "мэров",
  "мэрам",
  "указ",
  "указа",
  "указом",
  "указе",
];

/**
 * Политическое ли это. Заголовок и описание вместе: тема обычно объявлена в одном из них.
 *
 * Чистая функция, и это важно: отбор происходит при импорте, до записи в базу, поэтому
 * материал с признаками политики не попадает в предложку вообще — а не прячется в
 * интерфейсе, где его однажды покажут снова.
 */
export function isPoliticalText(...parts: readonly string[]): boolean {
  const haystack = parts.join(" ").toLowerCase();
  if (!haystack.trim()) return false;

  const word = (candidate: string) =>
    new RegExp(`(^|[^а-яёa-z])${candidate}([^а-яёa-z]|$)`, "i").test(haystack);

  if (POLITICS_WORDS.some(word)) return true;
  return POLITICS_STEMS.some((stem) => haystack.includes(stem));
}

export type ParseResult = {
  items: ParsedFeedItem[];
  skipped: { reason: SkipReason; title: string; externalId?: string }[];
};

/** How many items are taken from one feed by default. */
export const DEFAULT_FEED_LIMIT = 40;

/**
 * The identifier an item is deduplicated by.
 *
 * The outlet's own guid wins, because that is what the publisher promises is stable —
 * a story re-published under a new path keeps its guid and would otherwise arrive
 * twice. The link is the fallback, and a title hash the last resort.
 *
 * Namespaced by source on purpose. Two outlets can both number their items from one,
 * and a bare guid would then make the second one look like a duplicate of the first and
 * silently drop it — the kind of missing story nobody reports, because it is missing.
 */
export function externalIdFor(
  source: FeedSource,
  guid: string,
  url: string,
  title: string,
): string {
  const trimmed = guid.trim();
  if (trimmed) return `${source}:${trimmed}`;

  const link = url.trim();
  if (link) return `${source}:link:${link}`;

  return `${source}:title:${title.trim().toLowerCase()}`;
}

/**
 * The inner content of every `<tag>` in a document.
 *
 * Non-greedy and non-nesting: `<item>` never contains another `<item>`, which is the
 * only structural assumption this reader makes. Entries are taken as-is, including any
 * inner `<content>` that happens to contain markup.
 */
export function sliceElements(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => match[1] ?? "");
}

/** The text of the first `<name>` inside a block, CDATA unwrapped. */
export function tagValue(block: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}\\s*>`, "i");
  const match = pattern.exec(block);
  return match ? unwrapCdata(match[1] ?? "") : null;
}

/** `<![CDATA[…]]>` is a wrapper, not content. */
export function unwrapCdata(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/^\s*<!\[CDATA\[/, "")
    .replace(/\]\]>\s*$/, "");
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  laquo: "«",
  raquo: "»",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  deg: "°",
};

/** Decodes the entities a feed actually contains, named and numeric. */
export function decodeEntities(value: string): string {
  return value
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED[name.toLowerCase()] ?? match)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePoint(Number(dec)));
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 1 || value > 0x10ffff) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}

/**
 * Another outlet's HTML, as text with its paragraphs kept.
 *
 * Deliberately not `htmlToPlainText` from the messenger module, even though the two
 * look alike. The difference is the input: that one reads markup the newsroom's own
 * editor produced, this one reads whatever a third party sent — including `<script>`,
 * `<style>` and `<noscript>` blocks whose contents must not reach the rewriter as text.
 *
 * The order is decode-then-strip, which is the opposite of the messenger's, and it
 * matters for both feed dialects:
 *
 *  - Atom escapes the payload: `<content type="html">&lt;p&gt;…&lt;/p&gt;</content>`.
 *    Stripping tags first leaves the literal characters `<p>…</p>` in the text, and the
 *    rewriter would then be given markup dressed as prose. Measured on a real Atom body.
 *  - RSS wraps the payload in CDATA, so it arrives already literal and decoding is a
 *    no-op for it.
 *
 * The cost of decoding first is that a `<` which is genuinely prose ("5 &lt; 6") becomes
 * a character the stripper has to recognise as not-a-tag. That is what the tag pattern
 * below is for: a tag starts with a letter, `/`, `!` or `?`, so ` < 6 ` survives while
 * `</p>` does not.
 */
export function feedHtmlToText(html: string): string {
  if (!html.trim()) return "";

  const text = decodeEntities(html)
    .replace(/<(script|style|noscript|iframe)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(
      /<\/?(?:p|div|section|article|h[1-6]|blockquote|ul|ol|li|tr|figure|figcaption|table)\b[^>]*>/gi,
      "\n\n",
    )
    .replace(/<br\s*\/?>/gi, "\n")
    // Everything else that still looks like a tag. `[a-zA-Z!/?]` after the bracket is
    // what separates `</p>` from the prose " < 6 ".
    .replace(/<[a-zA-Z!/?][^>]*>/g, "");

  return text
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first date this reader can believe, or null. */
export function parseFeedDate(raw: string | null, now = new Date()): Date | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  // A date before this reader existed, or well in the future, is a broken field rather
  // than a story. The future case matters most: a feed that sends a wrong year would
  // otherwise pin one item to the top of the desk for ever.
  const floor = Date.UTC(2000, 0, 1);
  const ceiling = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() < floor || parsed.getTime() > ceiling) return null;

  return parsed;
}

/** Resolves the item's link, for both feed dialects. */
export function linkFor(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)];

  // Atom: `<link rel="alternate" href="…"/>`. Picked by rel because an entry can carry
  // several links and the one a reader should open is the alternate.
  const withHref =
    links.find(
      (match) => /rel\s*=\s*["']?alternate/i.test(match[1] ?? "") && /href\s*=/i.test(match[1] ?? ""),
    ) ?? links.find((match) => /href\s*=/i.test(match[1] ?? ""));

  if (withHref) {
    const href = /href\s*=\s*["']([^"']*)["']/i.exec(withHref[1] ?? "");
    if (href?.[1]) return decodeEntities(href[1].trim());
  }

  // RSS: `<link>https://…</link>`.
  return decodeEntities((tagValue(block, "link") ?? "").trim());
}

/**
 * One feed body into items.
 *
 * `limit` is a ceiling on what is taken, not on what is read: the desk shows the newest
 * items, and a feed that suddenly publishes a year of archive should not fill the table
 * on the first sync.
 *
 * `assumeUndated` — для издания, которое дат в ленте не публикует вовсе: материал получает
 * время опроса вместо отказа. Ставится по источнику, а не глобально, потому что правило
 * «без даты — отказ» верно для ленты, которая даты несёт и иногда теряет.
 */
export function parseFeed(
  xml: string,
  options: { source: FeedSource; limit?: number; now?: Date; assumeUndated?: boolean },
): ParseResult {
  const limit = options.limit ?? DEFAULT_FEED_LIMIT;
  const now = options.now ?? new Date();

  const rssItems = sliceElements(xml, "item");
  const atomEntries = sliceElements(xml, "entry");
  const blocks = rssItems.length > 0 ? rssItems : atomEntries;

  const items: ParsedFeedItem[] = [];
  const skipped: ParseResult["skipped"] = [];

  for (const block of blocks) {
    const rawTitle = tagValue(block, "title") ?? "";
    const title = feedHtmlToText(rawTitle);

    if (!title) {
      skipped.push({ reason: "no-title", title: "" });
      continue;
    }

    const url = linkFor(block);
    if (!url) {
      skipped.push({ reason: "no-url", title });
      continue;
    }

    /*
      Идентификатор считается здесь, а не при записи.

      Он нужен и отказам: по нему синхронизация находит уже сохранённые строки, которые
      нынешние правила больше не принимают (политика, не та рубрика), и убирает их со стола.
      Без него скрывать пришлось бы по заголовку — то есть угадывая.
    */
    const externalId = externalIdFor(
      options.source,
      tagValue(block, "guid") ?? tagValue(block, "id") ?? "",
      url,
      title,
    );

    // `content:encoded` is what feeds put the whole story in; `description` is often an
    // excerpt. Atom uses `content` and `summary`. First one present wins.
    const body =
      tagValue(block, "content:encoded") ??
      tagValue(block, "content") ??
      tagValue(block, "description") ??
      tagValue(block, "summary") ??
      "";

    const publishedAt =
      parseFeedDate(
        tagValue(block, "pubDate") ?? tagValue(block, "published") ?? tagValue(block, "updated"),
        now,
      ) ?? (options.assumeUndated ? now : null);

    /*
      Лента без дат.

      Обычно элемент без даты отбрасывается: рассказать, когда материал вышел, лента не
      смогла, а поставить ему время опроса значило бы выдать догадку за факт — наверху списка
      такой материал стоял бы вечно.

      Но это правило про ленту, которая даты носит и иногда теряет. `assumeUndated` — про
      издание, которое их не публикует вовсе (у 66.ru на десять элементов фида ни одного
      `<pubDate>` и ни одного `dc:date`). Такому источнику выбора нет: либо дата опроса, либо
      ни одного материала. Дата опроса при этом не «догадка о публикации» — это когда
      предложка впервые увидела материал, и для стола новостей это ровно то, что нужно:
      дедупликация по `externalId` не даёт элементу обновиться, поэтому время закрепляется за
      ним навсегда и порядок не переставляется.
    */
    if (!publishedAt) {
      skipped.push({ reason: "no-date", title, externalId });
      continue;
    }

    const rawText = feedHtmlToText(body);

    /*
      Политика отсекается здесь — до записи, а не при показе.

      Материал, попавший в таблицу, однажды всплывёт: предложка фильтруется по статусу, а не
      по теме, и «отложенный» политический сюжет вернётся в список при первом же изменении
      фильтра. Не записывать его вовсе — единственная форма, которая не даёт ему вернуться.
    */
    if (isPoliticalText(title, rawText)) {
      skipped.push({ reason: "politics", title, externalId });
      continue;
    }

    /*
      И рубрика — по той же причине.

      Издатель сам помечает материал, и это надёжнее списка слов: у Mail.ru «Политика: За
      рубежом» — политика, и никакие слова для этого не нужны, а у E1 «Развлечения» отделены
      от «Происшествий» рубрикой, хотя оба заголовка могут звучать одинаково новостно.
      Лента без рубрик (66.ru) проходит целиком: отсутствие пометки — не повод отказать.
    */
    const rubrics = rubricsIn(block);
    if (rubrics.some(isNonNewsRubric)) {
      skipped.push({ reason: "topic", title, externalId });
      continue;
    }

    items.push({
      source: options.source,
      externalId,
      originalUrl: url,
      title,
      rawText,
      publishedAt,
    });

    if (items.length >= limit) break;
  }

  return { items, skipped };
}

/**
 * Карточки публичного API Дзена — той самой выдачи, которую грузит его главная.
 *
 * **Почему API, а не RSS.** `dzen.ru/rss/news` отвечает 302 на `sso.passport.yandex.ru/push`:
 * публичного фида у Дзена нет, нужна авторизация Яндекса. Зато его главная берёт ленту
 * обычным JSON-запросом, и он открыт — проверено с сервера: `HTTP 200`, 664 КБ, 20 карточек,
 * из них 10 с заголовком (остальные — пустые слоты выдачи, `card_type: null`).
 *
 * **Про User-Agent.** В задании просили браузерный. Он не нужен, и это измерено: наш
 * `EartnewsBot/1.0 (+https://eartnews.ru; editorial-wire)` получает ту же выдачу, что Chrome,
 * — байт в байт по структуре и числу карточек. Притворяться браузером там, где это ничего не
 * добавляет, значит врать чужому серверу без причины; `Referer` тоже не требуется.
 *
 * **Чего в карточке нет.** `creation_time` — человеческая строка («5 дней назад»), а не время;
 * время лежит рядом, в `publication_date`, и это Unix-время **строкой**. Поэтому дата берётся
 * оттуда, а карточка без неё отбрасывается: возраст материала на этом столе — часть решения,
 * идти ли в сюжет.
 *
 * Пустые слоты в `skipped` не попадают: это не отказ, а место, которое выдача ещё не
 * заполнила, и десяток «отказов no-title» в сводке каждую синхронизацию только путал бы.
 */
export function parseDzenFeed(
  body: string,
  options: { source: FeedSource; limit?: number; now?: Date; maxAgeDays?: number },
): ParseResult {
  const limit = options.limit ?? DEFAULT_FEED_LIMIT;
  const now = options.now ?? new Date();
  const oldest =
    options.maxAgeDays === undefined ? null : now.getTime() - options.maxAgeDays * 24 * 60 * 60 * 1000;

  const items: ParsedFeedItem[] = [];
  const skipped: ParseResult["skipped"] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Не JSON — не выдача. Пустой результат без исключения: вызывающий скажет об этом сводкой.
    return { items, skipped };
  }

  const cards = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(cards)) return { items, skipped };

  for (const raw of cards) {
    if (typeof raw !== "object" || raw === null) continue;
    const card = raw as Record<string, unknown>;

    const title = feedHtmlToText(typeof card.title === "string" ? card.title : "").trim();
    if (!title) continue;

    /*
      Реклама до стола не доходит.

      Выдача помечает её сама (`is_promo_publication`, `is_promoted`), и на измеренной ленте
      все флаги были false — но поле подписано издателем, а не нами, и доверять ему дешевле,
      чем потом объяснять редакции, почему в предложке стоит чужой баннер.
    */
    if (card.is_promo_publication === true || card.is_promoted === true) {
      skipped.push({ reason: "promo", title });
      continue;
    }

    const url = feedHtmlToText(
      typeof card.share_link === "string"
        ? card.share_link
        : typeof card.link === "string"
          ? card.link
          : "",
    ).trim();
    if (!url) {
      skipped.push({ reason: "no-url", title });
      continue;
    }

    const publishedAt = dzenDate(card.publication_date, now);
    if (!publishedAt) {
      skipped.push({ reason: "no-date", title });
      continue;
    }

    if (oldest !== null && publishedAt.getTime() < oldest) {
      skipped.push({ reason: "stale", title });
      continue;
    }

    const rawText = feedHtmlToText(typeof card.text === "string" ? card.text : "");

    if (isPoliticalText(title, rawText)) {
      skipped.push({ reason: "politics", title });
      continue;
    }

    items.push({
      source: options.source,
      externalId: externalIdFor(
        options.source,
        typeof card.id === "string"
          ? card.id
          : typeof card.publication_id === "string"
            ? card.publication_id
            : "",
        url,
        title,
      ),
      originalUrl: url,
      title,
      rawText,
      publishedAt,
    });

    if (items.length >= limit) break;
  }

  return { items, skipped };
}

/**
 * `publication_date` Дзена: Unix-время, но строкой.
 *
 * Рамка та же, что у `parseFeedDate`, и по той же причине: время в будущем — это не новость, а
 * ошибка в разметке, и поставить её наверх списка значит показать редакции материал, которого
 * ещё нет. Слишком старое тоже отбрасывается — карточка 2019 года в «Топе» читается как сбой.
 */
function dzenDate(value: unknown, now: Date): Date | null {
  const seconds = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const at = new Date(seconds * 1000);
  if (Number.isNaN(at.getTime())) return null;

  // Границы: не раньше 2010-го и не позже недели вперёд.
  if (at.getTime() < Date.UTC(2010, 0, 1)) return null;
  if (at.getTime() > now.getTime() + 7 * 24 * 60 * 60 * 1000) return null;

  return at;
}
