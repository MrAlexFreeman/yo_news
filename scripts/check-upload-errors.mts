/**
 * Ответы /api/upload, которые не являются JSON.
 *
 * Замер прода 2026-11-25: диск заполнился, маршрут не смог записать файл, Next ответил
 * HTML-страницей, и в админке появилось `Unexpected token '<', "<html> <h"... is not valid
 * JSON`. Сообщение описывало работу парсера, а не причину, и не помогало ни редактору, ни
 * тому, кто читал бы его через час.
 *
 * Проверяется разбор: JSON проходит как есть, а страница ошибки превращается в фразу с
 * HTTP-статусом и заголовком страницы ("502 Bad Gateway"), без исключения.
 */
import { readFileSync } from "node:fs";

import { readUploadJson } from "../src/lib/upload-image";

const checks: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const html = (body: string, status = 502) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// --- успешный ответ ---------------------------------------------------------

const ok = await readUploadJson(json({ url: "/uploads/a.png" }, 201));
check(
  "JSON: адрес файла читается как раньше",
  ok.url === "/uploads/a.png" && ok.error === undefined,
  JSON.stringify(ok),
);

// --- ошибка самого маршрута -------------------------------------------------

const refusal = await readUploadJson(
  json({ error: "На сервере закончилось место — файл не сохранён." }, 507),
);
check(
  "JSON-отказ маршрута не подменяется общим текстом",
  refusal.error === "На сервере закончилось место — файл не сохранён." && !refusal.url,
  refusal.error ?? "нет текста",
);

// --- HTML от nginx ----------------------------------------------------------

const gateway = await readUploadJson(
  html(
    "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>",
  ),
);
check(
  "HTML 502: сообщение называет статус и причину из заголовка страницы",
  Boolean(gateway.error?.includes("502")) &&
    Boolean(gateway.error?.includes("Bad Gateway")) &&
    !gateway.url,
  gateway.error ?? "исключение или пустой ответ",
);

const tooLarge = await readUploadJson(
  html(
    "<html><head><title>413 Request Entity Too Large</title></head></html>",
    413,
  ),
);
check(
  "HTML 413: редактор видит «слишком большой файл», а не ошибку парсера",
  Boolean(tooLarge.error?.includes("413")) &&
    Boolean(tooLarge.error?.includes("Request Entity Too Large")),
  tooLarge.error ?? "исключение",
);

// --- прочие не-JSON ответы --------------------------------------------------

const bare = await readUploadJson(html("<html><body>Internal Server Error</body></html>", 500));
check(
  "HTML без заголовка: остаётся HTTP-статус и совет",
  Boolean(bare.error?.includes("500")) && Boolean(bare.error?.includes("администратору")),
  bare.error ?? "исключение",
);

const empty = await readUploadJson(new Response("", { status: 504 }));
check(
  "Пустое тело (прокси оборвал ответ) — сообщение, а не падение",
  Boolean(empty.error?.includes("504")),
  empty.error ?? "исключение",
);

const notJson = await readUploadJson(new Response("OK", { status: 200 }));
check(
  "Текст вместо JSON при 200 — тоже сообщение",
  Boolean(notJson.error?.includes("200")) && !notJson.url,
  notJson.error ?? "исключение",
);

// --- маршрут отвечает JSON даже при сбое записи ------------------------------

const routeSource = readFileSync(new URL("../src/app/api/upload/route.ts", import.meta.url), "utf8");
check(
  "Маршрут: сбой записи возвращает JSON, а не падение в HTML",
  routeSource.includes("ENOSPC") &&
    routeSource.includes("507") &&
    routeSource.includes("Не удалось сохранить файл на сервере"),
  "try/catch вокруг writeFile + 507",
);

for (const entry of checks) {
  console.log(`${entry.ok ? "OK  " : "FAIL"} ${entry.name} — ${entry.detail}`);
}

const failed = checks.filter((entry) => !entry.ok);
console.log(`${checks.length - failed.length}/${checks.length} проверок пройдено`);
process.exit(failed.length === 0 ? 0 : 1);
