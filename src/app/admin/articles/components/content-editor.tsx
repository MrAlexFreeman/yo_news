"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Building2,
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
  TextQuote,
  Underline as UnderlineIcon,
  Video,
} from "lucide-react";
import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";

import { editorExtensions } from "@/app/admin/articles/components/editor-extensions";
import { editorBodyHtml } from "@/app/admin/articles/components/editor-output";
import {
  InsertImageDialog,
} from "@/app/admin/articles/components/insert-image-dialog";
import { insertFigureAtCaret } from "@/app/admin/articles/components/article-figure-node";
import { insertQuoteSourceAtCaret } from "@/app/admin/articles/components/article-quote";
import { EntityCardPicker } from "@/app/admin/articles/components/entity-card-picker";
import {
  LinkDialog,
  type LinkRequest,
} from "@/app/admin/articles/components/link-dialog";
import type { MediaItem } from "@/lib/article-media";
import { buildVideoEmbed, unsupportedVideoMessage } from "@/lib/video-embed";
import { cn } from "@/lib/utils";

/**
 * One toolbar control.
 *
 * Most map straight onto an editor command and report their own pressed state.
 * The ones that need more than a keystroke — link, video, image, source — name an
 * `opens` target instead, because a URL prompt, a file picker and a searchable
 * article picker do not fit in a command.
 */
type ToolbarAction = {
  label: string;
  icon: typeof Bold;
  command?: {
    isActive: (editor: Editor) => boolean;
    run: (editor: Editor) => void;
  };
  opens?: "link" | "video" | "figure" | "quoteSource" | "entityCard";
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
    {
      // Adds the attribution line inside the quotation the caret is in. Not a toggle:
      // a citation either gets a source or it does not, and pressing again would add a
      // second one rather than remove the first.
      label: "Источник цитаты",
      icon: TextQuote,
      opens: "quoteSource",
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
    { label: "Карточка объекта", icon: Building2, opens: "entityCard" },
    { label: "Вставить фото в текст", icon: ImageIcon, opens: "figure" },
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
  /** Gallery of the article being edited, so a photo can be reused without re-uploading. */
  media?: MediaItem[];
  /** Cover of the article being edited, offered in the same list. */
  coverImage?: string;
  /**
   * Imperative handle for the sidebar, which puts a photo into the body from outside
   * this component. React 19 passes `ref` as an ordinary prop, so no forwardRef.
   */
  ref?: React.Ref<ContentEditorHandle>;
  /**
   * Fires when the writer first puts the cursor in the text, and when the editor goes
   * away with it. The sidebar's hint has to say what a click will do, and that depends
   * on this — which a ref cannot drive, because a ref change does not re-render.
   */
  onCaretChange?: (placed: boolean) => void;
};

/** Where a photo ended up, so the caller can tell the editor what happened. */
export type PhotoPlacement = "caret" | "end";

export type ContentEditorHandle = {
  /**
   * Puts a photo into the body.
   *
   * `caret` when the writer had placed the cursor in the text, `end` when they had
   * not — the two are different enough that the sidebar says which one happened
   * rather than leaving a picture at the bottom of the article unexplained.
   *
   * Returns null when the editor is not ready yet, which the caller treats as "append
   * to the stored HTML instead".
   */
  insertPhoto: (src: string, caption: string) => PhotoPlacement | null;
  /** True once the writer has put the cursor in the text at least once. */
  hasCaret: () => boolean;
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
export function ContentEditor({
  value,
  onChange,
  error,
  media = [],
  coverImage = "",
  ref,
  onCaretChange,
}: ContentEditorProps) {
  const labelId = useId();
  const [toolbarError, setToolbarError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [entityOpen, setEntityOpen] = useState(false);

  /**
   * Whether the writer has ever put the cursor in the text.
   *
   * The sidebar inserts a photo from outside this component, and by the time its
   * button is clicked the editor has already lost focus — a click on a button moves
   * the focus. So `editor.isFocused` is always false at that moment and cannot be the
   * test. What survives the blur is ProseMirror's selection, and this flag says
   * whether that selection is something the writer placed or just position zero.
   */
  const [caretPlaced, setCaretPlaced] = useState(false);

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
    // Recorded because it is the only durable signal that a caret was placed: see
    // `caretPlaced`. Nothing else in the component needs the focus event.
    onFocus: () => {
      setCaretPlaced(true);
      onCaretChange?.(true);
    },
    onUpdate: ({ editor: current }) => {
      const html = editorBodyHtml(current);
      emitted.current = html;
      onChange(html);
    },
  });

  /*
    The editor unmounts when the writer switches to another tab, and its selection goes
    with it. Reporting that upwards keeps the sidebar's hint honest: after a tab switch
    the next click really will append to the end, and the hint should have said so
    before it was clicked.
  */
  useEffect(() => {
    if (!editor) return;
    return () => onCaretChange?.(false);
  }, [editor, onCaretChange]);

  /**
   * The sidebar's way in.
   *
   * Two placements, and the difference is visible to the writer: with the cursor in
   * the text the photo lands where they were writing, and without it the photo goes to
   * the end of the body. The sidebar reports which one happened, so a picture at the
   * bottom of a long article is explained rather than mysterious.
   */
  useImperativeHandle(
    ref,
    () => ({
      hasCaret: () => caretPlaced,
      insertPhoto(src, caption) {
        if (!editor) return null;

        if (!caretPlaced) {
          // Position at the very end of the document. `insertFigureAtCaret` then takes
          // care of the paragraph underneath, the same as it does for a caret that was
          // already there.
          const end = editor.state.doc.content.size;
          editor.chain().focus().setTextSelection(end).run();
          insertFigureAtCaret(editor, src, caption, caption);
          return "end";
        }

        insertFigureAtCaret(editor, src, caption, caption);
        return "caret";
      },
    }),
    [editor, caretPlaced],
  );

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
    const inserted = from === to;

    if (inserted) {
      const label = request.label.trim();
      if (!label) return;
      chain.insertContent(label);
      chain.setTextSelection({ from, to: from + label.length });
    }

    chain.extendMarkRange("link").setLink(attrs).run();

    // The caret lands after the link, not inside it.
    //
    // Selecting the label is what lets the mark land on it, but leaving the caret
    // there means the editor is standing inside a link with every following character
    // destined for it — and the previous source editor put the caret after the markup,
    // so this is a regression rather than a new behaviour. Combined with
    // `inclusive: false` on the mark, the next thing typed is ordinary text.
    if (inserted) {
      const after = editor.state.selection.to;
      editor.commands.setTextSelection(after);
    }
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
    } else if (action.opens === "figure") {
      setToolbarError(null);
      setImageOpen(true);
    } else if (action.opens === "entityCard") {
      setToolbarError(null);
      setEntityOpen(true);
    } else if (action.opens === "quoteSource") {
      // The only toolbar action that can be unavailable. Said out loud rather than
      // shown disabled: a greyed-out button explains nothing, and the reason — the
      // caret is not in a quotation — is one sentence.
      if (insertQuoteSourceAtCaret(editor)) {
        setToolbarError(null);
      } else {
        setToolbarError(
          "Источник добавляется внутрь цитаты: сначала выделите абзац и нажмите «Цитата».",
        );
      }
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
        «Вставить фото в текст» поставит картинку в то место, где стоит курсор.
      </p>

      {linkOpen ? (
        <LinkDialog
          initialLabel={linkLabel(editor)}
          onApply={applyLink}
          onClose={() => setLinkOpen(false)}
        />
      ) : null}

      {imageOpen && editor ? (
        <InsertImageDialog
          html={value}
          media={media}
          coverImage={coverImage}
          onClose={() => setImageOpen(false)}
          onInsert={({ src, alt, caption }) => {
            insertFigureAtCaret(editor, src, alt, caption);
            setImageOpen(false);
            setToolbarError(null);
          }}
        />
      ) : null}

      {entityOpen && editor ? (
        <EntityCardPicker
          open={entityOpen}
          onClose={() => setEntityOpen(false)}
          onPick={(card) => {
            /*
              The selection is the point of the tool: the mark wraps the words the editor
              had highlighted, so "Янга-Тау" stays "Янга-Тау" and gains a card. With an empty
              selection `setMark` would mark nothing at all and the editor would see the
              button do nothing — said out loud instead, because a silent no-op in a
              toolbar reads as a broken editor rather than as a missing selection.
            */
            const { from, to } = editor.state.selection;
            if (from === to) {
              setToolbarError(
                "Выделите в тексте название объекта — карточка привяжется к выделенным словам.",
              );
              setEntityOpen(false);
              return;
            }

            editor
              .chain()
              .focus()
              .toggleEntityCard({ slug: card.slug, title: card.title })
              .run();
            setEntityOpen(false);
            setToolbarError(null);
          }}
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