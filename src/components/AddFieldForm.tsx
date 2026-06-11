"use client";

// =============================================================================
// AddFieldForm.tsx
// Inline form to add a custom TemplateField that wasn't in the suggestions.
// Validates document_type rules client-side before calling onAdd.
// =============================================================================

import { useState } from "react";
import type { TemplateField, FieldType } from "@/lib/types";
import { FIELD_TYPES } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY: Omit<TemplateField, "type"> & { type: FieldType } = {
  key: "",
  label: "",
  type: "text",
  category: null,
};

// ---------------------------------------------------------------------------
// Validation (mirrors server rules from FRONTEND_INTEGRATION.md §4)
// ---------------------------------------------------------------------------

function validateKey(key: string): string | null {
  if (!key.trim()) return "Key is required.";
  if (!/^[a-z0-9_]{1,60}$/.test(key))
    return "Lowercase letters, digits, and underscores only (max 60 characters).";
  return null;
}

function validateLabel(label: string): string | null {
  if (!label.trim()) return "Label is required.";
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AddFieldFormProps {
  /** Keys already in use — prevents duplicates before hitting the server. */
  existingKeys: string[];
  onAdd: (field: TemplateField) => void;
}

export function AddFieldForm({ existingKeys, onAdd }: AddFieldFormProps) {
  const [draft, setDraft] = useState({ ...EMPTY });
  const [errors, setErrors] = useState<
    Partial<Record<"key" | "label", string>>
  >({});
  const [open, setOpen] = useState(false);

  function set<K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) {
    setDraft((prev) => ({ ...prev, [k]: v }));
    // Clear error on change
    if (k === "key" || k === "label") {
      setErrors((prev) => ({ ...prev, [k]: undefined }));
    }
  }

  function handleAdd() {
    const keyErr = validateKey(draft.key);
    const labelErr = validateLabel(draft.label);
    const dupErr =
      !keyErr && existingKeys.includes(draft.key)
        ? `Key "${draft.key}" is already in use.`
        : null;

    const nextErrors = {
      key: keyErr ?? dupErr ?? undefined,
      label: labelErr ?? undefined,
    };

    if (nextErrors.key || nextErrors.label) {
      setErrors(nextErrors);
      return;
    }

    onAdd({
      key: draft.key.trim(),
      label: draft.label.trim(),
      type: draft.type,
      category: draft.category?.trim() || null,
    });

    // Reset
    setDraft({ ...EMPTY });
    setErrors({});
    setOpen(false);
  }

  function handleCancel() {
    setDraft({ ...EMPTY });
    setErrors({});
    setOpen(false);
  }

  // Collapsed state — just a trigger button
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          "flex w-full items-center justify-center gap-2 rounded-lg border-2",
          "border-dashed border-slate-200 py-3 text-sm text-slate-400",
          "hover:border-indigo-300 hover:text-indigo-500 transition-colors",
        ].join(" ")}
      >
        <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden>
          <path
            d="M8 3v10M3 8h10"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        Add manual field
      </button>
    );
  }

  // Expanded form
  return (
    <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
      <p className="text-sm font-medium text-slate-700">New field</p>

      <div className="grid grid-cols-2 gap-3">
        {/* Key */}
        <div className="space-y-1">
          <label
            className="text-xs font-medium text-slate-600"
            htmlFor="new-key"
          >
            Key <span className="text-slate-400 font-normal">(snake_case)</span>
          </label>
          <input
            id="new-key"
            value={draft.key}
            onChange={(e) => set("key", e.target.value)}
            placeholder="e.g. date_of_birth"
            className={[
              "w-full rounded-md border px-3 py-1.5 text-sm font-mono",
              "focus:outline-none focus:ring-2 focus:ring-indigo-500",
              errors.key
                ? "border-red-300 bg-red-50"
                : "border-slate-200 bg-white",
            ].join(" ")}
          />
          {errors.key && <p className="text-xs text-red-500">{errors.key}</p>}
        </div>

        {/* Label */}
        <div className="space-y-1">
          <label
            className="text-xs font-medium text-slate-600"
            htmlFor="new-label"
          >
            Label
          </label>
          <input
            id="new-label"
            value={draft.label}
            onChange={(e) => set("label", e.target.value)}
            placeholder="e.g. Date of birth"
            className={[
              "w-full rounded-md border px-3 py-1.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-indigo-500",
              errors.label
                ? "border-red-300 bg-red-50"
                : "border-slate-200 bg-white",
            ].join(" ")}
          />
          {errors.label && (
            <p className="text-xs text-red-500">{errors.label}</p>
          )}
        </div>

        {/* Type */}
        <div className="space-y-1">
          <label
            className="text-xs font-medium text-slate-600"
            htmlFor="new-type"
          >
            Type
          </label>
          <select
            id="new-type"
            value={draft.type}
            onChange={(e) => set("type", e.target.value as FieldType)}
            className={[
              "w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-indigo-500",
            ].join(" ")}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        {/* Category (optional) */}
        <div className="space-y-1">
          <label
            className="text-xs font-medium text-slate-600"
            htmlFor="new-category"
          >
            Category{" "}
            <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            id="new-category"
            value={draft.category ?? ""}
            onChange={(e) => set("category", e.target.value || null)}
            placeholder="ej. personal, document"
            className={[
              "w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm",
              "focus:outline-none focus:ring-2 focus:ring-indigo-500",
            ].join(" ")}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          className={[
            "rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white",
            "hover:bg-indigo-700 transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1",
          ].join(" ")}
        >
          Add
        </button>
      </div>
    </div>
  );
}
