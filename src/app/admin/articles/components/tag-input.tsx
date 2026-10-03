"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MAX_TAGS_PER_ARTICLE, normalizeTagName, tagKey } from "@/lib/tags";
import { cn } from "@/lib/utils";

type Suggestion = { id: number; name: string; slug: string };

type TagInputProps = {
  /** The tags currently on the article, as typed by the editor. */
  value: string[];
  onChange: (value: string[]) => void;
};

/**
 * Chips input with server-backed autocomplete.
 *
 * Suggestions come from /api/admin/tags/suggest, which sits behind the same
 * Basic Auth as the rest of the CMS. A name that is not in the table is simply
 * created on save, so the field never blocks the editor on a typo — but a
 * duplicate is refused, which is the case the editor cannot see by eye.
 */
export function TagInput({ value, onChange }: TagInputProps) {
  const [draft, setDraft] = useState("");
  const [remote, setRemote] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = draft.trim();

  /**
   * Empty query means "no suggestions" without waiting for an effect: derived
   * during render rather than pushed into state, which would show the previous
   * tag's matches for one frame after the field is cleared.
   */
  const suggestions = query.length === 0 ? [] : remote;

  // Suggestions that are already chips are dropped here rather than in the
  // effect, so the filter follows the value list without a round trip.
  const taken = new Set(value.map(tagKey));
  const shown = suggestions.filter((tag) => !taken.has(tagKey(tag.name)));

  // Abort in flight: typing "нейросети" fires five queries and only the last
  // answer should be shown.
  useEffect(() => {
    if (query.length === 0) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/admin/tags/suggest?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const payload = (await response.json()) as { tags?: Suggestion[] };
        setRemote(payload.tags ?? []);
      } catch {
        // An aborted or failed lookup is not worth interrupting typing for.
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  function add(rawName: string) {
    const name = normalizeTagName(rawName);
    if (!name || value.length >= MAX_TAGS_PER_ARTICLE) return;

    // Same letters already present, whatever the casing: tell the editor instead
    // of silently adding a chip that will be rejected on save.
    if (value.some((existing) => tagKey(existing) === tagKey(name))) {
      setDraft("");
      return;
    }

    onChange([...value, name]);
    setDraft("");
    setRemote([]);
    setHighlight(0);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !draft && value.length > 0) {
      remove(value.length - 1);
      return;
    }

    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      const picked = shown[highlight];
      add(picked ? picked.name : draft);
      return;
    }

    if (event.key === "ArrowDown" && shown.length > 0) {
      event.preventDefault();
      setHighlight((index) => (index + 1) % shown.length);
      return;
    }

    if (event.key === "ArrowUp" && shown.length > 0) {
      event.preventDefault();
      setHighlight((index) => (index - 1 + shown.length) % shown.length);
    }
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor="tags-field" className="text-sm font-medium text-neutral-700">
        Тэги
      </label>

      <div
        className="flex flex-wrap items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-2 py-2 focus-within:border-neutral-500 focus-within:ring-2 focus-within:ring-neutral-200"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag, index) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-neutral-200 py-0.5 pr-1 pl-2.5 text-xs font-medium text-neutral-800"
          >
            {tag}
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label={`Убрать тэг ${tag}`}
              className="rounded-full p-0.5 text-neutral-500 transition-colors hover:bg-neutral-300 hover:text-neutral-900"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          id="tags-field"
          type="text"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // A half-typed tag is still a tag; a bare comma is not.
            if (draft.trim()) add(draft);
          }}
          disabled={value.length >= MAX_TAGS_PER_ARTICLE}
          placeholder={
            value.length >= MAX_TAGS_PER_ARTICLE
              ? `Максимум ${MAX_TAGS_PER_ARTICLE} тэгов`
              : "Через запятую или Enter"
          }
          aria-describedby="tags-help"
          className="min-w-40 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-neutral-400 disabled:cursor-not-allowed"
        />
      </div>

      {shown.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Подсказки по тэгам"
          className="rounded-md border border-neutral-300 bg-white py-1 shadow-sm"
        >
          {shown.map((tag, index) => (
            <li key={tag.id} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                // onMouseDown so the click lands before the input's blur clears
                // the suggestion list.
                onMouseDown={(event) => {
                  event.preventDefault();
                  add(tag.name);
                }}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  "block w-full px-3 py-1.5 text-left text-sm",
                  index === highlight
                    ? "bg-neutral-100 text-neutral-900"
                    : "text-neutral-700",
                )}
              >
                {tag.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <p id="tags-help" className="text-xs text-neutral-400">
        Enter или запятая добавляет тэг. Неизвестное название создастся при
        сохранении; отличающееся только регистром — нет.
      </p>
    </div>
  );
}