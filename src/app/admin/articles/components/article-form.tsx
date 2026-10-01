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
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  createArticleAction,
  deleteArticleAction,
} from "@/app/admin/articles/actions";
import { CharCounter } from "@/app/admin/articles/components/char-counter";
import { ContentEditor } from "@/app/admin/articles/components/content-editor";
import { PublishSidebar } from "@/app/admin/articles/components/publish-sidebar";
import { StickyActionBar } from "@/app/admin/articles/components/sticky-action-bar";
import { TitleField } from "@/app/admin/articles/components/title-field";
import type { CategoryOption, SaveArticleResult } from "@/app/admin/articles/types";
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

/** `datetime-local` needs "YYYY-MM-DDTHH:mm" in local time, not an ISO string. */
function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

type ArticleFormProps = {
  categories: CategoryOption[];
};

export function ArticleForm({ categories }: ArticleFormProps) {
  const [state, formAction, pending] = useActionState(
    // useActionState passes the previous state first; the action reads FormData.
    async (_prevState: SaveArticleResult, formData: FormData) =>
      createArticleAction(formData),
    INITIAL_STATE,
  );

  const router = useRouter();
  const [deletePending, startDelete] = useTransition();
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  // Created once per mount: the field defaults to "now" as the editorial spec
  // requires, not to the time of every re-render.
  const defaultPublishedAt = useMemo(() => toLocalInputValue(new Date()), []);

  const [tab, setTab] = useState<TabId>("material");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [lead, setLead] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState<ArticleStatus>("draft");
  const [isDzen, setIsDzen] = useState(true);
  const [isVk, setIsVk] = useState(true);
  const [isExclusive, setIsExclusive] = useState(false);
  const [is18plus, setIs18plus] = useState(false);
  // Tags and SEO fields have no columns in the schema yet; kept local-only.
  const [tags, setTags] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const [seoDescription, setSeoDescription] = useState("");

  const errors = state.fieldErrors ?? {};
  const busy = pending || deletePending;

  /** Posts the chosen file to /api/upload and drops the returned URL in. */
  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset immediately so re-picking the same file fires change again.
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setUploadError(null);

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
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Не удалось загрузить файл.",
      );
    } finally {
      setUploading(false);
    }
  }

  function resetForm() {
    setTitle("");
    setSubtitle("");
    setLead("");
    setContentHtml("");
    setCoverImage("");
    setCategoryId("");
    setStatus("draft");
    setIsDzen(true);
    setIsVk(true);
    setIsExclusive(false);
    setIs18plus(false);
    setTags("");
    setSeoTitle("");
    setSeoDescription("");
    setUploadError(null);
    setTab("material");
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
        resetForm();
        router.push("/admin/articles");
        return;
      }
      setDeleteMessage(result.message);
    });
  }

  return (
    // One form wraps the whole editor so the sticky bar's submit buttons carry
    // every field, including the sidebar and the publication date.
    <form action={formAction} className="flex min-h-dvh flex-col bg-neutral-100">
      {/* Once saved, the id makes subsequent submits updates instead of creates. */}
      <input type="hidden" name="id" value={state.id ?? ""} />

      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-300 bg-white px-6 py-3">
        <div>
          <h1 className="text-base font-semibold text-neutral-900">
            Новый материал
          </h1>
          <p className="font-mono text-xs text-neutral-500">
            {state.id ? `ID: ${state.id}` : "ID: не сохранён"}
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
                    name="publishedAt"
                    type="datetime-local"
                    defaultValue={defaultPublishedAt}
                    className="w-full rounded-sm border border-neutral-400 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-600 focus:ring-2 focus:ring-neutral-200"
                  />
                  <p className="text-xs text-neutral-400">
                    Для черновика дата сохраняется, но публикация не происходит.
                  </p>
                </div>

                <TitleField
                  value={title}
                  onChange={setTitle}
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
                    name="subtitle"
                    type="text"
                    value={subtitle}
                    onChange={(event) => setSubtitle(event.target.value)}
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
                    name="lead"
                    value={lead}
                    onChange={(event) => setLead(event.target.value)}
                    rows={3}
                    placeholder="Краткое описание материала для анонсов"
                    className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500 focus:ring-2 focus:ring-neutral-200"
                  />
                </div>

                <ContentEditor
                  value={contentHtml}
                  onChange={setContentHtml}
                  error={errors.contentHtml}
                />
              </>
            ) : null}

            {tab === "media" ? (
              <section className="space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="coverImage"
                    className="text-sm font-medium text-neutral-700"
                  >
                    Обложка
                  </label>
                  <input
                    id="coverImage"
                    name="coverImage"
                    type="text"
                    value={coverImage}
                    onChange={(event) => setCoverImage(event.target.value)}
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

                {uploadError ? (
                  <p role="alert" className="text-sm text-red-600">
                    {uploadError}
                  </p>
                ) : null}

                {coverImage ? (
                  <div className="space-y-1.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={coverImage}
                      alt="Предпросмотр обложки"
                      className="max-h-72 rounded-md border border-neutral-200 bg-neutral-50 object-contain"
                    />
                    <p className="text-xs text-neutral-400">
                      Обложка будет опубликована в этом поле при сохранении.
                    </p>
                  </div>
                ) : null}
              </section>
            ) : null}

            {tab === "tags" ? (
              <section className="space-y-1.5">
                <label
                  htmlFor="tags"
                  className="text-sm font-medium text-neutral-700"
                >
                  Тэги
                </label>
                <input
                  id="tags"
                  type="text"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="Через запятую"
                  disabled
                  className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400 outline-none"
                />
                <p className="text-xs text-neutral-400">
                  В модели Article нет поля для тэгов. Инпут заблокирован до
                  добавления колонки в схему.
                </p>
              </section>
            ) : null}

            {tab === "seo" ? (
              <section className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="seoTitle"
                    className="text-sm font-medium text-neutral-700"
                  >
                    SEO-заголовок
                  </label>
                  <input
                    id="seoTitle"
                    type="text"
                    value={seoTitle}
                    onChange={(event) => setSeoTitle(event.target.value)}
                    disabled
                    className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="seoDescription"
                    className="text-sm font-medium text-neutral-700"
                  >
                    SEO-описание
                  </label>
                  <textarea
                    id="seoDescription"
                    value={seoDescription}
                    onChange={(event) => setSeoDescription(event.target.value)}
                    rows={3}
                    disabled
                    className="w-full resize-y rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-400 outline-none"
                  />
                </div>
                <p className="text-xs text-neutral-400">
                  Отдельных SEO-полей в модели Article нет. Здесь будут title и
                  description из метаданных страницы.
                </p>
              </section>
            ) : null}
          </div>
        </div>

        <div className="lg:basis-1/4">
          <PublishSidebar
            categories={categories}
            categoryId={categoryId}
            onCategoryChange={setCategoryId}
            status={status}
            onStatusChange={setStatus}
            isDzen={isDzen}
            onIsDzenChange={setIsDzen}
            isVk={isVk}
            onIsVkChange={setIsVk}
            isExclusive={isExclusive}
            onIsExclusiveChange={setIsExclusive}
            is18plus={is18plus}
            onIs18plusChange={setIs18plus}
            categoryError={errors.categoryId}
          />
        </div>
      </div>

      <div className="sticky bottom-0">
        <StickyActionBar
          pending={busy}
          canDelete={Boolean(state.id)}
          onCancel={resetForm}
          onDelete={handleDelete}
        />
      </div>
    </form>
  );
}
