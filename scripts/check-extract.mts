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
 * The URA page, mirroring the live markup measured on 2026-10-08: the body lives in
 * `text-element_news-publication-text-element` blocks of one paragraph each, the caption
 * and its credit share an `image-element_news-content-image-element` block of two, and
 * the gallery, the "материал по теме" inset and the ad dividers are separate containers.
 */
const URA_PAGE = `<!doctype html><html><head><title>${SAMPLE_TITLE}</title></head><body>
<header><nav><a href="/">Главная</a><a href="/news">Новости</a></nav></header>
<div class="page">
  <div class="content_news-publication-content__v2iuZ">
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
  "Селекторы: в списке есть настоящие контейнеры обоих изданий",
  BODY_SELECTORS.some((entry) => entry.selector.includes("news-publication-content")) &&
    BODY_SELECTORS.some((entry) => entry.selector.includes("articleContent")),
  BODY_SELECTORS.map((entry) => entry.note).join(", "),
);

check(
  "Селекторы: матч по префиксу класса, а не по хешу",
  BODY_SELECTORS.every((entry) => !/__[a-zA-Z0-9]{5}/.test(entry.selector)),
  "хеш CSS-модуля меняется при каждом деплое",
);

// --- extraction ---------------------------------------------------------------

const ura = extractArticleText(URA_PAGE, { title: SAMPLE_TITLE });
check(
  "Извлечение URA: контейнер найден по селектору",
  ura.method === "selector" && ura.text.length >= MIN_BODY_CHARS,
  `${ura.method}, ${ura.text.length} символов, ${ura.paragraphs} абзацев`,
);

check(
  "Извлечение URA: абзацев достаточно для рерайта",
  ura.paragraphs >= 4,
  `${ura.paragraphs} абзацев`,
);

check(
  "Извлечение URA: подпись к фото убрана",
  !ura.text.includes("появится прогулочная зона с деревянным настилом"),
  "подпись не попала в текст",
);

check(
  "Извлечение URA: кредит фотографа убран",
  !ura.text.includes("Фото:") && !ura.text.includes("©"),
  "«Фото: … © URA.RU» отброшено",
);

check(
  "Извлечение URA: тело статьи на месте, с цитатой",
  ura.text.includes("В Заозерном районе Кургана началось обустройство") &&
    ura.text.includes("«В этом году здесь появится новая прогулочная зона") &&
    ura.text.includes("Ранее URA.RU писало"),
  ura.text.slice(0, 120),
);

check(
  "Извлечение URA: абзацы разделены пустой строкой",
  ura.text.split("\n\n").length === ura.paragraphs,
  `${ura.text.split("\n\n").length} блоков`,
);

check(
  "Извлечение URA: подпись галереи не попала",
  !ura.text.includes("В Заозерном создадут новую прогулочную зону"),
  "галерея отброшена по контейнеру",
);

check(
  "Извлечение URA: блок «материал по теме» не попал",
  !/материал по теме/iu.test(ura.text),
  "вставка отброшена",
);

check(
  "Извлечение URA: реклама не попала",
  !/продолжение после рекламы/iu.test(ura.text),
  "рекламный разделитель отброшен",
);

check(
  "Извлечение URA: подвал «Подписывайтесь» не попал",
  !/подписывайт/iu.test(ura.text),
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
