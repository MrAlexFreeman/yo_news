/**
 * Re-encodes the photographs already in `uploads/`, in place.
 *
 * **Why a script and not a route.** `encodeUpload` only helps files uploaded after this
 * change. On 2026-11-25 production held 445 files, 298 MB, 190 of them over 300 KB and 78
 * over 1 MB — those are the bytes readers were downloading, because a body photograph is a
 * plain `<img>` and never passes through `next/image`. Fixing only new uploads would leave
 * the weight on every article published before today.
 *
 * **Why in place, not "make a new file".** The stored URL is the identity: it is in
 * `Article.coverImage`, inside dozens of `contentHtml` bodies, in Tilda-style captions and
 * in queued publisher jobs. Re-encoding the file *under the same name* changes its weight
 * and nothing else — no migration, no rewritten HTML, no broken cover. Format is preserved
 * by `encodeUpload`, so the `.jpg` in the database still points at JPEG bytes.
 *
 * **Why it is safe to run while the site is up.** Each file is written to a temporary name
 * in the same directory and then `rename()`d over the original. `rename` is atomic within
 * a filesystem: a request either opens the old inode or the new one, never a half-written
 * file. A crash between the write and the rename leaves the original untouched.
 *
 * **Dry run unless `--apply`.** The default prints what would change and frees nothing.
 * `--backup <dir>` copies each original before it is replaced, so a single bad file can be
 * put back by hand. The backup is plain copies, not an archive, because recovering one
 * photograph should not need an index.
 *
 * Usage, from the project root:
 *
 *   npx tsx scripts/optimize-uploads.mts                     # dry run, whole directory
 *   npx tsx scripts/optimize-uploads.mts --apply --backup /var/www/uartnews/uploads-backup
 *   npx tsx scripts/optimize-uploads.mts --limit 5 --apply   # a first, visible batch
 */
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { contentTypeFor, UPLOAD_DIR } from "../src/lib/upload-dir";
import { encodeUpload } from "../src/lib/upload-encode";

type Options = {
  apply: boolean;
  backupDir: string | null;
  /** Files below this size are not worth a re-encode; a 40 KB thumbnail is already fine. */
  minBytes: number;
  limit: number | null;
};

function readOptions(argv: string[]): Options {
  const valueOf = (flag: string): string | null => {
    const prefixed = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (prefixed) return prefixed.slice(flag.length + 1);
    const index = argv.indexOf(flag);
    return index >= 0 ? (argv[index + 1] ?? null) : null;
  };

  const minKb = Number(valueOf("--min-kb") ?? "100");
  const limit = valueOf("--limit");

  return {
    apply: argv.includes("--apply"),
    backupDir: valueOf("--backup"),
    minBytes: Number.isFinite(minKb) && minKb > 0 ? minKb * 1024 : 100 * 1024,
    limit: limit !== null && Number.isFinite(Number(limit)) ? Number(limit) : null,
  };
}

const kb = (bytes: number) => `${Math.round(bytes / 1024)} КБ`;

async function main() {
  const options = readOptions(process.argv.slice(2));

  console.log(`Каталог: ${UPLOAD_DIR}`);
  console.log(
    `Режим: ${options.apply ? "ЗАПИСЬ" : "сухой прогон"}` +
      `, порог ${kb(options.minBytes)}` +
      `${options.limit ? `, не больше ${options.limit} файлов` : ""}` +
      `${options.backupDir ? `, копии в ${options.backupDir}` : ""}`,
  );

  let names: string[];
  try {
    names = await readdir(UPLOAD_DIR);
  } catch {
    console.error(`Нет каталога ${UPLOAD_DIR}. Запускать из корня проекта на сервере.`);
    process.exitCode = 1;
    return;
  }

  if (options.apply && options.backupDir) {
    await mkdir(options.backupDir, { recursive: true });
  }

  const queue: { name: string; size: number }[] = [];
  for (const name of names) {
    if (!contentTypeFor(name)) continue;
    const info = await stat(path.join(UPLOAD_DIR, name)).catch(() => null);
    if (!info?.isFile() || info.size < options.minBytes) continue;
    queue.push({ name, size: info.size });
  }

  queue.sort((a, b) => b.size - a.size);
  const selected = options.limit ? queue.slice(0, options.limit) : queue;

  console.log(
    `Подходящих файлов: ${queue.length}, к обработке: ${selected.length}` +
      `, суммарно ${kb(selected.reduce((sum, entry) => sum + entry.size, 0))}\n`,
  );

  let before = 0;
  let after = 0;
  let changed = 0;
  let skipped = 0;
  const failures: string[] = [];
  const savings: { name: string; from: number; to: number }[] = [];

  for (const entry of selected) {
    const target = path.join(UPLOAD_DIR, entry.name);
    const mime = contentTypeFor(entry.name) ?? "image/jpeg";
    before += entry.size;

    let encoded: Awaited<ReturnType<typeof encodeUpload>> = null;
    try {
      encoded = await encodeUpload(await readFile(target), mime);
    } catch (error) {
      failures.push(`${entry.name}: ${(error as Error).message}`);
      after += entry.size;
      continue;
    }

    // 5% is the floor for "worth touching a production file": below it the write, the
    // backup and the atomically replaced inode buy nothing a reader would notice.
    const worthwhile =
      encoded !== null && !encoded.originalKept && encoded.bytes.length < entry.size * 0.95;

    if (!encoded || !worthwhile) {
      skipped += 1;
      after += entry.size;
      continue;
    }

    if (options.apply) {
      const temporary = `${target}.optimize.tmp`;
      try {
        if (options.backupDir) {
          await copyFile(target, path.join(options.backupDir, entry.name));
        }
        await writeFile(temporary, encoded.bytes);
        // Read the written file back before it replaces anything: a short write or a full
        // disk must be caught here, not by the next reader of the article.
        const { default: sharp } = await import("sharp");
        await sharp(temporary).metadata();
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        failures.push(`${entry.name}: ${(error as Error).message}`);
        after += entry.size;
        continue;
      }
    }

    changed += 1;
    after += encoded.bytes.length;
    savings.push({ name: entry.name, from: entry.size, to: encoded.bytes.length });

    const mark = options.apply ? "перекодирован" : "будет уменьшен";
    console.log(
      `  ${mark}: ${entry.name}  ${kb(entry.size)} → ${kb(encoded.bytes.length)}` +
        `  (${Math.round((1 - encoded.bytes.length / entry.size) * 100)}%)`,
    );
  }

  const top = [...savings].sort((a, b) => b.from - b.to - (a.from - a.to)).slice(0, 10);

  console.log(`\nИтог${options.apply ? "" : " (прогноз, файлы не тронуты)"}:`);
  console.log(`  изменилось: ${changed}`);
  console.log(`  пропущено (уже лёгкие или не сжимаются): ${skipped}`);
  console.log(`  было: ${kb(before)}, ${options.apply ? "стало" : "стало бы"}: ${kb(after)}`);
  console.log(
    `  экономия: ${kb(before - after)}` +
      (before > 0 ? ` (${Math.round((1 - after / before) * 100)}%)` : ""),
  );

  if (top.length > 0) {
    console.log("\nКрупнейшие выигрыши:");
    for (const entry of top) {
      console.log(`  ${entry.name}  ${kb(entry.from)} → ${kb(entry.to)}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nОшибки (${failures.length}):`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
}

await main();
