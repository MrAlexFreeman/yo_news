/**
 * Reading the answer from `/api/upload` without ever failing on the parse.
 *
 * **Why this exists, measured in production.** The disk filled up, the route's `writeFile`
 * rejected, and Next answered with an HTML error page. Every admin caller did
 * `await response.json()`, so the editor saw
 *
 *   Unexpected token '<', "<html> <h"... is not valid JSON
 *
 * — a parser message instead of "the server is out of space". A failed upload has to reach
 * the editor as a sentence, whichever layer produced the failure: nginx, the framework's
 * error page, or the route itself.
 *
 * The route now answers JSON even for a failed write, so this is the second line of
 * defence: a proxy in front of the app can still return its own HTML page, and the admin
 * should not be left guessing which one answered.
 */

/** The shape every `/api/upload` answer has, success or failure. */
export type UploadPayload = { url?: string; error?: string };

/** Long enough for "502 Bad Gateway", short enough not to paste an error page into the UI. */
const MAX_TITLE = 120;

export async function readUploadJson(response: Response): Promise<UploadPayload> {
  const text = await response.text().catch(() => "");

  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") return parsed as UploadPayload;
  } catch {
    // An HTML page. Handled below rather than rethrown: this function's contract is that
    // it always answers with a payload.
  }

  /*
    `nginx` labels its error pages with a `<title>`, and that title is the whole reason in
    four words — "502 Bad Gateway", "413 Request Entity Too Large". Taking it out of the
    page is what turns "something went wrong" into "the request never reached the app".
  */
  const title = new RegExp(`<title>([^<]{1,${MAX_TITLE}})</title>`, "i")
    .exec(text)?.[1]
    ?.trim();

  return {
    error:
      `Сервер ответил страницей вместо JSON (HTTP ${response.status}` +
      `${title ? `, «${title}»` : ""}). ` +
      "Обычно это ошибка nginx или нехватка места на сервере. Попробуйте ещё раз, " +
      "а если сообщение повторится — скажите администратору.",
  };
}
