"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Video,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { editorExtensions } from "@/app/admin/articles/components/editor-extensions";
import { editorBodyHtml } from "@/app/admin/articles/components/editor-output";
import {
  LinkDialog,
  type LinkRequest,
} from "@/app/admin/articles/components/link-dialog";
import { buildVideoEmbed, unsupportedVideoMessage } from "@/lib/video-embed";
import { cn } from "@/lib/utils";

/**
 * One toolbar control.
 *
 * Most map straight onto an editor command and report their own pressed state.
 * The three that need more than a keystroke — link, video, image — name an
 * `opens` target instead, because a URL prompt and a searchable article picker do
 * not fit in a command.
 */
type ToolbarAction = {
  label: string;
  icon: typeof Bold;
  command?: {
    isActive: (editor: Editor) => boolean;
    run: (editor: Editor) => void;
  };
  opens?: "link" | "video" | "image";
};

const ALIGNMENTS: { label: string; icon: typeof AlignLeft; value: string }[] = [
  { label: "Выравнивание по левому краю", icon: AlignLeft, value: "left" },
  { label: "Выравнивание по центру", icon: AlignCenter, value: "center" },
  { label: "Выравнивание по правому краю", icon: AlignRight, value: "right" },
  { label: "Выравнивание по ширине", icon: AlignJustify, value: "justify" },
];

const GROUPS: ToolbarAction[][] = [
  [
    {
      label: "Исходный код",
      icon: Code,
      command: {
        isActive: (editor) => editor.isActive("codeBlock"),
        run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
      },
    },
  ],
  [
    {
      label: "Жирный",
      icon: Bold,
      command: {
        isActive: (editor) => editor.isActive("bold"),
        run: (editor) => editor.chain().focus().toggleBold().run(),
      },
    },
    {
      label: "Курсив",
      icon: Italic,
      command: {
        isActive: (editor) => editor.isActive("italic"),
        run: (editor) => editor.chain().focus().toggleItalic().run(),
      },
    },
    {
      label: "Подчеркнутый",
      icon: UnderlineIcon,
      command: {
        isActive: (editor) => editor.isActive("underline"),
        run: (editor) => editor.chain().focus().toggleUnderline().run(),
      },
    },
  ],
  [
    {
      label: "Заголовок H2",
      icon: Heading2,
      command: {
        isActive: (editor) => editor.isActive("heading", { level: 2 }),
        run: (editor) =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
    },
    {
      label: "Заголовок H3",
      icon: Heading3,
      command: {
        isActive: (editor) => editor.isActive("heading", { level: 3 }),
        run: (editor) =>
          editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
    },
    {
      label: "Цитата",
      icon: Quote,
      command: {
        isActive: (editor) => editor.isActive("blockquote"),
        run: (editor) => editor.chain().focus().toggleBlockquote().run(),
      },
    },
  ],
  ALIGNMENTS.map(({ label, icon, value }) => ({
    label,
    icon,
    command: {
      isActive: (editor) => editor.isActive({ textAlign: value }),
      run: (editor) => editor.chain().focus().setTextAlign(value).run(),
    },
  })),
  [
    {
      label: "Маркированный список",
      icon: List,
      command: {
        isActive: (editor) => editor.isActive("bulletList"),
        run: (editor) => editor.chain().focus().toggleBulletList().run(),
      },
    },
    {
      label: "Нумерованный список",
      icon: ListOrdered,
      command: {
        isActive: (editor) => editor.isActive("orderedList"),
        run: (editor) => editor.chain().focus().toggleOrderedList().run(),
      },
    },
    {
      label: "Таблица",
      icon: TableIcon,
      command: {
        isActive: (editor) => editor.isActive("table"),
        run: (editor) =>
          editor.chain().focus().insertTable({
            rows: 3,
            cols: 3,
            withHeaderRow: true,
          }).run(),
      },
    },
  ],
  [
    {
      // Opens the link dialog: label, URL, "new tab", and the article search.
      // Ctrl+K / Cmd+K does the same from anywhere in the editor.
      label: "Ссылка (Ctrl+K)",
      icon: LinkIcon,
      opens: "link",
    },
    { label: "Видео", icon: Video, opens: "video" },
    { label: "Изображение", icon: ImageIcon, opens: "image" },
  ],
];

/**
 * Attributes for the editable element itself.
 *
 * A function, not a constant, because `setOptions` replaces the whole `attributes`
 * object rather than merging into it. Pushing only `aria-invalid` would drop the
 * class, the height and `aria-required` the moment it ran — the editor would mount
 * and then lose its typography, which no type or lint would have caught.
 */
function editorAttributes(error?: string) {
  return {
    // The same classes the public page uses, so what an editor sees while writing is
    // the spacing and type of what readers get. Diverging margins here are what make
    // a "visual" editor lie.
    class: "article-body prose min-h-[30rem] max-w-none px-3 py-2",
    spellcheck: "false",
    // On the editable itself rather than the wrapper: only a textbox role carries
    // these, and the body is required.
    "aria-required": "true",
    "aria-invalid": error ? "true" : "false",
  };
}

type ContentEditorProps = {
  value: string;
  onChange: (value: string) => void;
  error?: string;
};

/**
 * The article body editor: a TipTap surface wired to the form's `contentHtml`
 * state.
 *
 * Two contracts matter more than the formatting.
 *
 * The stored value stays a plain HTML string, because that is what the schema,
 * `normalizeArticleHtml`, the sanitiser, the storefront, the Dzen feed and the 71
 * existing articles all speak. Nothing downstream learns that the editor changed.
 *
 * What goes in comes back out. TipTap rewrites a document through its own schema,
 * so any node the schema does not know is dropped on save — which is why this
 * carries a video node and the table extension rather than relying on StarterKit
 * alone. `scripts/check-editor-ui.ts` round-trips the real corpus through the real
 * extensions and fails if anything shrinks.
 */
export function ContentEditor({ value, onChange, error }: ContentEditorProps) {
  const labelId = useId();
  const [toolbarError, setToolbarError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  // The last HTML this editor handed up. An incoming `value` that matches it is
  // our own change coming back from React, and re-applying it would reset the
  // caret mid-sentence. Anything else is a real external change — a restored
  // snapshot, or a body generated by the AI tools — and has to be loaded.
  const emitted = useRef(value);

  const editor = useEditor({
    extensions: editorExtensions(),
    content: value,
    // The editor is created on the client only. Without this the server render
    // would try to build a ProseMirror view and Next.js would hand back HTML that
    // disagrees with the client on the first paint.
    immediatelyRender: false,
    editorProps: {
      attributes: editorAttributes(),
    },
    onUpdate: ({ editor: current }) => {
      const html = editorBodyHtml(current);
      emitted.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (value === emitted.current) return;

    emitted.current = value;
    // emitUpdate: false because the parent already holds this exact value, and
    // reporting it back would loop.
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  /**
   * Mirrors the server's verdict onto the editable.
   *
   * `aria-invalid` lives in `editorProps`, which is only read when the editor is
   * built — so a failed save, which arrives after that, needs the option pushed
   * again. Without it a screen reader is told a rejected body is fine.
   */
  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        attributes: editorAttributes(error),
      },
    });
  }, [editor, error]);

  /**
   * Ctrl+K / Cmd+K opens the link dialog, as in every other editor.
   *
   * Bound on the window so the shortcut works wherever the caret is, and
   * suppressed while the dialog is open so Ctrl+K cannot stack a second one.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (linkOpen) return;
      setToolbarError(null);
      setLinkOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linkOpen]);

  /**
   * Turns the dialog's answer into a mark on a text range.
   *
   * With nothing selected the label becomes the link text, since a link with no
   * anchor is not a link. With a selection the label replaces it, which is what
   * the dialog's editable label field implies. `extendMarkRange` runs last so an
   * editor who clicks inside an existing word and hits Ctrl+K gets the whole
   * word's link retargeted rather than a second link inside it.
   */
  function applyLink(request: LinkRequest) {
    setLinkOpen(false);
    if (!editor) return;

    const attrs: { href: string; target: string; rel?: string } = {
      href: request.url,
      // "_self" rather than omitting target, because the storefront applies _blank
      // to a link that states no preference — omitting it would make the dialog's
      // "new tab" checkbox a decoration.
      target: request.blank ? "_blank" : "_self",
    };
    if (request.blank) attrs.rel = "noopener noreferrer";

    const chain = editor.chain().focus();
    const { from, to } = editor.state.selection;

    if (from === to) {
      const label = request.label.trim();
      if (!label) return;
      chain.insertContent(label);
      chain.setTextSelection({ from, to: from + label.length });
    }

    chain.extendMarkRange("link").setLink(attrs).run();
  }

  function insertVideo(editorInstance: NonNullable<typeof editor>) {
    const answer = window.prompt(
      "Ссылка на видео (YouTube, Rutube или VK Видео):",
      "https://",
    );
    if (answer === null) return;

    // Built through the vetted provider list rather than interpolated into a src:
    // buildVideoEmbed is what decides a host is one of ours.
    const embed = buildVideoEmbed(answer);
    const src = embed
      ? new RegExp(`<iframe[^>]*\\ssrc="([^"]+)"`).exec(embed)?.[1]
      : undefined;

    if (!src) {
      setToolbarError(unsupportedVideoMessage(answer));
      return;
    }

    setToolbarError(null);
    editorInstance
      .chain()
      .focus()
      .insertContent({ type: "videoEmbed", attrs: { src } })
      .run();
  }

  function insertImage(editorInstance: NonNullable<typeof editor>) {
    const answer = window.prompt(
      "Адрес изображения (например /uploads/файл.webp):",
      "/uploads/",
    );
    if (!answer?.trim()) return;

    setToolbarError(null);
    editorInstance.chain().focus().setImage({ src: answer.trim() }).run();
  }

  function applyAction(action: ToolbarAction) {
    if (!editor) return;

    if (action.command) {
      setToolbarError(null);
      action.command.run(editor);
      return;
    }

    if (action.opens === "link") {
      setToolbarError(null);
      setLinkOpen(true);
    } else if (action.opens === "video") {
      insertVideo(editor);
    } else if (action.opens === "image") {
      insertImage(editor);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <label id={labelId} className="text-sm font-medium text-neutral-700">
          Текст материала{" "}
          <span aria-hidden className="text-red-600">
            *
          </span>
        </label>
      </div>

      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={error ? `${labelId}-error` : undefined}
        className={cn(
          "rounded border bg-white shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]",
          "focus-within:border-blue-500",
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
                const pressed = action.command
                  ? action.command.isActive(editor ?? fallbackEditor)
                  : false;
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => applyAction(action)}
                    title={action.label}
                    aria-label={action.label}
                    aria-pressed={action.command ? pressed : undefined}
                    className={cn(
                      "rounded-sm border p-1.5 transition-colors",
                      pressed
                        ? "border-neutral-400 bg-white text-neutral-900"
                        : "border-transparent text-neutral-700",
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

        {editor ? (
          <EditorContent editor={editor} />
        ) : (
          // Same box while the editor is being created, so the form does not jump.
          <div className="min-h-[30rem]" aria-hidden />
        )}
      </div>

      {toolbarError ? (
        <p role="alert" className="text-sm text-red-600">
          {toolbarError}
        </p>
      ) : null}

      <p className="text-xs text-neutral-400">
        Форматирование видно сразу, как на сайте. «Ссылка» (или Ctrl+K) открывает
        окно с поиском по опубликованным новостям, «Видео» спросит адрес ролика,
        «Изображение» — адрес файла в /uploads.
      </p>

      {linkOpen ? (
        <LinkDialog
          initialLabel={linkLabel(editor)}
          onApply={applyLink}
          onClose={() => setLinkOpen(false)}
        />
      ) : null}

      {error ? (
        <p id={`${labelId}-error`} className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The text the link dialog should offer to put inside a new link: the current
 * selection, or empty when the caret is just sitting somewhere.
 */
function linkLabel(editor: Editor | null): string {
  if (!editor) return "";
  const { from, to, empty } = editor.state.selection;
  if (empty) return "";
  return editor.state.doc.textBetween(from, to, " ");
}

/** Editor type alias, kept local so the toolbar signature reads cleanly. */
type Editor = NonNullable<ReturnType<typeof useEditor>>;

/**
 * Placeholder passed to `isActive` before the editor exists.
 *
 * Toolbar buttons render before `useEditor` resolves. A stub with the same shape
 * keeps the pressed-state lookup total instead of forcing a null check into every
 * action definition; every real state reads false on it, which is the correct
 * answer for an editor that has no content yet.
 */
const fallbackEditor = {
  isActive: () => false,
} as unknown as Editor;