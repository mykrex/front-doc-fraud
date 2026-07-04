"use client";

// =============================================================================
// DotsFieldMapper.tsx
//
// Interactive component for the "dots" template generation mode.
// Shows the reference document image with clickable overlays for each OCR
// element detected by DotsOCR. The user pairs a label element with a value
// element to create a template field.
//
// Pairing state machine:
//   idle → click element → label_pending → click element → value_pending
//   value_pending + valid key → "Add" → field saved, back to idle
// =============================================================================

import { useState, useMemo, useEffect } from "react";
import type { OCRElement, TemplateField, FieldType, FieldSuggestion } from "@/lib/types";
import { FIELD_TYPES } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SelectionState =
  | { phase: "idle" }
  | { phase: "label_pending"; labelElem: OCRElement }
  | { phase: "value_pending"; labelElem: OCRElement; valueElem: OCRElement };

interface PairForm {
  key: string;
  label: string; // pre-filled from labelElem.text, editable
  type: FieldType;
  category: string;
}

const KEY_RE = /^[a-z0-9_]{1,60}$/;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DotsFieldMapperProps {
  imageFile: File;
  ocrElements: OCRElement[];
  suggestions?: FieldSuggestion[];
  onFieldsChange: (fields: TemplateField[]) => void;
  onAnchorsChange?: (anchors: string[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elementStatus(
  elem: OCRElement,
  selection: SelectionState,
  usedIds: Set<number>,
): "used" | "selected_label" | "selected_value" | "available" {
  if (usedIds.has(elem.id)) return "used";
  if (selection.phase === "label_pending" && selection.labelElem.id === elem.id)
    return "selected_label";
  if (selection.phase === "value_pending") {
    if (selection.labelElem.id === elem.id) return "selected_label";
    if (selection.valueElem.id === elem.id) return "selected_value";
  }
  return "available";
}

const overlayStyles: Record<ReturnType<typeof elementStatus>, string> = {
  available:
    "border-2 border-blue-400/60 bg-blue-100/10 hover:border-blue-500 hover:bg-blue-200/20 cursor-pointer",
  selected_label:
    "border-2 border-blue-600 bg-blue-400/30 cursor-pointer ring-1 ring-blue-600",
  selected_value:
    "border-2 border-emerald-600 bg-emerald-400/30 cursor-pointer ring-1 ring-emerald-600",
  used: "border border-slate-300/40 bg-slate-100/10 cursor-default opacity-40",
};

const MAPPED_LABEL_COLOR = { border: "#4A90D9", bg: "rgba(74,144,217,0.18)" };
const MAPPED_VALUE_COLOR = { border: "#5CB85C", bg: "rgba(92,184,92,0.18)" };
function getAnchorStyle(isAnchor: boolean): string {
  return isAnchor
    ? "border-2 border-amber-500 bg-amber-200/30 cursor-pointer ring-1 ring-amber-500"
    : "border-2 border-amber-300/50 bg-amber-50/10 hover:border-amber-400 hover:bg-amber-100/20 cursor-pointer";
}

// Returns the correct overlay class, using the element's role for initial color
// when the element is available (not selected or used).
function getElementStyle(
  elem: OCRElement,
  status: ReturnType<typeof elementStatus>,
): string {
  if (status !== "available") return overlayStyles[status];
  switch (elem.role) {
    case "label":
      return "border-2 border-blue-400/60 bg-blue-100/10 hover:border-blue-500 hover:bg-blue-200/20 cursor-pointer";
    case "value":
      return "border-2 border-emerald-400/60 bg-emerald-100/10 hover:border-emerald-500 hover:bg-emerald-200/20 cursor-pointer";
    default:
      return "border-2 border-slate-400/60 bg-slate-100/10 hover:border-slate-500 hover:bg-slate-200/20 cursor-pointer";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DotsFieldMapper({
  imageFile,
  ocrElements,
  suggestions,
  onFieldsChange,
  onAnchorsChange,
}: DotsFieldMapperProps) {
  const imageUrl = useMemo(() => URL.createObjectURL(imageFile), [imageFile]);

  type InteractionMode = "field_mapping" | "anchor_marking";
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("field_mapping");
  const [anchorIds, setAnchorIds] = useState<Set<number>>(new Set());

  const [selection, setSelection] = useState<SelectionState>({ phase: "idle" });
  const [fields, setFields] = useState<TemplateField[]>(() => {
    if (!suggestions?.length) return [];
    const map = new Map(ocrElements.map(e => [e.id, e]));
    const result: TemplateField[] = [];
    const seenKeys = new Set<string>();
    for (const s of suggestions) {
      // llm_pairer is semantically equivalent to MRZ confidence (guide §auto mode).
      // Auto-accept high-confidence AND llm_pairer; medium/low go to the pending panel.
      const isHighConfidence = s.confidence === "high" || s.source === "llm_pairer";
      if (!isHighConfidence) continue;
      if (s.label_element_id == null || !s.value_element_ids.length) continue;
      if (seenKeys.has(s.key)) continue;
      const labelElem = map.get(s.label_element_id);
      const valueElem = map.get(s.value_element_ids[0]);
      if (!labelElem || !valueElem) continue;
      seenKeys.add(s.key);
      result.push({
        key: s.key,
        label: s.label,
        type: (s.type as FieldType) || "text",
        category: null,
        label_element_ids: [labelElem.id],
        value_element_ids: [valueElem.id],
      });
    }
    return result;
  });
  const [form, setForm] = useState<PairForm>({
    key: "",
    label: "",
    type: "text",
    category: "",
  });
  const [formErrors, setFormErrors] = useState<{ key?: string }>({});

  // Notify parent on mount when fields were pre-populated from suggestions
  useEffect(() => {
    if (fields.length > 0) onFieldsChange(fields);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const elemById = useMemo(() => new Map(ocrElements.map(e => [e.id, e])), [ocrElements]);

  const usedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const f of fields) {
      f.label_element_ids?.forEach((id) => ids.add(id));
      f.value_element_ids?.forEach((id) => ids.add(id));
    }
    return ids;
  }, [fields]);

  const existingKeys = useMemo(() => fields.map((f) => f.key), [fields]);

  // Suggestions that weren't auto-accepted (medium/low confidence) and can still be added.
  const pendingSuggestions = useMemo(() => {
    if (!suggestions?.length) return [];
    return suggestions.filter(s => {
      if (s.confidence === "high" || s.source === "llm_pairer") return false;
      if (s.label_element_id == null || !s.value_element_ids.length) return false;
      if (!elemById.has(s.label_element_id) || !elemById.has(s.value_element_ids[0])) return false;
      if (existingKeys.includes(s.key)) return false;
      return true;
    });
  }, [suggestions, elemById, existingKeys]);

  const fieldElementMap = useMemo(() => {
    const map = new Map<number, { fieldKey: string }>();
    fields.forEach((f) => {
      f.label_element_ids?.forEach((id) => map.set(id, { fieldKey: f.key }));
      f.value_element_ids?.forEach((id) => map.set(id, { fieldKey: f.key }));
    });
    return map;
  }, [fields]);

  const anchorTexts = useMemo(
    () =>
      Array.from(anchorIds)
        .map((id) => elemById.get(id)?.text)
        .filter((t): t is string => t !== undefined),
    [anchorIds, elemById],
  );

  // Notify parent when anchor selection changes
  useEffect(() => {
    onAnchorsChange?.(anchorTexts);
  }, [anchorTexts]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Overlay click handlers
  // -------------------------------------------------------------------------

  function handleAnchorClick(elem: OCRElement) {
    setAnchorIds((prev) => {
      const next = new Set(prev);
      next.has(elem.id) ? next.delete(elem.id) : next.add(elem.id);
      return next;
    });
  }

  function handleElementClick(elem: OCRElement) {
    if (usedIds.has(elem.id)) return;

    if (selection.phase === "idle") {
      setSelection({ phase: "label_pending", labelElem: elem });
      setForm((prev) => ({ ...prev, label: elem.text }));
      return;
    }

    if (selection.phase === "label_pending") {
      // Clicking the same element deselects
      if (selection.labelElem.id === elem.id) {
        setSelection({ phase: "idle" });
        setForm((prev) => ({ ...prev, label: "" }));
        return;
      }
      setSelection({
        phase: "value_pending",
        labelElem: selection.labelElem,
        valueElem: elem,
      });
      return;
    }

    if (selection.phase === "value_pending") {
      // Clicking the label element again deselects only the label
      if (selection.labelElem.id === elem.id) {
        setSelection({ phase: "idle" });
        setForm((prev) => ({ ...prev, label: "" }));
        return;
      }
      // Clicking the value element deselects only the value
      if (selection.valueElem.id === elem.id) {
        setSelection({
          phase: "label_pending",
          labelElem: selection.labelElem,
        });
        return;
      }
      // Clicking a new element replaces the value
      setSelection({
        phase: "value_pending",
        labelElem: selection.labelElem,
        valueElem: elem,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Add field
  // -------------------------------------------------------------------------

  function handleAddField() {
    if (selection.phase !== "value_pending") return;

    const errors: { key?: string } = {};
    if (!KEY_RE.test(form.key)) {
      errors.key =
        form.key.trim() === ""
          ? "Key is required."
          : "Lowercase letters, digits, and underscores only (max 60 chars).";
    } else if (existingKeys.includes(form.key)) {
      errors.key = `Key "${form.key}" is already in use.`;
    }

    if (errors.key) {
      setFormErrors(errors);
      return;
    }

    const newField: TemplateField = {
      key: form.key.trim(),
      label: form.label.trim() || selection.labelElem.text,
      type: form.type,
      category: form.category.trim() || null,
      label_element_ids: [selection.labelElem.id],
      value_element_ids: [selection.valueElem.id],
    };

    const nextFields = [...fields, newField];
    setFields(nextFields);
    onFieldsChange(nextFields);

    // Reset
    setSelection({ phase: "idle" });
    setForm({ key: "", label: "", type: "text", category: "" });
    setFormErrors({});
  }

  function acceptSuggestion(s: FieldSuggestion) {
    if (s.label_element_id == null || !s.value_element_ids.length) return;
    const labelElem = elemById.get(s.label_element_id);
    const valueElem = elemById.get(s.value_element_ids[0]);
    if (!labelElem || !valueElem) return;
    const newField: TemplateField = {
      key: s.key,
      label: s.label,
      type: (s.type as FieldType) || "text",
      category: null,
      label_element_ids: [labelElem.id],
      value_element_ids: [valueElem.id],
    };
    const nextFields = [...fields, newField];
    setFields(nextFields);
    onFieldsChange(nextFields);
  }

  function handleRemoveField(key: string) {
    const nextFields = fields.filter((f) => f.key !== key);
    setFields(nextFields);
    onFieldsChange(nextFields);
  }

  // -------------------------------------------------------------------------
  // Derived UI helpers
  // -------------------------------------------------------------------------

  const formEnabled = selection.phase === "value_pending";

  function selectionHint() {
    if (selection.phase === "idle")
      return "Click a text block on the image to mark it as the field label.";
    if (selection.phase === "label_pending")
      return "Label selected. Now click the value block on the image.";
    return "Both selected. Fill in the field details and click Add.";
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,380px)]">
      {/* ------------------------------------------------------------------ */}
      {/* Left — image with clickable overlays                                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="relative">
        <div className="relative inline-block w-full select-none">
          <img
            src={imageUrl}
            alt="Reference document"
            className="block w-full rounded-lg border border-slate-200 shadow-sm dark:border-zinc-800"
            draggable={false}
          />

          {ocrElements.map((elem) => {
            const { x1, y1, x2, y2 } = elem.bbox;

            // Anchor-marking mode: every element is a toggle, amber styling
            if (interactionMode === "anchor_marking") {
              const isAnchor = anchorIds.has(elem.id);
              return (
                <div
                  key={elem.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleAnchorClick(elem)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleAnchorClick(elem);
                    }
                  }}
                  title={elem.text}
                  aria-label={isAnchor ? `Remove anchor: "${elem.text}"` : `Mark as anchor: "${elem.text}"`}
                  aria-pressed={isAnchor}
                  style={{
                    position: "absolute",
                    left: `${x1 * 100}%`,
                    top: `${y1 * 100}%`,
                    width: `${(x2 - x1) * 100}%`,
                    height: `${(y2 - y1) * 100}%`,
                  }}
                  className={["rounded transition-colors", getAnchorStyle(isAnchor)].join(" ")}
                />
              );
            }

            // Field-mapping mode: existing render path
            const status = elementStatus(elem, selection, usedIds);
            const fieldInfo = fieldElementMap.get(elem.id);

            // Mapped element: colored overlay with field key label
            if (status === "used" && fieldInfo) {
              const mappedColor = elem.role === "value" ? MAPPED_VALUE_COLOR : MAPPED_LABEL_COLOR;
              return (
                <div
                  key={elem.id}
                  title={`${fieldInfo.fieldKey}: ${elem.text}`}
                  aria-label={`Mapped as "${fieldInfo.fieldKey}": ${elem.text}`}
                  style={{
                    position: "absolute",
                    left: `${x1 * 100}%`,
                    top: `${y1 * 100}%`,
                    width: `${(x2 - x1) * 100}%`,
                    height: `${(y2 - y1) * 100}%`,
                    border: `2px solid ${mappedColor.border}`,
                    backgroundColor: mappedColor.bg,
                    borderRadius: "3px",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: "1px",
                      left: "3px",
                      fontSize: "8px",
                      lineHeight: 1,
                      color: mappedColor.border,
                      fontWeight: 700,
                      fontFamily: "monospace",
                      pointerEvents: "none",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      maxWidth: "calc(100% - 4px)",
                    }}
                  >
                    {fieldInfo.fieldKey}
                  </span>
                </div>
              );
            }

            // Available, selected, or unmapped used element
            return (
              <div
                key={elem.id}
                role={status !== "used" ? "button" : undefined}
                tabIndex={status !== "used" ? 0 : undefined}
                onClick={() => handleElementClick(elem)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleElementClick(elem);
                  }
                }}
                title={elem.text}
                aria-label={
                  status !== "used"
                    ? `Select "${elem.text}"`
                    : `Already used: "${elem.text}"`
                }
                style={{
                  position: "absolute",
                  left: `${x1 * 100}%`,
                  top: `${y1 * 100}%`,
                  width: `${(x2 - x1) * 100}%`,
                  height: `${(y2 - y1) * 100}%`,
                }}
                className={[
                  "rounded transition-colors",
                  getElementStyle(elem, status),
                ].join(" ")}
              />
            );
          })}
        </div>

        {ocrElements.length === 0 && (
          <p className="mt-3 text-center text-sm text-slate-400 dark:text-zinc-500">
            No OCR elements detected in this image.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Right — control panel                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-5 lg:sticky lg:top-4 lg:self-start">
        {/* Mode toggle */}
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium dark:border-zinc-700">
          <button
            type="button"
            onClick={() => setInteractionMode("field_mapping")}
            className={[
              "flex-1 px-4 py-2 transition-colors",
              interactionMode === "field_mapping"
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-500 hover:bg-slate-50 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            Map fields
          </button>
          <button
            type="button"
            onClick={() => setInteractionMode("anchor_marking")}
            className={[
              "flex-1 px-4 py-2 transition-colors",
              interactionMode === "anchor_marking"
                ? "bg-amber-500 text-white"
                : "bg-white text-slate-500 hover:bg-slate-50 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            Mark anchors
            {anchorIds.size > 0 && (
              <span className="ml-1.5 rounded-full bg-white/30 px-1.5 py-0.5 text-xs">
                {anchorIds.size}
              </span>
            )}
          </button>
        </div>

        {/* Field-mapping panels */}
        {interactionMode === "field_mapping" && (
          <>
            {/* Selection state hint */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2 dark:text-zinc-400">
                Selection
              </p>
              <p className="text-sm text-slate-600 dark:text-zinc-300">
                {selectionHint()}
              </p>

              {/* Show selected elements */}
              {selection.phase !== "idle" && (
                <div className="mt-3 space-y-1.5">
                  <SelectedBadge
                    role="Label"
                    text={selection.labelElem.text}
                    color="blue"
                  />
                  {selection.phase === "value_pending" && (
                    <SelectedBadge
                      role="Value"
                      text={selection.valueElem.text}
                      color="green"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Pending suggestions — medium/low confidence, quick accept */}
            {pendingSuggestions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide dark:text-zinc-400">
                  Suggested fields to review ({pendingSuggestions.length})
                </p>
                <ul className="space-y-1.5">
                  {pendingSuggestions.map((s) => (
                    <li
                      key={s.key}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-slate-800 dark:text-zinc-100 truncate block">
                          {s.label}
                        </span>
                        <span className="font-mono text-xs text-slate-400 dark:text-zinc-500">
                          {s.key}
                        </span>
                        {s.value_preview && (
                          <span className="ml-1 text-xs italic text-slate-400 dark:text-zinc-500">
                            · &ldquo;{s.value_preview}&rdquo;
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={[
                            "rounded border px-1.5 py-0.5 text-xs font-medium",
                            s.confidence === "medium"
                              ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400"
                              : "border-slate-200 bg-slate-50 text-slate-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500",
                          ].join(" ")}
                        >
                          {s.confidence}
                        </span>
                        <button
                          type="button"
                          onClick={() => acceptSuggestion(s)}
                          className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors dark:border-indigo-900/60 dark:bg-indigo-950/20 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
                        >
                          Accept
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Pair assignment form */}
            <fieldset
              disabled={!formEnabled}
              className={[
                "rounded-lg border p-4 space-y-3 transition-opacity",
                formEnabled
                  ? "border-indigo-200 bg-indigo-50/40 dark:border-indigo-900/60 dark:bg-indigo-950/20"
                  : "border-slate-200 bg-slate-50/50 opacity-50 dark:border-zinc-800 dark:bg-zinc-900/50",
              ].join(" ")}
            >
              <p className="text-sm font-medium text-slate-700 dark:text-zinc-200">
                Field details
              </p>

              <div className="grid grid-cols-2 gap-3">
                {/* key */}
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium text-slate-600 dark:text-zinc-300">
                    Key{" "}
                    <span className="font-normal text-slate-400 dark:text-zinc-500">
                      (snake_case)
                    </span>
                  </label>
                  <input
                    value={form.key}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, key: e.target.value }));
                      setFormErrors({});
                    }}
                    placeholder="e.g. surname"
                    className={[
                      "w-full rounded-md border px-3 py-1.5 text-sm font-mono",
                      "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                      "dark:text-zinc-100 dark:placeholder:text-zinc-500",
                      formErrors.key
                        ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                        : "border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-900",
                    ].join(" ")}
                  />
                  {formErrors.key && (
                    <p className="text-xs text-red-500 dark:text-red-400">
                      {formErrors.key}
                    </p>
                  )}
                </div>

                {/* label (auto-filled, editable) */}
                <div className="space-y-1 col-span-2">
                  <label className="text-xs font-medium text-slate-600 dark:text-zinc-300">
                    Label text{" "}
                    <span className="font-normal text-slate-400 dark:text-zinc-500">
                      (editable)
                    </span>
                  </label>
                  <input
                    value={form.label}
                    onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))}
                    placeholder="Auto-filled from label element"
                    className={[
                      "w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm",
                      "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                      "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500",
                    ].join(" ")}
                  />
                </div>

                {/* type */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-zinc-300">
                    Type
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, type: e.target.value as FieldType }))
                    }
                    className={[
                      "w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm",
                      "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                      "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
                    ].join(" ")}
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                {/* category */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-zinc-300">
                    Category{" "}
                    <span className="font-normal text-slate-400 dark:text-zinc-500">
                      (opt.)
                    </span>
                  </label>
                  <input
                    value={form.category}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, category: e.target.value }))
                    }
                    placeholder="personal / document"
                    className={[
                      "w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm",
                      "focus:outline-none focus:ring-2 focus:ring-indigo-500",
                      "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500",
                    ].join(" ")}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleAddField}
                  disabled={!formEnabled}
                  className={[
                    "rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1",
                    formEnabled
                      ? "bg-indigo-600 hover:bg-indigo-700"
                      : "cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500",
                  ].join(" ")}
                >
                  Add field
                </button>
              </div>
            </fieldset>
          </>
        )}

        {/* Anchor-marking panel */}
        {interactionMode === "anchor_marking" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/40 px-4 py-3 space-y-3 dark:border-amber-900/40 dark:bg-amber-950/10">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wide dark:text-amber-400">
                Anchor elements
              </p>
              <span
                className={[
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  anchorIds.size >= 3 && anchorIds.size <= 6
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                    : "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
                ].join(" ")}
              >
                {anchorIds.size} / 3–6
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Click text blocks on the image that uniquely identify this document
              type (e.g. title, issuing authority). Aim for 3–6 anchors.
            </p>
            {anchorIds.size === 0 ? (
              <p className="text-xs italic text-slate-400 dark:text-zinc-500">
                No anchors selected yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {Array.from(anchorIds).map((id) => {
                  const elem = elemById.get(id);
                  if (!elem) return null;
                  return (
                    <li
                      key={id}
                      className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-white px-3 py-1.5 dark:border-amber-900/30 dark:bg-zinc-900"
                    >
                      <span className="text-xs text-slate-700 dark:text-zinc-200 break-all">
                        {elem.text}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setAnchorIds((prev) => {
                            const next = new Set(prev);
                            next.delete(id);
                            return next;
                          })
                        }
                        aria-label={`Remove anchor "${elem.text}"`}
                        className="shrink-0 text-slate-300 hover:text-red-400 transition-colors dark:text-zinc-600"
                      >
                        <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden>
                          <path
                            d="M3 8h10"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Mapped fields list — always visible */}
        {fields.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide dark:text-zinc-400">
              Mapped fields ({fields.length})
            </p>
            <ul className="space-y-1.5">
              {fields.map((f) => (
                <li
                  key={f.key}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-slate-800 dark:text-zinc-100">
                      {f.label}
                    </span>
                    <span className="ml-2 font-mono text-xs text-slate-400 dark:text-zinc-500">
                      {f.key}
                    </span>
                    <span className="ml-1 text-xs text-slate-400 dark:text-zinc-500">
                      · {f.type}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveField(f.key)}
                    aria-label={`Remove field ${f.key}`}
                    className="ml-3 shrink-0 text-slate-300 hover:text-red-400 transition-colors dark:text-zinc-600"
                  >
                    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden>
                      <path
                        d="M3 8h10"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectedBadge — shows which element is selected as label/value
// ---------------------------------------------------------------------------

function SelectedBadge({
  role,
  text,
  color,
}: {
  role: string;
  text: string;
  color: "blue" | "green";
}) {
  const colorCls =
    color === "blue"
      ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
      : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300";

  return (
    <div
      className={[
        "flex items-start gap-2 rounded-md border px-3 py-1.5",
        colorCls,
      ].join(" ")}
    >
      <span className="text-xs font-semibold shrink-0">{role}:</span>
      <span className="text-xs break-all">{text}</span>
    </div>
  );
}
