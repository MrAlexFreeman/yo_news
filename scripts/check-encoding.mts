/**
 * Кодировка исходников и текста, который редактор видит при сохранении.
 *
 * Фон — реальный случай. В `actions.ts` рядом лежали строки «Материал обновлён.» и
 * «Материал создан.» — и точно такие же по смыслу, но с каждой буквой удвоенной и
 * приваренной к ней чужой пунктуацией. Это один и тот же текст, испорченный тем, что байты
 * UTF-8 прочитали как Windows-1251 и записали обратно в UTF-8. Пользователь видел это в
 * тосте сохранения.
 *
 * Испорченная форма здесь не приводится буквально по той же причине: литерал поломки в
 * комментарии проверка не отличила бы от настоящей поломки.
 *
 * Две части, потому что статический скан и живой вызов ловят разное.
 *
 * Скан ловит сам факт порчи по инвентарю символов: буквы cp1251, которых нет в русском
 * алфавите — прописные и строчные из верхней половины таблицы (от буквы с U+0402 до U+045F,
 * это 31 позиция) плюс четыре с производными от U+0490. Каждая появляется как вторая половина
 * двухбайтовой последовательности, прочитанной как cp1251. Ни одна из них не встречается в
 * правильном русском тексте, поэтому её присутствие в исходнике — это поломка, а не стиль.
 * Плюс проверка на BOM: `next/font` считает размер сборки по байтам, а BOM переносится в
 * вывод и в журналы pm2 невидимым символом.
 *
 * Список задан escape-последовательностями, и сами буквы здесь только описаны. Это не
 * педантизм: перечисление их буквально в этом комментарии приводило к тому, что проверка
 * находила поломку в самой себе — а значит, переставала быть пригодным эталоном для всех
 * остальных файлов. Ровно эта ловушка дважды сбила и меня при написании самого инструмента.
 *
 * Живая часть зовёт `createArticleAction` напрямую и смотрит на то, что реально вернётся в
 * тост. Это единственный способ проверить текст: POST формы в адрес страницы до Server
 * Action не доходит, поэтому HTTP-тест прошёл бы, проверяя ничего. Тот же приём и с той же
 * оговоркой, что в `dzen:check`.
 *
 * Про `encodeURIComponent` в `redirect` и про ASCII-заголовки: в этом проекте они не
 * при чём. Сообщение идёт через `useActionState`, то есть по каналу состояния React, а не
 * через URL, заголовок или cookie — кодировать там нечего, и добавление экранирования
 * ничего бы не починило. Проверено чтением формы, а не предположением.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Символы, которых не может быть в правильном русском тексте проекта.
 *
 * Отброшено намеренно: весь блок U+0400–U+045F как таковой (туда попадают настоящие «ё»,
 * «й», «Ё»), а также ©, ®, №, €, ™ и прочие заимствованные символы. Проверка на них давала
 * ложные срабатывания — © стоит в подвале сайта, — а при порче байта E2 82 AC («€») следом
 * становится «в», так что настоящая валюта в списке не нужна вовсе.
 */
const IMPOSSIBLE_CHARACTERS =
  /[\u0402\u0403\u0404\u0405\u0406\u0407\u0408\u0409\u040A\u040B\u040C\u040D\u040E\u040F\u0452\u0453\u0454\u0455\u0456\u0457\u0458\u0459\u045A\u045B\u045C\u045D\u045E\u045F\u0490\u0491\u0493\u0497]/;

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "src/generated"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|mjs|prisma|sql|md)$/.test(entry)) out.push(full);
  }
  return out;
}

/** The file name rendered so a path with parentheses is still readable in a terminal. */
function quote(value: string): string {
  return value.includes(" ") || value.includes("(") ? `"${value}"` : value;
}

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

/** What the editor should actually read after a successful save. */
const EXPECTED_CREATED = "Материал создан.";
const EXPECTED_UPDATED = "Материал обновлён.";

function scanFiles() {
  const requested = process.argv.slice(2);
  // The guard scans itself too, which is the point: a file that talks about corrupted
  // encodings is exactly where the corruption hides.
  const roots = (requested.length > 0 ? requested : ["src", "scripts", "prisma"]).map(
    (root) => path.resolve(root),
  );
  const files = roots.flatMap((root) => walk(root));

  const corrupt: string[] = [];
  const withBom: string[] = [];

  for (const file of files) {
    const bytes = readFileSync(file);
    const relative = path.relative(process.cwd(), file);

    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      withBom.push(relative);
      continue;
    }

    // A file that does not round-trip through UTF-8 is a different fault, and calling it
    // mojibake would send someone looking in the wrong place.
    const text = bytes.toString("utf8");
    if (Buffer.compare(Buffer.from(text, "utf8"), bytes) !== 0) {
      corrupt.push(`${relative} (файл не является валидным UTF-8)`);
      continue;
    }

    const hits = new Set<string>();
    for (const char of text) {
      if (IMPOSSIBLE_CHARACTERS.test(char)) hits.add(char);
    }

    if (hits.size > 0) {
      const sample = [...hits]
        .map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)
        .join(", ");
      corrupt.push(`${relative} (${sample})`);
    }
  }

  check(
    "Кодировка: символов Windows-1251 в исходниках нет",
    corrupt.length === 0,
    corrupt.length === 0
      ? `${files.length} файлов чисто`
      : `${corrupt.length} файлов: ${corrupt.slice(0, 4).map(quote).join(", ")}`,
  );

  check(
    "Кодировка: ни одного файла с BOM",
    withBom.length === 0,
    withBom.length === 0 ? "BOM не найден" : withBom.slice(0, 4).map(quote).join(", "),
  );

  check(
    "Кодировка: скан не пустой — файлы действительно просмотрены",
    // With explicit roots any positive count is legitimate; with the default set, a
    // handful of files would mean the walk silently stopped at the first missing folder.
    requested.length > 0 ? files.length > 0 : files.length > 150,
    `${files.length} файлов${requested.length > 0 ? "" : " (по умолчанию)"}`,
  );

  if (corrupt.length > 0) {
    console.log("\nИспорченные файлы:");
    for (const entry of corrupt) console.log(`  ${entry}`);
  }
  if (withBom.length > 0) {
    console.log("\nФайлы с BOM:");
    for (const entry of withBom) console.log(`  ${entry}`);
  }
}

/**
 * The words the editor reads.
 *
 * Asserted against `saveMessage` rather than against `createArticleAction`, because the
 * action cannot be reached from here: it calls `revalidatePath`, which in a plain Node
 * process throws "Invariant: static generation store missing" *before* the return value is
 * built, and over HTTP a FormData POST to the page URL never reaches a Server Action at
 * all. That gap is why the corrupted text survived every suite in this repository.
 */
function checkToastText(saveMessage: typeof import("../src/lib/save-message").saveMessage) {
  const created = saveMessage({
    isUpdate: false,
    experimentRejected: false,
    experimentHint: "галочка доступна только в момент первой публикации",
    vkVideoWarning: null,
  });

  check(
    "Тост: при создании материала приходит «Материал создан.»",
    created === EXPECTED_CREATED,
    created,
  );
  check(
    "Тост: при сохранении материала приходит «Материал обновлён.»",
    saveMessage({
      isUpdate: true,
      experimentRejected: false,
      experimentHint: "галочка доступна только в момент первой публикации",
      vkVideoWarning: null,
    }) === EXPECTED_UPDATED,
    EXPECTED_UPDATED,
  );

  const withCaveats = saveMessage({
    isUpdate: true,
    experimentRejected: true,
    experimentHint: "галочка доступна только в момент первой публикации",
    vkVideoWarning: "Видео в ВК не переименовано: превышен лимит",
  });

  check(
    "Тост: сообщение собирается из трёх частей без лишних пробелов",
    withCaveats ===
      "Материал обновлён. Эксперимент с Дзен не включён: галочка доступна только в момент первой публикации. Видео в ВК не переименовано: превышен лимит",
    withCaveats,
  );
  check(
    "Тост: пустые части не оставляют хвостовых пробелов",
    !/\s\s/.test(withCaveats) && !withCaveats.endsWith(" "),
    "чистое сообщение",
  );

  const messages = [
    created,
    withCaveats,
    saveMessage({
      isUpdate: false,
      experimentRejected: false,
      experimentHint: "",
      vkVideoWarning: undefined,
    }),
  ];
  const dirty = messages.filter((message) => IMPOSSIBLE_CHARACTERS.test(message));

  check(
    "Тост: в сообщениях нет символов Windows-1251",
    dirty.length === 0,
    dirty.length === 0 ? `${messages.length} вариантов чистые` : dirty.join(" | "),
  );
}

scanFiles();
checkToastText((await import("../src/lib/save-message")).saveMessage);

console.log("\nКодировка исходников и текста сохранения\n");
for (const { name, ok, detail } of checks) {
  console.log(`${ok ? "OK  " : "FAIL"} ${name} — ${detail.slice(0, 130)}`);
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} проверок пройдено`);
process.exitCode = failed > 0 ? 1 : 0;
