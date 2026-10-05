"use client";

import {
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Search,
  Tag,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  createArticleAction,
  deleteArticleAction,
} from "@/app/admin/articles/actions";
import { ArticlePreview } from "@/app/admin/articles/components/article-preview";
import { CharCounter } from "@/app/admin/articles/components/char-counter";
import { ContentEditor } from "@/app/admin/articles/components/content-editor";
import { PublishSidebar } from "@/app/admin/articles/components/publish-sidebar";
import { StickyActionBar } from "@/app/admin/articles/components/sticky-action-bar";
import { TagInput } from "@/app/admin/articles/components/tag-input";
import { TitleField } from "@/app/admin/articles/components/title-field";
import { VkVideoDrop } from "@/app/admin/articles/components/vk-video-drop";
import { AiCoverGenerator } from "@/app/admin/articles/components/ai-cover-generator";
import { BalanceStrip } from "@/app/admin/articles/components/balance-strip";
import { MediaEditor } from "@/app/admin/articles/components/media-editor";
import { parseMediaField, serializeMedia, type MediaItem } from "@/lib/article-media";
import { AI_GENERATED_SOURCE } from "@/lib/photo-sources";
import { canSetDzenExperiment } from "@/lib/dzen-experiment";
import {
  DZEN_MIN_CARD_WIDTH,
  NARROW_COVER_WARNING,
  readImageDimensions,
} from "@/lib/image-dimensions";
import {
  SEO_DESCRIPTION_MAX_LENGTH,
  SEO_DESCRIPTION_SOFT_LIMIT,
  SEO_TITLE_MAX_LENGTH,
  SEO_TITLE_SOFT_LIMIT,
  type ArticleFormValues,
  type ArticleInitialValues,
  type CategoryOption,
  type SaveArticleResult,
} from "@/app/admin/articles/types";
import type { ArticleStatus } from "@/lib/article-status";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "material", label: "Материал", icon: FileText },
  { id: "media", label: "Медиа", icon: ImageIcon },
  { id: "tags", label: "Тэги", icon: Tag },
  { id: "seo", label: "SEO", icon: Search },
] as const;

type TabId = (typeof TABS)[number]["id"];

const INITIAL_STATE: SaveArticleResult = { ok: false, message: "" };

const LEAD_LIMIT = 240;

/**
 * Current Moscow wall clock as "YYYY-MM-DDTHH:mm", the format `datetime-local`
 * expects.
 *
 * The editorial desk publishes on Moscow time regardless of where the editor's
 * laptop is set, so the default is not taken from the browser. Server time is
 * used as the base and shifted by the zone's offset, which keeps this correct
 * on the 709 MB VPS where the process runs on UTC.
 */
function moscowNow(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/**
 * Inverse of `moscowNow` for the value in the datetime-local field: a
 * "YYYY-MM-DDTHH:mm" string read back as a Date, for display-only comparisons.
 *
 * Only used to decide whether the experiment flag is still editable, so a small
 * three-hour skew around the window boundary costs at most one checkbox update.
 * The stored date — and therefore the authoritative decision — comes from the
 * action, which does the conversion properly.
 */
function moscowInputToDate(value: string): Date | null {
  if (!value) return null;
  const parsed = Date.parse(`${value}:00Z`);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/**
 * Everything the form holds, so a revert has something to revert to.
 *
 * Deliberately not `ArticleInitialValues`: the snapshot describes field state
 * only. Which article is loaded and what its slug is come from the route and the
 * server, and mixing them in is how a revert ends up restoring a stale id.
 */
type FormSnapshot = Omit<
  ArticleFormValues,
  "id" | "slug" | "publishedAt" | "tags" | "media" | "dzenExperimentLocked"
> & {
  publishedAt: string;
  /** Compared as a joined string: the array identity changes on every render. */
  tags: string;
  /** Same reason as tags — compared by value, not by reference. */
  media: string;
};

type Snapshot = FormSnapshot | null;

type ArticleFormProps = {
  categories: CategoryOption[];
  /**
   * Present when editing an existing article. Its absence is what makes the
   * form a "create" form, so the two modes cannot drift apart.
   */
  initial?: ArticleInitialValues;
};

export function ArticleForm({ categories, initial }: ArticleFormProps) {
  const [state, formAction, pending] = useActionState(
    // useActionState passes the previous state first; the action reads FormData.
    async (_prevState: SaveArticleResult, formData: FormData) =>
      createArticleAction(formData),
    INITIAL_STATE,
  );

  const router = useRouter();
  const [deletePending, startDelete] = useTransition();
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  // Computed once per mount so the field starts at "now" rather than tracking
  // every re-render, and always at Moscow time.
  const defaultPublishedAt = useMemo(
    () => initial?.publishedAt || moscowNow(),
    [initial],
  );

  const [tab, setTab] = useState<TabId>("material");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? "");
  const [lead, setLead] = useState(initial?.lead ?? "");
  const [contentHtml, setContentHtml] = useState(initial?.contentHtml ?? "");
  const [coverImage, setCoverImage] = useState(initial?.coverImage ?? "");
  const [photoAuthor, setPhotoAuthor] = useState(initial?.photoAuthor ?? "");
  const [photoSource, setPhotoSource] = useState(initial?.photoSource ?? "");
  const [photoSourceOptions, setPhotoSourceOptions] = useState<string[]>([]);
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(
    initial?.seoDescription ?? "",
  );
  const [seoCanonicalUrl, setSeoCanonicalUrl] = useState(
    initial?.seoCanonicalUrl ?? "",
  );
  const [noIndex, setNoIndex] = useState(initial?.noIndex ?? false);
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [media, setMedia] = useState<MediaItem[]>(initial?.media ?? []);
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? "");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Non-blocking note about the cover, e.g. it is narrower than Dzen wants. */
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? "");
  const [status, setStatus] = useState<ArticleStatus>(
    initial?.status ?? "draft",
  );
  const [publishedAt, setPublishedAt] = useState(defaultPublishedAt);
  const [isDzen, setIsDzen] = useState(initial?.isDzen ?? true);
  const [isVk, setIsVk] = useState(initial?.isVk ?? true);
  const [isExclusive, setIsExclusive] = useState(initial?.isExclusive ?? false);
  const [is18plus, setIs18plus] = useState(initial?.is18plus ?? false);
  const [dzenExperiment, setDzenExperiment] = useState(initial?.dzenExperiment ?? false);
  const [dzenDirect, setDzenDirect] = useState(initial?.dzenDirect ?? false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Owned by the client for immediate feedback when the editor moves the publish
  // date, but refreshed from every save result so a server-side lock (a crafted
  // POST, or a rule this client does not know about) becomes visible at once.
  const [dzenExperimentLockedByServer, setDzenExperimentLockedByServer] = useState(
    initial?.dzenExperimentLocked ?? false,
  );

  /**
   * Loads the credits already in use for the datalist.
   *
   * Failure is silent on purpose: the field is a plain text input either way, so a
   * network error here would leave the editor able to type a credit exactly as before.
   * Reporting it would put an error on screen for something that costs nothing.
   */
  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/photo-sources")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { sources?: string[] } | null) => {
        if (cancelled || !payload?.sources) return;
        setPhotoSourceOptions(payload.sources);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The same rule the action applies, evaluated against the date currently shown
   * in the form so the checkbox locks the moment an editor backdates the story
   * rather than after a save. `canSetDzenExperiment` is a pure function, so the
   * form and the action cannot drift apart in their answer.
   */
  const dzenExperimentLocked =
    dzenExperimentLockedByServer ||
    !canSetDzenExperiment({
      storedPublishedAt: null,
      chosenPublishedAt: moscowInputToDate(publishedAt),
    });
  const errors = state.fieldErrors ?? {};
  const busy = pending || deletePending;

  /**
   * The last known-saved field state. A successful save adopts the current
   * values, so "Отменить" always returns to what is actually on the server
   * rather than to the values this component happened to mount with.
   */
  const [saved, setSaved] = useState<Snapshot>(
    initial
      ? {
          title: initial.title,
          subtitle: initial.subtitle,
          lead: initial.lead,
          contentHtml: initial.contentHtml,
          coverImage: initial.coverImage,
          photoAuthor: initial.photoAuthor,
          photoSource: initial.photoSource,
          categoryId: initial.categoryId,
          status: initial.status,
          publishedAt: initial.publishedAt || defaultPublishedAt,
          isDzen: initial.isDzen,
          isVk: initial.isVk,
          isExclusive: initial.isExclusive,
          is18plus: initial.is18plus,
          seoTitle: initial.seoTitle,
          seoDescription: initial.seoDescription,
          seoCanonicalUrl: initial.seoCanonicalUrl,
          noIndex: initial.noIndex,
          dzenExperiment: initial.dzenExperiment,
          dzenDirect: initial.dzenDirect,
          tags: initial.tags.join(","),
          media: serializeMedia(initial.media),
          videoUrl: initial.videoUrl,
        }
      : null,
  );

  /**
   * The fields as they stand right now, and how far they are from the last
   * save. Derived rather than tracked by a flag: an edit that ends where it
   * started is not a change, and a revert that restores identical values is not
   * one either. Both used to leave the editor looking at unsaved edits that did
   * not exist.
   */
  const current: FormSnapshot = {
    title,
    subtitle,
    lead,
    contentHtml,
    coverImage,
    photoAuthor,
    photoSource,
    categoryId,
    status,
    publishedAt,
    isDzen,
    isVk,
    isExclusive,
    is18plus,
    seoTitle,
    seoDescription,
    seoCanonicalUrl,
    noIndex,
    dzenExperiment,
    dzenDirect,
    // Joined: comparing array identity would report a change on every render.
    tags: tags.join(","),
    media: serializeMedia(media),
    videoUrl,
  };

  /**
   * When the action reports a fresh successful save, the values on screen become
   * the new baseline.
   *
   * Adjusting state during render rather than in an effect: this is React's
   * documented pattern for reacting to a changed value during render, and it
   * avoids the extra render pass (and the stale frame) an effect would cause.
   * `lastHandled` makes sure it runs once per action result.
   */
  const [lastHandled, setLastHandled] = useState<SaveArticleResult>(
    INITIAL_STATE,
  );
  if (state !== lastHandled) {
    setLastHandled(state);
    if (state.ok) {
      setSaved(current);
      // Adopt whatever the server actually stored. If the rule rejected the
      // submitted flag, the checkbox has to snap back — leaving it ticked would
      // tell the editor an experiment is running when no feed markup was emitted.
      if (typeof state.dzenExperiment === "boolean") {
        setDzenExperiment(state.dzenExperiment);
      }
      setDzenExperimentLockedByServer(Boolean(state.dzenExperimentLocked));
    }
  }

  const dirty = saved
    ? (Object.keys(current) as (keyof FormSnapshot)[]).some(
        (key) => current[key] !== saved![key],
      )
    : Boolean(
        title ||
          subtitle ||
          lead ||
          contentHtml ||
          coverImage ||
          photoAuthor ||
          photoSource ||
          media.length > 0 ||
          videoUrl,
      );

  function applySnapshot(snapshot: Snapshot) {
    if (!snapshot) return;

    setTitle(snapshot.title);
    setSubtitle(snapshot.subtitle);
    setLead(snapshot.lead);
    setContentHtml(snapshot.contentHtml);
    setCoverImage(snapshot.coverImage);
    setPhotoAuthor(snapshot.photoAuthor);
    setPhotoSource(snapshot.photoSource);
    setSeoTitle(snapshot.seoTitle);
    setSeoDescription(snapshot.seoDescription);
    setSeoCanonicalUrl(snapshot.seoCanonicalUrl);
    setNoIndex(snapshot.noIndex);
    setDzenExperiment(snapshot.dzenExperiment);
    setDzenDirect(snapshot.dzenDirect);
    // The snapshot is the last *saved* state, so whatever lock applied then
    // applies again. Recomputed from the restored publish date below.
    setDzenExperimentLockedByServer(false);
    setTags(snapshot.tags ? snapshot.tags.split(",").filter(Boolean) : []);
    setMedia(parseMediaField(snapshot.media));
    setVideoUrl(snapshot.videoUrl);
    setCategoryId(snapshot.categoryId);
    setStatus(snapshot.status);
    setPublishedAt(snapshot.publishedAt);
    setIsDzen(snapshot.isDzen);
    setIsVk(snapshot.isVk);
    setIsExclusive(snapshot.isExclusive);
    setIs18plus(snapshot.is18plus);
    setUploadError(null);
    setUploadWarning(null);
    setPreviewOpen(false);
  }

  /** Posts the chosen file to /api/upload and drops the returned URL in. */
  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so re-picking the same file fires change again.
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    setUploadWarning(null);

    // Measured before the upload, not after: Dzen's card needs a wide image, and
    // a warning the editor only sees once the bytes are already on disk is a
    // worse moment to learn it than before they left the machine.
    const dimensions = await readImageDimensions(file);
    const tooNarrow = dimensions.width > 0 && dimensions.width < DZEN_MIN_CARD_WIDTH;

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch("/api/upload", { method: "POST", body });
      const payload = (await response.json()) as {
        url?: string;
        error?: string;
      };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Не удалось загрузить файл.");
      }

      setCoverImage(payload.url);
      // Advisory, never blocking: the editor may be syndicating elsewhere today
      // and widening the photo for Dzen before tomorrow's repost.
      setUploadWarning(
        tooNarrow
          ? NARROW_COVER_WARNING
          : dimensions.width > 0
            ? `Обложка ${dimensions.width}×${dimensions.height}.`
            : null,
      );
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Не удалось загрузить файл.",
      );
    } finally {
      setUploading(false);
    }
  }

  /**
   * Reverts unsaved edits. Never clears the form: a brand new article has no
   * saved version to go back to, and wiping a headline and body on a button the
   * editors had every reason to press is how work gets lost.
   */
  function handleCancel() {
    if (!saved) {
      if (dirty) {
        const ok = window.confirm(
          "Материал ещё не сохранён — отменить все введённые данные?",
        );
        if (!ok) return;
      } else {
        return;
      }
      // A new, never-saved article has nothing to restore, so start clean.
      setTitle("");
      setSubtitle("");
      setLead("");
      setContentHtml("");
      setCoverImage("");
      setPhotoAuthor("");
      setPhotoSource("");
      setSeoTitle("");
      setSeoDescription("");
      setSeoCanonicalUrl("");
      setNoIndex(false);
      setDzenExperiment(false);
      setDzenDirect(false);
      setDzenExperimentLockedByServer(false);
      setTags([]);
      setMedia([]);
      setVideoUrl("");
      setPublishedAt(moscowNow());
      setUploadError(null);
      setUploadWarning(null);
      setPreviewOpen(false);
      return;
    }

    if (dirty && !window.confirm("Вернуться к последней сохранённой версии?")) {
      return;
    }

    applySnapshot(saved);
  }

  function handleDelete() {
    if (!state.id || !window.confirm("Удалить материал без возможности восстановления?")) {
      return;
    }

    const formData = new FormData();
    formData.set("id", state.id);
    formData.set("intent", "apply");

    startDelete(async () => {
      const result = await deleteArticleAction(formData);
      if (result.ok) {
        router.push("/admin/articles");
        return;
      }
      setDeleteMessage(result.message);
    });
  }

  const heading = state.id || initial ? "Редактирование материала" : "Новый материал";

  return (
    // One form wraps the whole editor so the sticky bar's submit buttons carry
    // every field, including the sidebar and the publication date.
    <form action={formAction} className="flex flex-1 flex-col bg-neutral-100">
      {/*
        Once saved, the id makes subsequent submits updates instead of creates.
      */}
      <input type="hidden" name="id" value={state.id ?? initial?.id ?? ""} />

      {/*
        Every state-backed field is submitted through a permanent hidden mirror
        rather than through its visible input.

        The visible inputs live inside tab panels that are unmounted when the tab
        is not active, and an unmounted input is not part of the form. Saving
        from the "Медиа" tab therefore used to send no `contentHtml` at all, and
        the save failed with "Текст материала обязателен" — which is what an
        editor uploading a cover would have hit. A panel cannot simply be hidden
        with CSS instead: `display:none` around a `required` control makes
        submission fail with "not focusable".
      */}
      <input type="hidden" name="publishedAt" value={publishedAt} readOnly />
      <input type="hidden" name="title" value={title} readOnly />
      <input type="hidden" name="subtitle" value={subtitle} readOnly />
      <input type="hidden" name="lead" value={lead} readOnly />
      <input type="hidden" name="contentHtml" value={contentHtml} readOnly />
      <input type="hidden" name="coverImage" value={coverImage} readOnly />
      <input type="hidden" name="photoAuthor" value={photoAuthor} readOnly />
      <input type="hidden" name="photoSource" value={photoSource} readOnly />
      <input type="hidden" name="seoTitle" value={seoTitle} readOnly />
      <input
        type="hidden"
        name="seoDescription"
        value={seoDescription}
        readOnly
      />
      <input
        type="hidden"
        name="seoCanonicalUrl"
        value={seoCanonicalUrl}
        readOnly
      />
      {/* Unchecked checkboxes are absent from FormData, so the flag is mirrored
          as "on" / "" rather than relying on the visible control's presence. */}
      <input type="hidden" name="noIndex" value={noIndex ? "on" : ""} readOnly />
      {/* The Dzen checkboxes live in the sidebar, which is always mounted — but a
          *disabled* input is not submitted at all, so the locked experiment flag
          still needs a mirror for the action to read its stored value. */}
      <input
        type="hidden"
        name="dzenExperiment"
        value={dzenExperiment ? "on" : ""}
        readOnly
      />
      <input
        type="hidden"
        name="dzenDirect"
        value={dzenDirect ? "on" : ""}
        readOnly
      />
      <input type="hidden" name="tags" value={tags.join(",")} readOnly />
      {/* Gallery travels as JSON for the same reason the mirror exists: the
          MediaEditor lives on the "Медиа" tab and unmounts with it. */}
      <input type="hidden" name="media" value={serializeMedia(media)} readOnly />
      <input type="hidden" name="videoUrl" value={videoUrl} readOnly />

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-300 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold text-neutral-900">{heading}</h1>
          <p className="font-mono text-xs text-neutral-500">
            {state.id ?? initial?.id ? `ID: ${state.id ?? initial?.id}` : "ID: не сохранён"}
            {dirty ? " · есть несохранённые изменения" : ""}
          </p>
        </div>

        {state.message || deleteMessage ? (
          <p
            role="status"
            className={cn(
              "flex items-center gap-1.5 text-sm font-medium",
              state.ok ? "text-green-700" : "text-red-600",
            )}
          >
            {state.ok ? <CheckCircle2 className="size-4" aria-hidden /> : null}
            {deleteMessage ?? state.message}
          </p>
        ) : null}
      </header>

      {/* Editorial grid: form ~75%, attribute sidebar ~25%. */}
      <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row">
        <div className="min-w-0 lg:basis-3/4">
          <nav
            aria-label="Разделы материала"
            className="flex gap-1 overflow-x-auto border-b border-neutral-300"
          >
            {TABS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px flex items-center gap-2 rounded-t-sm border border-b-0 px-4 py-2 text-sm font-medium transition-colors",
                    "whitespace-nowrap",
                    active
                      ? "border-neutral-300 bg-white text-neutral-900"
                      : "border-transparent bg-transparent text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="space-y-5 border border-neutral-300 border-t-0 bg-white p-5">
            {tab === "material" ? (
              <>
                <div className="max-w-xs space-y-1.5">
                  <label
                    htmlFor="publishedAt"
                    className="text-sm font-medium text-neutral-700"
                  >
                    Дата и время публикации
                  </label>
                  <input
                    id="publishedAt"
                    type="datetime-local"
                    value={publishedAt}
                    onChange={(event) => {
                      setPublishedAt(event.target.value);
                    }}
                    className="w-full rounded-sm border border-neutral-400 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-600 focus:ring-2 focus:ring-neutral-200"
                  />
                  <p className="text-xs text-neutral-400">
                    Московское время (UTC+3). Сохраняется и для черновика — так
                    материал можно запланировать заранее.
                  </p>
                </div>

                <TitleField
                  value={title}
                  onChange={(value) => {
                    setTitle(value);
                  }}
                  error={errors.title}
                />

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <label
                      htmlFor="subtitle"
                      className="text-sm font-medium text-neutral-700"
                    >
                      Подзаголовок
                    </label>
                    <CharCounter value={subtitle} />
                  </div>
                  <input
                    id="subtitle"
                    type="text"
                    value={subtitle}
                    onChange={(event) => {
                      setSubtitle(event.target.value);
                    }}
                    placeholder="Необязательно"
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                  />
                  {errors.subtitle ? (
                    <p className="text-sm text-red-600">{errors.subtitle}</p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <label
                      htmlFor="lead"
                      className="text-sm font-medium text-neutral-700"
                    >
                      Внутренний анонс (Лид)
                    </label>
                    <CharCounter value={lead} limit={LEAD_LIMIT} />
                  </div>
                  <textarea
                    id="lead"
                    value={lead}
                    onChange={(event) => {
                      setLead(event.target.value);
                    }}
                    rows={3}
                    placeholder="Краткое описание материала для анонсов"
                    className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                  />
                </div>

                <ContentEditor
                  value={contentHtml}
                  onChange={(value) => {
                    setContentHtml(value);
                  }}
                  error={errors.contentHtml}
                />

                <ArticlePreview
                  html={contentHtml}
                  open={previewOpen}
                  onToggle={() => setPreviewOpen((open) => !open)}
                />
              </>
            ) : null}

            {tab === "media" ? (
              <section className="space-y-5">
                <div className="space-y-1.5">
                  <label
                    htmlFor="coverImage"
                    className="text-sm font-medium text-neutral-700"
                  >
                    Обложка
                  </label>
                  <input
                    id="coverImage"
                    type="text"
                    value={coverImage}
                    onChange={(event) => {
                      setCoverImage(event.target.value);
                      // A pasted URL replaces whatever file was uploaded, so the
                      // old file's measurement no longer describes this cover.
                      setUploadWarning(null);
                    }}
                    placeholder="Загрузите файл или укажите ссылку"
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
                  >
                    <Upload className="size-4" aria-hidden />
                    {uploading ? "Загружаем…" : "Загрузить обложку"}
                  </button>
                  <span className="text-xs text-neutral-400">
                    JPG, PNG или WebP, до 8 МБ
                  </span>
                </div>

                {/*
                  The generator writes to the same UPLOAD_DIR as the file input
                  and hands back a URL, so adopting its result is just
                  setCoverImage — no second code path for storing a cover.
                */}
                <BalanceStrip className="mb-2" />

                <AiCoverGenerator
                  title={title}
                  lead={lead}
                  content={contentHtml}
                  onGenerated={(url) => {
                    setCoverImage(url);
                    // 1024 px wide by construction, so the narrow-cover warning
                    // from a manual upload does not apply here.
                    setUploadWarning(null);
                    setUploadError(null);

                    // Credit the picture to the model, but only into an empty field.
                    // A credit already there is a real attribution — a press-service
                    // photo the editor reused, say — and overwriting it would put a
                    // false credit in print.
                    setPhotoSource((current) => current.trim() || AI_GENERATED_SOURCE);
                  }}
                />

                {uploadError ? (
                  <p role="alert" className="text-sm text-red-600">
                    {uploadError}
                  </p>
                ) : null}

                {/* role="status", not "alert": the cover uploaded fine and the
                    piece is publishable, so this is information rather than a
                    problem to interrupt on. */}
                {uploadWarning ? (
                  <p
                    role="status"
                    className={cn(
                      "text-xs",
                      uploadWarning === NARROW_COVER_WARNING
                        ? "text-amber-700"
                        : "text-neutral-400",
                    )}
                  >
                    {uploadWarning}
                  </p>
                ) : null}

                {coverImage ? (
                  <div className="space-y-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={coverImage}
                      alt="Предпросмотр обложки"
                      onError={() =>
                        setUploadError(
                          "Обложка не загрузилась по этой ссылке. Проверьте путь или загрузите файл заново.",
                        )
                      }
                      className="max-h-72 rounded-md border border-neutral-200 bg-neutral-50 object-contain"
                    />
                    <p className="text-xs text-neutral-400">
                      Обложка будет опубликована в этом поле при сохранении.
                    </p>
                  </div>
                ) : null}

                <hr className="border-neutral-200" />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="photoAuthor"
                      className="text-sm font-medium text-neutral-700"
                    >
                      Автор фото
                    </label>
                    <input
                      id="photoAuthor"
                      type="text"
                      value={photoAuthor}
                      onChange={(event) => {
                        setPhotoAuthor(event.target.value);
                      }}
                      placeholder="Имя автора или фотобанка"
                      className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="photoSource"
                      className="text-sm font-medium text-neutral-700"
                    >
                      Источник фото
                    </label>
                    <input
                      id="photoSource"
                      type="text"
                      list="photoSourceOptions"
                      value={photoSource}
                      onChange={(event) => {
                        setPhotoSource(event.target.value);
                      }}
                      placeholder="Например: Екатеринбург, улица Малышева"
                      className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                    />
                    {/*
                      A datalist rather than a select, on purpose. The credits in use
                      are suggestions, not a closed vocabulary — an editor routinely
                      has a source nobody has used yet, and a select would either
                      refuse it or need an "other" option that is worse than a text
                      field. This keeps one click for the common sources, prefix
                      matching from the keyboard, and free text for everything else.
                    */}
                    <datalist id="photoSourceOptions">
                      {photoSourceOptions.map((option) => (
                        <option key={option} value={option} />
                      ))}
                    </datalist>
                    {photoSourceOptions.length > 0 ? (
                      <p className="text-xs text-neutral-400">
                        {photoSourceOptions.length} источников в подсказках. Свой вариант
                        можно вписать — он попадёт в подсказки со следующей статьёй.
                      </p>
                    ) : null}
                  </div>
                </div>

                <p className="text-xs text-neutral-400">
                  Подпись печатается под обложкой на сайте курсивом.
                </p>

                <hr className="border-neutral-200" />

                <div className="space-y-1.5">
                  <label htmlFor="videoUrl" className="text-sm font-medium text-neutral-700">
                    Ссылка на видео (VK / Rutube / YouTube)
                  </label>
                  <input
                    id="videoUrl"
                    type="text"
                    value={videoUrl}
                    onChange={(event) => {
                      setVideoUrl(event.target.value);
                    }}
                    placeholder="https://youtu.be/… или https://vkvideo.ru/video…"
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                  />
                  <p className="text-xs text-neutral-400">
                    На сайте вставится адаптивный плеер, в RSS-ленте — обычная
                    ссылка: Дзен сам превращает ссылки на VK Видео, YouTube и
                    Рутюб в видеовиджет.
                  </p>

                  {/*
                    The drop zone writes straight into the same field a pasted
                    link would occupy, so nothing needs translating afterwards and
                    "Отменить" reverts the upload along with everything else.
                  */}
                  <VkVideoDrop
                    onUploaded={(url) => {
                      setVideoUrl(url);
                      setUploadWarning(null);
                    }}
                  />
                </div>

                <hr className="border-neutral-200" />

                <MediaEditor items={media} onChange={setMedia} />
              </section>
            ) : null}

            {tab === "tags" ? (
              <TagInput value={tags} onChange={setTags} />
            ) : null}

            {tab === "seo" ? (
              <section className="space-y-4">
                <p className="text-xs text-neutral-400">
                  Все поля необязательные: пустое значение означает «взять из
                  материала». Обычно автоматических заголовка и описания
                  достаточно — заполняйте, только если они получаются неудачными.
                </p>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <label
                      htmlFor="seoTitle"
                      className="text-sm font-medium text-neutral-700"
                    >
                      SEO-заголовок
                    </label>
                    <CharCounter value={seoTitle} limit={SEO_TITLE_SOFT_LIMIT} />
                  </div>
                  <input
                    id="seoTitle"
                    type="text"
                    value={seoTitle}
                    onChange={(event) => setSeoTitle(event.target.value)}
                    placeholder={title || "Заголовок статьи"}
                    maxLength={SEO_TITLE_MAX_LENGTH}
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <label
                      htmlFor="seoDescription"
                      className="text-sm font-medium text-neutral-700"
                    >
                      SEO-описание
                    </label>
                    <CharCounter
                      value={seoDescription}
                      limit={SEO_DESCRIPTION_SOFT_LIMIT}
                    />
                  </div>
                  <textarea
                    id="seoDescription"
                    value={seoDescription}
                    onChange={(event) => setSeoDescription(event.target.value)}
                    rows={3}
                    placeholder={lead || "Лид или первые 160 символов текста"}
                    maxLength={SEO_DESCRIPTION_MAX_LENGTH}
                    className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="seoCanonicalUrl"
                    className="text-sm font-medium text-neutral-700"
                  >
                    Канонический URL
                  </label>
                  <input
                    id="seoCanonicalUrl"
                    type="url"
                    value={seoCanonicalUrl}
                    onChange={(event) => setSeoCanonicalUrl(event.target.value)}
                    placeholder="https://example.com/original"
                    className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                  />
                  <p className="text-xs text-neutral-400">
                    Для перепечаток: указывает поисковику оригинал, с которого
                    взята новость. Пусто — канонический адрес самой статьи.
                  </p>
                </div>

                <label
                  htmlFor="noIndex"
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-neutral-300 bg-neutral-50 p-3"
                >
                  <input
                    id="noIndex"
                    type="checkbox"
                    checked={noIndex}
                    onChange={(event) => setNoIndex(event.target.checked)}
                    className="mt-0.5 size-4 shrink-0 rounded-sm border-neutral-400 accent-red-700"
                  />
                  <span className="text-sm text-neutral-700">
                    <span className="font-medium">Не индексировать</span>
                    <span className="block text-xs text-neutral-500">
                      robots: noindex, nofollow. Для служебных и правовых
                      материалов, которые не должны попадать в выдачу.
                    </span>
                  </span>
                </label>
              </section>
            ) : null}
          </div>
        </div>

        <div className="lg:basis-1/4">
          <PublishSidebar
            categories={categories}
            categoryId={categoryId}
            onCategoryChange={(value) => {
              setCategoryId(value);
            }}
            status={status}
            onStatusChange={(value) => {
              setStatus(value);
            }}
            isDzen={isDzen}
            onIsDzenChange={(value) => {
              setIsDzen(value);
            }}
            isVk={isVk}
            onIsVkChange={(value) => {
              setIsVk(value);
            }}
            isExclusive={isExclusive}
            onIsExclusiveChange={(value) => {
              setIsExclusive(value);
            }}
            is18plus={is18plus}
            onIs18plusChange={(value) => {
              setIs18plus(value);
            }}
            dzenExperiment={dzenExperiment}
            onDzenExperimentChange={(value) => {
              setDzenExperiment(value);
            }}
            dzenDirect={dzenDirect}
            onDzenDirectChange={(value) => {
              setDzenDirect(value);
            }}
            dzenExperimentLocked={dzenExperimentLocked}
            categoryError={errors.categoryId}
          />
        </div>
      </div>

      <div className="sticky bottom-0">
        <StickyActionBar
          pending={busy}
          canDelete={Boolean(state.id ?? initial?.id)}
          showPublish={status === "draft"}
          dirty={dirty}
          onCancel={handleCancel}
          onDelete={handleDelete}
        />
      </div>
    </form>
  );
}