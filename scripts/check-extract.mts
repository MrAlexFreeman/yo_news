/** The full-text extractor, against the markup the two outlets really serve. */
import {
  BODY_SELECTORS,
  MIN_BODY_CHARS,
  cleanParagraphs,
  extractArticleText,
  looksTruncated,
  preferExtracted,
} from "../src/lib/article-extract";

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const SAMPLE_TITLE = "В Кургане начали обустраивать прогулочную зону у воды";

/**
 * A dirty page: the markup measured live on 2026-10-08, kept because it is the richest
 * cleaning case in the suite — the caption and its credit share one block, and the gallery,
 * the "материал по теме" inset and the ad dividers are separate containers that must not
 * reach the draft.
 *
 * The container carries E1's real class (`articleContent_0DdLJ`) rather than the removed
 * outlet's, so the fixture exercises the path a configured feed actually takes: a selector
 * match, then the cleaning rules. The inner element classes are left as measured — the
 * exclusion rules key on those prefixes, and they are what makes the fixture dirty.
 */
const DIRTY_PAGE = `<!doctype html><html><head><title>${SAMPLE_TITLE}</title></head><body>
<header><nav><a href="/">Главная</a><a href="/news">Новости</a></nav></header>
<div class="page">
  <div class="articleContent_0DdLJ">
    <div class="content_news-publication-content__element__eg4mc image-element_news-content-image-element__Rgxkt">
      <p>В Кургане у ТЦ «Кубик» появится прогулочная зона с деревянным настилом</p>
      <p>Фото: Екатерина Сычкова © URA.RU</p>
    </div>
    <div class="content_news-publication-content__element__eg4mc text-element_news-publication-text-element__6Owg5">
      <p>В Заозерном районе Кургана началось обустройство тротуара к новой зоне отдыха возле торгового центра «Кубик» на проспекте Голикова.</p>
    </div>
    <div class="content_news-publication-content__element__eg4mc text-element_news-publication-text-element__6Owg5">
      <p>«В этом году здесь появится новая прогулочная зона, по периметру водоема смонтируют дощатый настил, установят освещение», — рассказали в мэрии города.</p>
    </div>
    <div class="ad-divider_news-publication-ad-divider__IUAu7">Продолжение после рекламы</div>
    <div class="in-page-advertisement_in-page-advertisement-wrapper__ro5XL"></div>
    <div class="content_news-publication-content__element__eg4mc text-element_news-publication-text-element__6Owg5">
      <p>Попасть на новую территорию можно будет от торгового центра и со стороны улицы Родькина. Она дополнит уже существующие зоны отдыха.</p>
    </div>
    <div class="gallery-element_gallery-element__8gZf7">
      <div class="gallery-element_gallery-element__description__JWgFf">
        <p>1/3 В Заозерном создадут новую прогулочную зону у водоема</p>
      </div>
      <div class="gallery-element_gallery-element__author__o_BRc">
        <p>Фото: Город Курган / МАКС</p>
      </div>
    </div>
    <div class="inset-element_news-publication-inset-element__EiP2s">
      <div class="inset-element_news-publication-inset-element__header__sFSZI">
        <p>материал по теме</p>
      </div>
    </div>
    <div class="content_news-publication-content__element__eg4mc text-element_news-publication-text-element__6Owg5">
      <p>Ранее URA.RU писало, что губернатор Вадим Шумков объявил о финансировании ремонта ещё одной улицы в областном центре.</p>
    </div>
  </div>
  <div class="sidebar"><p>Читайте также</p></div>
</div>
<footer><p>Подписывайтесь на наш канал в Telegram</p></footer>
</body></html>`;

/**
 * The E1 page, mirroring the live markup: body paragraphs in `uiArticleBlockText` blocks
 * of one paragraph each, captions in `articleBlockImage` blocks.
 */
const E1_PAGE = `<!doctype html><html><head><title>Почему поменяли спикера Заксобрания</title></head><body>
<div data-page="TYPE_ARTICLE">
  <nav><p>Недвижимость</p><p>Промокоды</p><p>Погода</p></nav>
  <div class="articleContent_0DdLJ">
    <div class="articleBlockImage_odoam mobileWide_0DdLJ">
      <p>Людмила Бабушкина как лицо законодательной власти региона принимала в губернаторы Дениса Паслера.</p>
    </div>
    <div class="uiArticleBlockText_lLEvz text-style-body-1 c-t">
      <p>Во власти Свердловской области грядут важные изменения. Впервые за полтора десятка лет в Заксобрании региона будет новый спикер вместо Людмилы Бабушкиной.</p>
    </div>
    <div class="uiArticleBlockText_lLEvz text-style-body-1 c-t">
      <p>Людмила Бабушкина занимала пост спикера с момента создания Законодательного собрания в 2011 году, а до этого возглавляла областное правительство.</p>
    </div>
    <div class="uiArticleBlockText_lLEvz text-style-body-1 c-t">
      <p>По просьбе E1.RU депутат Заксобрания и политолог рассказали, как Людмила Бабушкина долгое время оставалась самой влиятельной фигурой региона.</p>
    </div>
    <div class="uiArticleBlockText_lLEvz text-style-body-1 c-t">
      <p>«Ее организационные способности позволили работать нашему Законодательному собранию как очень слаженному механизму», — заявил депутат Вячеслав Вегнер.</p>
    </div>
    <div class="articleBlockImage_odoam mobileWide_0DdLJ">
      <p>Людмила Бабушкина принимала участие в заседаниях собрания почти каждый месяц.</p>
      <p>Источник: Владислав Лоншаков</p>
    </div>
  </div>
</div>
</body></html>`;

/** A page with no article markup at all: Readability has to find the text. */
const GENERIC_PAGE = `<!doctype html><html><head><title>Новость без разметки</title></head><body>
<div id="wrapper"><div id="content"><div>
<div class="nav"><a href="/">Главная</a> <a href="/news">Новости</a> <a href="/sport">Спорт</a></div>
<h1>Заголовок статьи в ленте</h1>
<div class="entry">
<p>Первый абзац достаточно длинный, чтобы Readability счёл его частью статьи, а не подписью к картинке.</p>
<p>Второй абзац тоже содержит достаточно слов, чтобы его нельзя было отбросить как элемент интерфейса.</p>
<p>Третий абзац завершает материал и подводит итог сказанному выше в двух абзацах.</p>
<p>Четвёртый абзац добавлен намеренно: короткий текст Readability иногда не считает статьёй.</p>
</div>
<div class="footer">Все права защищены</div>
</div></div></div>
</body></html>`;

// --- the truncation rule ------------------------------------------------------

check(
  "Анонс: короткий текст считается усечённым",
  looksTruncated("В Тюмени два корпуса ТюмГУ пойдут под снос.") === true,
  "97 символов, как в настоящей ленте",
);

check(
  "Анонс: текст с «Читать далее» считается усечённым даже длинным",
  looksTruncated("а".repeat(400) + "\n\nЧитать далее") === true,
  "фраза важнее длины",
);

check(
  "Анонс: полный текст не считается усечённым",
  looksTruncated("а".repeat(1200)) === false,
  "1200 символов",
);

check(
  "Анонс: пустой текст считается усечённым",
  looksTruncated("") === true && looksTruncated("   ") === true,
  "нечего переписывать",
);

check(
  "Анонс: порог проверяется по обе стороны",
  looksTruncated("а".repeat(249)) === true && looksTruncated("а".repeat(250)) === false,
  "249 / 250",
);

// --- when a fetched body is better than the teaser ----------------------------

const TEASER = "В Тюмени два корпуса ТюмГУ пойдут под снос.\n\nЧитать далее";

check(
  "Замена: полный текст вытесняет анонс",
  preferExtracted(TEASER, "а".repeat(1200)) === true,
  "1200 против 58 символов",
);

check(
  "Замена: фрагмент короче порога не вытесняет анонс",
  preferExtracted(TEASER, "а".repeat(MIN_BODY_CHARS - 1)) === false,
  `чуть меньше ${MIN_BODY_CHARS} символов`,
);

check(
  "Замена: ровно порог уже годится",
  preferExtracted(TEASER, "а".repeat(MIN_BODY_CHARS)) === true,
  `${MIN_BODY_CHARS} символов`,
);

check(
  "Замена: текст короче анонса не вытесняет его",
  preferExtracted("а".repeat(500), "б".repeat(450)) === false,
  "страница отдала меньше, чем уже есть",
);

check(
  "Замена: равный по длине текст не вытесняет анонс",
  preferExtracted("а".repeat(500), "б".repeat(500)) === false,
  "нечего улучшать",
);

check(
  "Замена: пустой ответ не вытесняет анонс",
  preferExtracted(TEASER, "") === false,
  "ничего не вернулось",
);

// --- the selectors ------------------------------------------------------------

check(
  "Селекторы: в списке есть настоящие контейнеры настроенных изданий",
  BODY_SELECTORS.some((entry) => entry.selector.includes("articleContent")),
  BODY_SELECTORS.map((entry) => entry.note).join(", "),
);

check(
  "Селекторы: удалённого издания в списке нет",
  // Удаляя ленту, легко забыть её селектор. Мёртвый селектор читается как поддержка
  // издания, которого в предложке больше нет.
  BODY_SELECTORS.every((entry) => !entry.selector.includes("news-publication-content")),
  BODY_SELECTORS.map((entry) => entry.selector).join(", "),
);

check(
  "Селекторы: матч по префиксу класса, а не по хешу",
  BODY_SELECTORS.every((entry) => !/__[a-zA-Z0-9]{5}/.test(entry.selector)),
  "хеш CSS-модуля меняется при каждом деплое",
);

// --- текст из служебной разметки ----------------------------------------------

/*
  Ловушка, из-за которой этот путь и появился.

  66.ru отдаёт статью, собранную скриптами: в HTML у неё два абзаца, а весь текст — в
  `application/ld+json` полем `articleBody`. Селекторы на такой странице находят пустой
  контейнер, и без разбора разметки «Взять в работу» принесло бы редактору один заголовок.

  Фикстура воспроизводит ту же форму: пустой контейнер статьи плюс настоящий `<script>`.
  Проверяется и текст, и абзацы, и имя пути — чтобы работал именно разбор разметки, а не
  случайная удача Readability.
*/
const LD_BODY_1 =
  "В Екатеринбурге открыли обновлённую набережную городского пруда после двух лет ремонта и реконструкции: работы шли участками, чтобы горожане не остались без привычного места прогулок.";
const LD_BODY_2 =
  "На участке уложили новый гранитный настил, поставили скамейки и смонтировали подсветку вдоль всей линии берега, а спуски к воде сделали пологими и с перилами.";
const LD_BODY_3 =
  "Работы обошлись в 240 миллионов рублей, сообщили в мэрии города: часть суммы — областная субсидия, остальное — средства бюджета Екатеринбурга.";
const LD_PAGE = `<!doctype html><html><head><title>Набережную открыли</title>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  headline: "Набережную открыли",
  articleBody: `${LD_BODY_1}\n\n${LD_BODY_2}\n${LD_BODY_3}`,
})}</script>
</head><body>
<div class="articleContent_0DdLJ"><div class="skeleton"></div></div>
</body></html>`;

const fromLd = extractArticleText(LD_PAGE, { title: "Набережную открыли" });
check(
  "Разметка: тело читается из application/ld+json",
  fromLd.method === "ldjson" &&
    fromLd.text.length >= MIN_BODY_CHARS &&
    fromLd.text.includes(LD_BODY_1) &&
    fromLd.text.includes(LD_BODY_3),
  `${fromLd.method}, ${fromLd.text.length} символов, ${fromLd.paragraphs} абзацев`,
);

check(
  "Разметка: пустой контейнер статьи не выдаётся за тело",
  fromLd.paragraphs >= 3 && fromLd.text.split("\n\n").length === fromLd.paragraphs,
  `${fromLd.text.split("\n\n").length} блоков на ${fromLd.paragraphs} абзацев`,
);

/*
  И обратное: битая разметка не должна ломать извлечение.

  Незакрытая кавычка в блоке — обычное дело на живых сайтах. Второй блок с телом здесь
  целый, и он должен быть прочитан: один сломанный `<script>` не имеет права унести с собой
  весь путь.
*/
const LD_BROKEN = `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"NewsArticle","articleBody":"{битый json</script>
<script type="application/ld+json">${JSON.stringify({
  "@type": "NewsArticle",
  articleBody: `${LD_BODY_1}\n${LD_BODY_2}`,
})}</script>
</head><body><div class="articleContent_0DdLJ"></div></body></html>`;

const fromBroken = extractArticleText(LD_BROKEN, { title: "Ничего" });
check(
  "Разметка: битый блок пропускается, целый читается",
  fromBroken.text.includes(LD_BODY_1) && fromBroken.text.includes(LD_BODY_2),
  `${fromBroken.method}, ${fromBroken.text.length} символов`,
);

check(
  "Разметка: @graph обходится, а не пропускается",
  extractArticleText(
    `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "BreadcrumbList" },
        { "@type": "NewsArticle", articleBody: `${LD_BODY_1}\n${LD_BODY_3}` },
      ],
    })}</script></head><body><div class="articleContent_0DdLJ"></div></body></html>`,
    { title: "Ничего" },
  ).text.includes(LD_BODY_3),
  "@graph вложен, но найден",
);

// --- extraction ---------------------------------------------------------------

const dirty = extractArticleText(DIRTY_PAGE, { title: SAMPLE_TITLE });
check(
  "Извлечение грязной страницы: контейнер найден по селектору",
  dirty.method === "selector" && dirty.text.length >= MIN_BODY_CHARS,
  `${dirty.method}, ${dirty.text.length} символов, ${dirty.paragraphs} абзацев`,
);

check(
  "Извлечение грязной страницы: абзацев достаточно для рерайта",
  dirty.paragraphs >= 4,
  `${dirty.paragraphs} абзацев`,
);

check(
  "Извлечение грязной страницы: подпись к фото убрана",
  !dirty.text.includes("появится прогулочная зона с деревянным настилом"),
  "подпись не попала в текст",
);

check(
  "Извлечение грязной страницы: кредит фотографа убран",
  !dirty.text.includes("Фото:") && !dirty.text.includes("©"),
  "«Фото: … © URA.RU» отброшено",
);

check(
  "Извлечение грязной страницы: тело статьи на месте, с цитатой",
  dirty.text.includes("В Заозерном районе Кургана началось обустройство") &&
    dirty.text.includes("«В этом году здесь появится новая прогулочная зона") &&
    dirty.text.includes("Ранее URA.RU писало"),
  dirty.text.slice(0, 120),
);

check(
  "Извлечение грязной страницы: абзацы разделены пустой строкой",
  dirty.text.split("\n\n").length === dirty.paragraphs,
  `${dirty.text.split("\n\n").length} блоков`,
);

check(
  "Извлечение грязной страницы: подпись галереи не попала",
  !dirty.text.includes("В Заозерном создадут новую прогулочную зону"),
  "галерея отброшена по контейнеру",
);

check(
  "Извлечение грязной страницы: блок «материал по теме» не попал",
  !/материал по теме/iu.test(dirty.text),
  "вставка отброшена",
);

check(
  "Извлечение грязной страницы: реклама не попала",
  !/продолжение после рекламы/iu.test(dirty.text),
  "рекламный разделитель отброшен",
);

check(
  "Извлечение грязной страницы: подвал «Подписывайтесь» не попал",
  !/подписывайт/iu.test(dirty.text),
  "подвал отброшен",
);

const e1 = extractArticleText(E1_PAGE, { title: "Почему поменяли спикера Заксобрания" });
check(
  "Извлечение E1: контейнер найден по селектору",
  e1.method === "selector" && e1.text.length >= MIN_BODY_CHARS,
  `${e1.method}, ${e1.text.length} символов, ${e1.paragraphs} абзацев`,
);

check(
  "Извлечение E1: подписи к фото убраны",
  !e1.text.includes("как лицо законодательной власти") &&
    !e1.text.includes("принимала участие в заседаниях"),
  "блоки articleBlockImage отброшены",
);

check(
  "Извлечение E1: «Источник:» убран",
  !/Источник\s*:/iu.test(e1.text),
  "кредит отброшен",
);

check(
  "Извлечение E1: цитата и фактура на месте",
  e1.text.includes("«Ее организационные способности") &&
    e1.text.includes("Людмила Бабушкина занимала пост спикера"),
  e1.text.slice(0, 100),
);

check(
  "Извлечение E1: навигация не попала",
  !e1.text.includes("Промокоды") && !e1.text.includes("Погода"),
  "меню отброшено",
);

const generic = extractArticleText(GENERIC_PAGE, { title: "Заголовок статьи в ленте" });
check(
  "Извлечение без разметки: сработал Readability",
  generic.method === "readability" && generic.paragraphs >= 3,
  `${generic.method}, ${generic.paragraphs} абзацев, ${generic.text.length} символов`,
);

check(
  "Извлечение без разметки: текст статьи, а не интерфейс",
  generic.text.includes("Первый абзац достаточно длинный") &&
    !generic.text.includes("Все права защищены") &&
    !generic.text.includes("Главная"),
  generic.text.slice(0, 100),
);

check(
  "Извлечение: пустая страница не роняет разбор",
  extractArticleText("").method === "none" && extractArticleText("").text === "",
  "none",
);

check(
  "Извлечение: страница без статьи не выдумывает текст",
  extractArticleText("<html><body><nav><a href='/'>Главная</a></nav></body></html>").text
    .length < MIN_BODY_CHARS,
  "короткий результат, не мусор",
);

// --- the two structural rules, without relying on Readability ------------------

/** A generic `articleBody` so the selector path is exercised deterministically. */
function articleBody(inner: string): string {
  return `<!doctype html><html><body><div itemprop="articleBody">${inner}</div></body></html>`;
}

const creditBlock = extractArticleText(
  articleBody(
    `<p>${"а".repeat(300)}</p>
     <div><p>Подпись к фотографии, в которой нет ни одного служебного слова.</p><p>Фото: Иван Петров</p></div>
     <p>${"б".repeat(300)}</p>`,
  ),
);
check(
  "Правило подписи: блок из двух параграфов с кредитом отброшен целиком",
  creditBlock.method === "selector" &&
    creditBlock.paragraphs === 2 &&
    !creditBlock.text.includes("Подпись к фотографии") &&
    !creditBlock.text.includes("Иван Петров"),
  `${creditBlock.paragraphs} абзаца, ${creditBlock.text.length} символов`,
);

const bigCreditBlock = extractArticleText(
  articleBody(
    `<div>
       <p>${"а".repeat(300)}</p><p>${"б".repeat(300)}</p><p>${"в".repeat(300)}</p>
       <p>Фото: Иван Петров, агентство</p>
     </div>`,
  ),
);
check(
  "Правило подписи: большой блок с кредитом не вычищается",
  bigCreditBlock.paragraphs === 3 && !/Фото\s*:/iu.test(bigCreditBlock.text),
  `${bigCreditBlock.paragraphs} абзаца, кредит всё равно убран построчно`,
);

const mediaBlock = extractArticleText(
  articleBody(
    `<p>${"а".repeat(300)}</p>
     <div class="gallery-element_gallery-element__8gZf7">
       <div class="gallery-element_gallery-element__description__JWgFf"><p>1/3 Подпись в галерее без кредита рядом</p></div>
     </div>
     <p>${"б".repeat(300)}</p>`,
  ),
);
check(
  "Правило медиаконтейнера: подпись галереи убрана даже без кредита",
  mediaBlock.paragraphs === 2 && !mediaBlock.text.includes("Подпись в галерее"),
  `${mediaBlock.paragraphs} абзаца`,
);

const adBlock = extractArticleText(
  articleBody(
    `<p>${"а".repeat(300)}</p>
     <div class="ad-divider_news-publication-ad-divider__IUAu7"><p>Купите выгодно прямо сейчас, предложение ограничено по времени</p></div>
     <p>${"б".repeat(300)}</p>`,
  ),
);
check(
  "Правило медиаконтейнера: реклама убрана по контейнеру, а не по словам",
  adBlock.paragraphs === 2 && !adBlock.text.includes("Купите выгодно"),
  `${adBlock.paragraphs} абзаца`,
);

const divOnly = extractArticleText(
  articleBody(
    `<div>${"а".repeat(200)}</div><div>${"б".repeat(200)}</div><div>${"в".repeat(200)}</div>`,
  ),
);
check(
  "Извлечение: тело из <div> без <p> тоже читается",
  divOnly.method === "selector" && divOnly.paragraphs === 3,
  `${divOnly.paragraphs} абзаца`,
);

// --- the cleaning rules themselves --------------------------------------------

check(
  "Очистка: короткие строки отбрасываются",
  cleanParagraphs(["Коротко", "а".repeat(40)]).length === 1,
  "строка короче 25 символов",
);

check(
  "Очистка: повтор отбрасывается",
  cleanParagraphs(["а".repeat(40), "а".repeat(40)]).length === 1,
  "один абзац",
);

check(
  "Очистка: заголовок, повторённый в тексте, убирается",
  cleanParagraphs(["Заголовок статьи целиком", "а".repeat(40)], "Заголовок статьи целиком")
    .length === 1,
  "заголовок не дублируется",
);

check(
  "Очистка: подпись, склеенная с заголовком, убирается",
  cleanParagraphs(
    ["Заголовок статьи целиком и продолжение подписи к фото"],
    "Заголовок статьи целиком",
  ).length === 0,
  "подпись с заголовком внутри",
);

check(
  "Очистка: короткий заголовок не вырезает текст",
  cleanParagraphs(
    ["В городе произошла новость дня, о которой говорят все жители без исключения."],
    "день",
  ).length === 1,
  "слишком короткое название не сравнивается",
);

check(
  "Очистка: «Читать далее» как отдельная строка отбрасывается",
  cleanParagraphs(["Читать далее", "а".repeat(40)]).length === 1,
  "хвост анонса",
);

check(
  "Очистка: обычный абзац не трогается",
  cleanParagraphs(["Обычный абзац новости, достаточно длинный для проверки."]).length === 1,
  "абзац сохранён",
);

check(
  "Очистка: пустые строки не создают пустых абзацев",
  cleanParagraphs(["", "   ", "Обычный абзац новости, достаточно длинный."]).length === 1,
  "один абзац",
);

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"} ${entry.name} — ${entry.detail.slice(0, 130)}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exitCode = failed.length > 0 ? 1 : 0;
