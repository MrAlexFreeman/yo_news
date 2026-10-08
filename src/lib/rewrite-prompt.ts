/**
 * The rewrite prompt, and reading the model's answer back.
 *
 * Pure — no fetch, no key, no Prisma — because both halves are where the bugs are. The
 * prompt decides what the desk gets; the parser decides whether a model that wrapped its
 * JSON in a code fence, or added a sentence before it, produces an article or an error
 * message. Neither is testable through a live API call in a suite that must run offline.
 */

/**
 * The editorial voice, as specified for this desk.
 *
 * The JSON shape is stated twice on purpose — in prose and as a literal — because models
 * follow the literal more reliably and the prose more reliably constrain the tone.
 *
 * `lead` is asked for although the specification listed only two fields: the prompt
 * requires a "лаконичный лид", and there is nowhere else for it to go. It is optional in
 * the parser, so a model that returns the two specified fields is still accepted.
 */
export const REWRITE_SYSTEM_PROMPT = `Ты профессиональный выпускающий редактор уральского новостного издания «Ё-новости». Перепиши предоставленную новость: создай цепляющий журналистский заголовок, лаконичный лид и связный фактологический текст в 3-5 абзацев. Сохрани все факты, имена и цифры. Не выдумывай отсебятины. Верни JSON: { title: string, lead: string, contentHtml: string }.

Требования к формату:
- contentHtml — HTML только из тегов <p>, <b>, <i>, <a href>. Без <html>, <body>, <script>, без markdown и без ограждающих тройных кавычек.
- Каждый абзац — отдельный <p>.
- Никакого текста вне JSON.`;

/** How much of the source story is sent. */
export const REWRITE_SOURCE_LIMIT = 8000;

export type RewriteRequest = {
  title: string;
  rawText: string;
  /** The outlet, so the model knows what it is rewriting and can attribute nothing. */
  source?: string | null;
  originalUrl?: string | null;
};

/**
 * The user message: the story, clearly marked, with no instruction that could be
 * mistaken for part of it.
 *
 * The source text is fenced and labelled. A feed item is third-party text, and a
 * sentence in it that reads like an instruction ("игнорируй предыдущие указания")
 * should arrive as something to rewrite rather than as something to obey — which is
 * what the explicit framing buys.
 */
export function buildRewriteUserMessage(request: RewriteRequest): string {
  const source = request.rawText.trim().slice(0, REWRITE_SOURCE_LIMIT);

  const parts = [
    "Перепиши новость ниже по правилам из системного сообщения.",
    "Верни только JSON.",
    "",
    "=== НАЧАЛО ИСХОДНОЙ НОВОСТИ ===",
    `Заголовок источника: ${request.title.trim()}`,
  ];

  if (request.source) parts.push(`Источник: ${request.source}`);
  parts.push("", source, "=== КОНЕЦ ИСХОДНОЙ НОВОСТИ ===");

  return parts.join("\n");
}

export type RewriteResult = {
  title: string;
  lead: string;
  contentHtml: string;
};

/**
 * Pulls the JSON object out of whatever the model replied with.
 *
 * Two things models do that make a bare `JSON.parse` fail: they wrap the answer in a
 * ``` fence, and they add a sentence of commentary before or after it. Both are handled
 * by taking the outermost braces, which is also what keeps a nested object inside
 * `contentHtml` from confusing the slice.
 *
 * Returns null rather than throwing, and the caller turns that into the same message a
 * failed call produces: from the editor's side, "the model answered with something
 * unusable" and "the model did not answer" are one problem with one retry.
 */
export function parseRewriteResponse(raw: string): RewriteResult | null {
  const text = raw.trim();
  if (!text) return null;

  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;

  const title = asText(record.title);
  const contentHtml = asText(record.contentHtml);
  if (!title || !contentHtml) return null;

  return { title, lead: asText(record.lead), contentHtml };
}

/** A trimmed string, or empty. Anything that is not a string is not one. */
function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** True when the model returned HTML rather than a paragraph of prose. */
export function looksLikeHtml(value: string): boolean {
  return /<\/?(?:p|h[1-6]|ul|ol|li|blockquote|b|i|strong|em|a)\b/i.test(value);
}
