"use client";

import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Table as TableIcon,
  Underline,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  LinkDialog,
  buildLinkMarkup,
  type LinkRequest,
} from "@/app/admin/articles/components/link-dialog";
import { buildVideoEmbed, unsupportedVideoMessage } from "@/lib/video-embed";
import { cn } from "@/lib/utils";

/** One toolbar control. `wrap` toggles a tag, `insert` drops in a block. */
type ToolbarAction = {
  label: string;
  icon: typeof Bold;
  kind: "wrap" | "insert" | "align" | "link" | "video";
  /** Tag for `wrap`, opening tag for `insert`, CSS class for `align`. */
  target: string;
  placeholder?: string;
  close?: string;
};

const GROUPS: ToolbarAction[][] = [
  [{ label: "Source", icon: Code, kind: "insert", target: "<pre>", close: "</pre>", placeholder: "<p>исходный код</p>" }],
  [
    { label: "Жирный", icon: Bold, kind: "wrap", target: "strong" },
    { label: "Курсив", icon: Italic, kind: "wrap", target: "em" },
    { label: "Подчеркнутый", icon: Underline, kind: "wrap", target: "u" },
    { label: "Цитата", icon: Quote, kind: "wrap", target: "blockquote" },
  ],
  [
    { label: "Выравнивание по левому краю", icon: AlignLeft, kind: "align", target: "left" },
    { label: "Выравнивание по центру", icon: AlignCenter, kind: "align", target: "center" },
    { label: "Выравнивание по правому краю", icon: AlignRight, kind: "align", target: "right" },
    { label: "Выравнивание по ширине", icon: AlignJustify, kind: "align", target: "justify" },
  ],
  [
    {
      label: "Маркированный список",
      icon: List,
      kind: "insert",
      target: "<ul>\n  <li>",
      close: "</li>\n</ul>",
      placeholder: "пункт",
    },
    {
      label: "Нумерованный список",
      icon: ListOrdered,
      kind: "insert",
      target: "<ol>\n  <li>",
      close: "</li>\n</ol>",
      placeholder: "пункт",
    },
  ],
  [
    {
      // Opens the link dialog: label, URL, "new tab", and the article search.
      // Ctrl+K / Cmd+K does the same from anywhere in the editor.
      label: "Ссылка (Ctrl+K)",
      icon: LinkIcon,
      kind: "link",
      target: "a",
      placeholder: "текст ссылки",
    },
    {
      label: "Видео",
      icon: Video,
      kind: "video",
      target: "video",
    },
    {
      label: "Изображение",
      icon: ImageIcon,
      kind: "insert",
      target: '<img src="/uploads/',
      placeholder: "",
    },
    {
      label: "Таблица",
      icon: TableIcon,
      kind: "insert",
      target: "<table>\n  <tbody>\n    <tr>\n      <td>",
      close: "</td>\n    </tr>\n  </tbody>\n</table>",
      placeholder: "ячейка",
    },
  ],
];

type ContentEditorProps = {
  value: string;
  onChange: (value: string) => void;
  error?: string;
};

const PARAGRAPH = /<p\b([^>]*)>/gi;

/**
 * Returns the `<p …>` opening tag that governs `caret` — that is, the caret
 * sits after that tag's `>` and before the paragraph's `</p>`. Null means the
 * caret is outside any paragraph (in the tag itself, or in bare text), so the
 * caller should insert a new paragraph instead of restyling.
 */
function paragraphAt(value: string, caret: number) {
  PARAGRAPH.lastIndex = 0;
  let found: { tag: string; start: number; end: number } | null = null;

  for (const match of value.matchAll(PARAGRAPH)) {
    if (match.index === undefined) break;
    const start = match.index;
    const end = start + match[0].length;
    const close = value.toLowerCase().indexOf("</p>", end);
    const contentEnd = close === -1 ? value.length : close;

    if (caret >= end && caret <= contentEnd) {
      found = { tag: match[0], start, end };
    }
  }

  return found;
}

/** Rewrites (or creates) the `style` attribute so it carries `text-align`. */
function withAlignment(tag: string, alignment: string): string {
  const open = tag.slice(0, -1);
  const style = open.match(/\sstyle\s*=\s*"([^"]*)"/i);

  if (!style) {
    return `${open.trimEnd()} style="text-align: ${alignment}">`;
  }

  const kept = style[1]
    .split(";")
    .map((rule) => rule.trim())
    .filter((rule) => rule && !rule.startsWith("text-align"))
    .join("; ");

  return `${open.replace(style[0], "")} style="${kept ? `${kept}; ` : ""}text-align: ${alignment}">`;
}

/**
 * Placeholder rich-text editor styled after CKEditor 4: a raised toolbar strip
 * of icon buttons above a monospaced source area. It manipulates the selection
 * as HTML text, so the stored value stays the same `contentHtml` string the
 * schema expects — swapping in TipTap later leaves the form contract intact.
 */
export function ContentEditor({ value, onChange, error }: ContentEditorProps) {
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [toolbarError, setToolbarError] = useState<string | null>(null);
  // Where the textarea selection was when the link dialog opened, so the inserted
  // markup replaces that text and the caret lands after it.
  const [linkState, setLinkState] = useState<{
    selectionStart: number;
    selectionEnd: number;
    selected: string;
  } | null>(null);

  const openLinkDialog = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    setToolbarError(null);
    setLinkState({
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
      selected: value.slice(textarea.selectionStart, textarea.selectionEnd),
    });
  }, [value]);

  /**
   * Ctrl+K / Cmd+K opens the link dialog, as in every other editor.
   *
   * Bound on the window rather than the textarea so the shortcut works wherever
   * the caret is inside the editor, and suppressed while a dialog is open so Ctrl+K
   * does not stack a second one.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (linkState) return;
      openLinkDialog();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linkState, openLinkDialog]);

  function applyLink(request: LinkRequest) {
    const textarea = textareaRef.current;
    const state = linkState;
    setLinkState(null);
    if (!textarea || !state) return;

    const markup = buildLinkMarkup(request);
    const before = value.slice(0, state.selectionStart);
    const after = value.slice(state.selectionEnd);

    onChange(`${before}${markup}${after}`);

    const caret = state.selectionStart + markup.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }

  function applyAction(action: ToolbarAction) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    setToolbarError(null);

    const { selectionStart, selectionEnd } = textarea;
    const selected = value.slice(selectionStart, selectionEnd);
    const before = value.slice(0, selectionStart);
    const after = value.slice(selectionEnd);

    let inserted: string;
    let caret: number;

    if (action.kind === "link") {
      // Handled by the dialog rather than inline: it needs two fields, a checkbox
      // and the article search, none of which fit in a window.prompt. The selection
      // is captured here and re-applied by applyLink.
      openLinkDialog();
      return;
    } else if (action.kind === "video") {
      const url = window.prompt(
        "Ссылка на видео (YouTube, Rutube или VK Видео):",
        "https://",
      );
      if (url === null) return;

      const embed = buildVideoEmbed(url);
      if (!embed) {
        setToolbarError(unsupportedVideoMessage(url));
        return;
      }

      const spacer = before.length > 0 && !before.endsWith("\n") ? "\n\n" : "";
      const closer = after.length > 0 && !after.startsWith("\n") ? "\n\n" : "";
      inserted = `${spacer}${embed}${closer}`;
      caret = selectionStart + inserted.length;
    } else if (action.kind === "wrap") {
      const open = `<${action.target}>`;
      const close = `</${action.target}>`;
      inserted = `${open}${selected}${close}`;
      caret = selectionStart + inserted.length;
    } else if (action.kind === "align") {
      // Restyles the paragraph the caret sits in, otherwise wraps the selection.
      const paragraph = paragraphAt(value, selectionStart);
      if (paragraph) {
        onChange(
          value.slice(0, paragraph.start) +
            withAlignment(paragraph.tag, action.target) +
            value.slice(paragraph.end),
        );
        requestAnimationFrame(() => {
          textarea.focus();
          textarea.setSelectionRange(selectionStart, selectionEnd);
        });
        return;
      }
      inserted = `<p style="text-align: ${action.target}">${
        selected || "Текст"
      }</p>`;
      caret = selectionStart + inserted.length;
    } else {
      const body = selected || action.placeholder || "";
      const close = action.close ?? "";
      inserted = `${action.target}${body}${close}`;
      caret = selectionStart + action.target.length + body.length;
    }

    onChange(`${before}${inserted}${after}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor={id} className="text-sm font-medium text-neutral-700">
          Текст материала{" "}
          <span aria-hidden className="text-red-600">
            *
          </span>
        </label>
      </div>

      <div
        className={cn(
          "rounded border bg-white shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]",
          error ? "border-red-500" : "border-neutral-400",
        )}
      >
        {/* Toolbar: classic CKEditor strip — grey gradient, grouped buttons. */}
        <div className="flex flex-wrap items-center gap-x-0.5 gap-y-0.5 rounded-t border-b border-neutral-300 bg-gradient-to-b from-neutral-100 to-neutral-200 px-1 py-1">
          {GROUPS.map((group, groupIndex) => (
            <div key={groupIndex} className="flex items-center gap-0.5">
              {groupIndex > 0 ? (
                <span
                  aria-hidden
                  className="mx-0.5 h-5 w-px bg-neutral-300"
                />
              ) : null}
              {group.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    // Keeps the textarea selection alive across the click.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyAction(action)}
                    title={action.label}
                    aria-label={action.label}
                    className={cn(
                      "rounded-sm border border-transparent p-1.5 text-neutral-700 transition-colors",
                      "hover:border-neutral-400 hover:bg-neutral-100 hover:text-neutral-900",
                      "focus-visible:border-blue-500 focus-visible:outline-none",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={20}
          required
          placeholder="<p>Текст материала…</p>"
          aria-invalid={Boolean(error)}
          aria-required="true"
          spellCheck={false}
          className="block w-full resize-y rounded-b px-3 py-2 font-mono text-sm leading-relaxed outline-none placeholder:text-neutral-400"
        />
      </div>

      {toolbarError ? (
        <p role="alert" className="text-sm text-red-600">
          {toolbarError}
        </p>
      ) : null}

      <p className="text-xs text-neutral-400">
        Абзацы разделяются пустой строкой, перенос строки внутри абзаца
        превращается в разрыв. «Ссылка» (или Ctrl+K) открывает окно с поиском
        по опубликованным новостям, «Видео» спросит адрес ролика.
      </p>

      {linkState ? (
        <LinkDialog
          initialLabel={linkState.selected}
          onApply={applyLink}
          onClose={() => setLinkState(null)}
        />
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
