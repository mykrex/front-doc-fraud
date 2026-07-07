"use client";

// =============================================================================
// ManualFieldMapper.tsx
//
// Interactive component for the "manual" template generation mode.
// Shows the preprocessed document image (from GET /session/{id}/image) with
// clickable overlays for each OCR line detected by the backend.
//
// Interaction modes:
//   "field"  — pair label + value OCR lines to create a template field
//   "anchor" — mark fixed text elements (e.g. "PASAPORTE") as anchors
//   "image"  — confirm/remove photo regions (pre-classified when role === "image")
//
// Field pairing flow (mode "field"):
//   Phase "label" — click OCR lines to build the label element set
//   Phase "value" — click OCR lines to build the value element set
//                   "No visible label" copies label IDs to value IDs
//   Add field      — enter key + label name, click Add
// =============================================================================

import { useState, useMemo, useEffect, Fragment } from "react";
import type { OCRLine, TemplateField } from "@/lib/types";

// ---------------------------------------------------------------------------
// Coordinate utilities
// ---------------------------------------------------------------------------

type Rect = { x1: number; y1: number; x2: number; y2: number };

/** Convert a 4-point polygon bbox to an axis-aligned bounding rect. */
function polyToRect(bbox: number[][]): Rect {
  const xs = bbox.map((p) => p[0]);
  const ys = bbox.map((p) => p[1]);
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

/**
 * Compute the axis-aligned enclosing rect for a set of OCR line IDs.
 * Rounds to 4 decimal places to match the precision the API persists.
 */
function enclosingRect(ids: number[], ocrLines: OCRLine[]): Rect | null {
  const elems = ids
    .map((id) => ocrLines.find((l) => l.id === id))
    .filter((e): e is OCRLine => e !== undefined);
  if (!elems.length) return null;
  const allPoints = elems.flatMap((e) => e.bbox);
  const xs = allPoints.map((p) => p[0]);
  const ys = allPoints.map((p) => p[1]);
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return {
    x1: r(Math.min(...xs)),
    y1: r(Math.min(...ys)),
    x2: r(Math.max(...xs)),
    y2: r(Math.max(...ys)),
  };
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function labelToKey(label: string): string {
  const raw = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 55);
  return raw || "field";
}

function generateKey(label: string, existingKeys: string[]): string {
  const base = labelToKey(label);
  if (!existingKeys.includes(base)) return base;
  let n = 2;
  while (existingKeys.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = "label" | "value";
type InteractionMode = "field" | "anchor" | "image";

type LineVisual =
  | "image_active" // in imageIds (confirmed photo region)
  | "image_discarded" // role === "image" but removed by user
  | "anchor" // in anchorIds
  | "selected_label"
  | "selected_value"
  | "used"
  | "available";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ManualFieldMapperProps {
  /** Object URL of the preprocessed image returned by GET /session/{id}/image. */
  imageUrl: string;
  /** OCR lines from GenerateResponse.ocr_lines — bboxes are relative to imageUrl. */
  ocrLines: OCRLine[];
  onFieldsChange: (fields: TemplateField[]) => void;
  /** Called whenever the set of anchor texts changes. */
  onAnchorsChange?: (anchors: string[]) => void;
  /** Called whenever the set of image region bboxes changes. */
  onImageRegionsChange?: (regions: Rect[]) => void;
}

// ---------------------------------------------------------------------------
// Overlay className builder
// ---------------------------------------------------------------------------

function getOverlayCls(
  visual: LineVisual,
  clickable: boolean,
  mode: InteractionMode,
): string {
  const base = "rounded transition-colors ";
  switch (visual) {
    case "image_active":
      return (
        base +
        "border-2 border-dashed border-brand-purple bg-brand-purple/10 " +
        (clickable
          ? "cursor-pointer hover:bg-brand-purple/20"
          : "cursor-default")
      );
    case "image_discarded":
      return (
        base +
        "border border-dashed border-brand-silver/50 opacity-40 " +
        (clickable
          ? "cursor-pointer hover:opacity-70 hover:border-brand-purple/60"
          : "cursor-default")
      );
    case "anchor":
      return (
        base +
        "border-2 border-amber-500 bg-amber-400/15 " +
        (clickable ? "cursor-pointer hover:bg-amber-400/25" : "cursor-default")
      );
    case "selected_label":
      return (
        base +
        "border-2 border-brand-blue bg-brand-blue/25 cursor-pointer ring-1 ring-brand-blue/60"
      );
    case "selected_value":
      return (
        base +
        "border-2 border-emerald-500 bg-emerald-400/25 cursor-pointer ring-1 ring-emerald-400"
      );
    case "used":
      return (
        base +
        "border border-brand-silver/40 bg-brand-silver/10 opacity-40 cursor-default"
      );
    case "available":
      if (!clickable)
        return base + "border border-brand-silver/20 opacity-20 cursor-default";
      if (mode === "anchor")
        return (
          base +
          "border border-brand-silver/60 hover:border-amber-400 hover:bg-amber-100/15 cursor-pointer"
        );
      if (mode === "image")
        return (
          base +
          "border border-brand-silver/60 hover:border-brand-purple/60 hover:bg-brand-purple/10 cursor-pointer"
        );
      return (
        base +
        "border border-brand-silver/60 hover:border-brand-blue/60 hover:bg-brand-blue/10 cursor-pointer"
      );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ManualFieldMapper({
  imageUrl,
  ocrLines,
  onFieldsChange,
  onAnchorsChange,
  onImageRegionsChange,
}: ManualFieldMapperProps) {
  // ---- interaction mode ----
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("field");

  // ---- field mapping state ----
  const [phase, setPhase] = useState<Phase>("label");
  const [pendingLabelIds, setPendingLabelIds] = useState<number[]>([]);
  const [pendingValueIds, setPendingValueIds] = useState<number[]>([]);
  const [noVisibleLabel, setNoVisibleLabel] = useState(false);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [form, setForm] = useState({ label: "" });
  const [formErrors, setFormErrors] = useState<{ label?: string }>({});

  // ---- anchor + image region state ----
  const [anchorIds, setAnchorIds] = useState<Set<number>>(new Set());
  const [imageIds, setImageIds] = useState<Set<number>>(
    () => new Set(ocrLines.filter((l) => l.role === "image").map((l) => l.id)),
  );

  // Report pre-classified image regions once on mount so the parent starts
  // with the correct state even if the user never touches the image-mode panel.
  useEffect(() => {
    if (imageIds.size === 0) return;
    const regions = [...imageIds].flatMap((id) => {
      const l = ocrLines.find((ll) => ll.id === id);
      return l ? [polyToRect(l.bbox)] : [];
    });
    onImageRegionsChange?.(regions);
    // intentionally runs once on mount; imageIds is stable at this point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- derived sets ----

  const usedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const f of fields) {
      f.label_element_ids?.forEach((id) => ids.add(id));
      f.value_element_ids?.forEach((id) => ids.add(id));
    }
    return ids;
  }, [fields]);

  const existingKeys = useMemo(() => fields.map((f) => f.key), [fields]);

  const lineRectMap = useMemo(() => {
    const m = new Map<number, Rect>();
    ocrLines.forEach((l) => m.set(l.id, polyToRect(l.bbox)));
    return m;
  }, [ocrLines]);

  const anchorTexts = useMemo(
    () =>
      [...anchorIds]
        .map((id) => ocrLines.find((l) => l.id === id)?.text ?? "")
        .filter(Boolean),
    [anchorIds, ocrLines],
  );

  // ---------------------------------------------------------------------------
  // Anchor / image region toggles
  // ---------------------------------------------------------------------------

  function toggleAnchor(lineId: number) {
    const next = new Set(anchorIds);
    if (next.has(lineId)) next.delete(lineId);
    else next.add(lineId);
    setAnchorIds(next);
    const texts = [...next]
      .map((id) => ocrLines.find((l) => l.id === id)?.text ?? "")
      .filter(Boolean);
    onAnchorsChange?.(texts);
  }

  function toggleImageRegion(lineId: number) {
    const next = new Set(imageIds);
    if (next.has(lineId)) next.delete(lineId);
    else next.add(lineId);
    setImageIds(next);
    const regions = [...next].flatMap((id) => {
      const l = ocrLines.find((ll) => ll.id === id);
      return l ? [polyToRect(l.bbox)] : [];
    });
    onImageRegionsChange?.(regions);
  }

  // ---------------------------------------------------------------------------
  // Main click handler — dispatches by interaction mode
  // ---------------------------------------------------------------------------

  function handleLineClick(line: OCRLine) {
    if (interactionMode === "anchor") {
      // image regions and committed field lines cannot become anchors
      if (
        usedIds.has(line.id) ||
        line.role === "image" ||
        imageIds.has(line.id)
      )
        return;
      toggleAnchor(line.id);
      return;
    }

    if (interactionMode === "image") {
      // committed field lines and anchor lines cannot be re-classified as images
      if (usedIds.has(line.id) || anchorIds.has(line.id)) return;
      toggleImageRegion(line.id);
      return;
    }

    // field mode — image regions and anchors are excluded from field mapping
    if (
      usedIds.has(line.id) ||
      line.role === "image" ||
      imageIds.has(line.id) ||
      anchorIds.has(line.id)
    )
      return;

    if (phase === "label") {
      setPendingLabelIds((prev) =>
        prev.includes(line.id)
          ? prev.filter((id) => id !== line.id)
          : [...prev, line.id],
      );
    } else {
      if (pendingLabelIds.includes(line.id)) return;
      if (noVisibleLabel) return;
      setPendingValueIds((prev) =>
        prev.includes(line.id)
          ? prev.filter((id) => id !== line.id)
          : [...prev, line.id],
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Field-mode phase handlers
  // ---------------------------------------------------------------------------

  function handleContinueToValue() {
    if (!pendingLabelIds.length) return;
    const text = pendingLabelIds
      .map((id) => ocrLines.find((l) => l.id === id)?.text ?? "")
      .filter(Boolean)
      .join(" ");
    setForm((prev) => ({ ...prev, label: text }));
    setPhase("value");
  }

  function handleNoVisibleLabel() {
    setNoVisibleLabel(true);
    setPendingValueIds([...pendingLabelIds]);
    setForm((prev) => ({ ...prev, label: "" }));
  }

  function handleBackToLabel() {
    setPhase("label");
    setPendingValueIds([]);
    setNoVisibleLabel(false);
    setFormErrors({});
  }

  function handleAddField() {
    const effectiveValueIds = noVisibleLabel
      ? [...pendingLabelIds]
      : [...pendingValueIds];

    const errors: { label?: string } = {};
    if (!form.label.trim()) errors.label = "Label name is required.";
    if (!effectiveValueIds.length) return;
    if (errors.label) {
      setFormErrors(errors);
      return;
    }

    const key = generateKey(form.label, existingKeys);
    const newField: TemplateField = {
      key,
      label: form.label.trim(),
      type: "text",
      category: null,
      label_element_ids: [...pendingLabelIds],
      value_element_ids: effectiveValueIds,
    };

    const nextFields = [...fields, newField];
    setFields(nextFields);
    onFieldsChange(nextFields);
    setPendingLabelIds([]);
    setPendingValueIds([]);
    setNoVisibleLabel(false);
    setPhase("label");
    setForm({ label: "" });
    setFormErrors({});
  }

  function handleRemoveField(key: string) {
    const nextFields = fields.filter((f) => f.key !== key);
    setFields(nextFields);
    onFieldsChange(nextFields);
  }

  // ---------------------------------------------------------------------------
  // Visual state helpers
  // ---------------------------------------------------------------------------

  function getLineVisual(line: OCRLine): LineVisual {
    if (usedIds.has(line.id)) return "used";
    if (imageIds.has(line.id)) return "image_active";
    if (line.role === "image") return "image_discarded";
    if (anchorIds.has(line.id)) return "anchor";
    if (pendingLabelIds.includes(line.id)) return "selected_label";
    if (pendingValueIds.includes(line.id)) return "selected_value";
    return "available";
  }

  function isLineClickable(line: OCRLine): boolean {
    switch (interactionMode) {
      case "anchor":
        return (
          !usedIds.has(line.id) &&
          line.role !== "image" &&
          !imageIds.has(line.id)
        );
      case "image":
        return !usedIds.has(line.id) && !anchorIds.has(line.id);
      case "field":
      default:
        if (
          usedIds.has(line.id) ||
          line.role === "image" ||
          imageIds.has(line.id) ||
          anchorIds.has(line.id)
        )
          return false;
        if (phase === "value" && noVisibleLabel) return false;
        if (phase === "value" && pendingLabelIds.includes(line.id))
          return false;
        return true;
    }
  }

  const canAdd =
    phase === "value" &&
    (noVisibleLabel ? pendingLabelIds.length > 0 : pendingValueIds.length > 0);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,380px)]">
      {/* ------------------------------------------------------------------ */}
      {/* Left — preprocessed image with clickable OCR overlays               */}
      {/* ------------------------------------------------------------------ */}
      <div>
        <div className="relative inline-block w-full select-none">
          <img
            src={imageUrl}
            alt="Preprocessed document"
            className="block w-full rounded-lg border border-brand-silver shadow-sm dark:border-blue/10"
            draggable={false}
          />

          {/* Completed field region overlays */}
          {fields.map((f) => {
            const lRect = enclosingRect(f.label_element_ids ?? [], ocrLines);
            const vRect = enclosingRect(f.value_element_ids ?? [], ocrLines);
            const sameRegion = JSON.stringify(lRect) === JSON.stringify(vRect);
            return (
              <Fragment key={f.key}>
                {lRect && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${lRect.x1 * 100}%`,
                      top: `${lRect.y1 * 100}%`,
                      width: `${(lRect.x2 - lRect.x1) * 100}%`,
                      height: `${(lRect.y2 - lRect.y1) * 100}%`,
                      border: "2px solid #4A90D9",
                      backgroundColor: "rgba(74,144,217,0.15)",
                      borderRadius: "3px",
                      pointerEvents: "none",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 1,
                        left: 3,
                        fontSize: 8,
                        lineHeight: 1,
                        color: "#2563eb",
                        fontWeight: 700,
                        fontFamily: "monospace",
                        pointerEvents: "none",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        maxWidth: "calc(100% - 4px)",
                      }}
                    >
                      {f.key}
                    </span>
                  </div>
                )}
                {vRect && !sameRegion && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${vRect.x1 * 100}%`,
                      top: `${vRect.y1 * 100}%`,
                      width: `${(vRect.x2 - vRect.x1) * 100}%`,
                      height: `${(vRect.y2 - vRect.y1) * 100}%`,
                      border: "2px solid #5CB85C",
                      backgroundColor: "rgba(92,184,92,0.15)",
                      borderRadius: "3px",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </Fragment>
            );
          })}

          {/* OCR line overlays */}
          {ocrLines.map((line) => {
            const rect = lineRectMap.get(line.id);
            if (!rect) return null;
            const visual = getLineVisual(line);
            const clickable = isLineClickable(line);
            const className = getOverlayCls(visual, clickable, interactionMode);

            return (
              <div
                key={line.id}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                title={
                  line.role === "image"
                    ? "Photo region"
                    : line.text || undefined
                }
                aria-label={
                  clickable
                    ? line.role === "image"
                      ? "Toggle photo region"
                      : `Select "${line.text}"`
                    : line.text || "Photo region"
                }
                style={{
                  position: "absolute",
                  left: `${rect.x1 * 100}%`,
                  top: `${rect.y1 * 100}%`,
                  width: `${(rect.x2 - rect.x1) * 100}%`,
                  height: `${(rect.y2 - rect.y1) * 100}%`,
                }}
                className={className}
                onClick={() => clickable && handleLineClick(line)}
                onKeyDown={(e) => {
                  if (clickable && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    handleLineClick(line);
                  }
                }}
              />
            );
          })}
        </div>

        {ocrLines.length === 0 && (
          <p className="mt-3 text-center text-sm text-brand-gray/40 dark:text-foreground/40">
            No OCR lines detected in this document.
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Right — mode toggle + mode-specific panel                            */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        {/* Mode toggle */}
        <div className="flex rounded-lg border border-brand-silver bg-brand-surface p-1 gap-1 dark:border-blue/10 dark:bg-white/5">
          {(
            [
              { mode: "field" as const, label: "Map fields" },
              { mode: "anchor" as const, label: "Anchors" },
              { mode: "image" as const, label: "Photo regions" },
            ] as const
          ).map(({ mode, label }) => {
            const count =
              mode === "anchor"
                ? anchorIds.size
                : mode === "image"
                  ? imageIds.size
                  : 0;
            const active = interactionMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setInteractionMode(mode)}
                className={[
                  "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? mode === "field"
                      ? "bg-brand-blue text-white shadow-sm"
                      : mode === "anchor"
                        ? "bg-amber-500 text-white shadow-sm"
                        : "bg-brand-purple text-white shadow-sm"
                    : "text-brand-gray/60 hover:text-brand-gray dark:text-foreground/60 dark:hover:text-foreground",
                ].join(" ")}
              >
                {label}
                {count > 0 && (
                  <span
                    className={[
                      "ml-1 rounded-full px-1 text-xs",
                      active
                        ? "bg-white/20"
                        : "bg-brand-silver/30 text-brand-gray dark:bg-white/10 dark:text-foreground/70",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ---- Field mode ---- */}
        {interactionMode === "field" && (
          <>
            {/* Phase status card */}
            <div className="rounded-lg border border-brand-silver bg-brand-surface px-4 py-3 dark:border-blue/10 dark:bg-white/5">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-black mb-1 dark:text-foreground">
                {phase === "label"
                  ? "Step 1 — Select label elements"
                  : "Step 2 — Select value elements"}
              </p>
              <p className="text-sm text-brand-gray/70 dark:text-foreground/70">
                {phase === "label"
                  ? pendingLabelIds.length === 0
                    ? "Click on a text block in the image to mark it as the field label. You can select multiple blocks."
                    : `${pendingLabelIds.length} block${pendingLabelIds.length > 1 ? "s" : ""} selected as label. Click more to add, or continue.`
                  : noVisibleLabel
                    ? "No visible label — label and value share the same element(s). Enter a field name below and click Add."
                    : pendingValueIds.length === 0
                      ? "Now click the text block(s) that contain the field value."
                      : `${pendingValueIds.length} value block${pendingValueIds.length > 1 ? "s" : ""} selected. Fill in the form below to save the field.`}
              </p>

              {pendingLabelIds.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <SelectedBadge
                    role="Label"
                    texts={pendingLabelIds.map(
                      (id) =>
                        ocrLines.find((l) => l.id === id)?.text ?? `#${id}`,
                    )}
                    color="blue"
                  />
                  {pendingValueIds.length > 0 && !noVisibleLabel && (
                    <SelectedBadge
                      role="Value"
                      texts={pendingValueIds.map(
                        (id) =>
                          ocrLines.find((l) => l.id === id)?.text ?? `#${id}`,
                      )}
                      color="green"
                    />
                  )}
                  {noVisibleLabel && (
                    <div className="flex items-center gap-2 rounded-md border border-brand-silver bg-brand-surface-alt px-3 py-1.5 dark:border-blue/10 dark:bg-gray/5">
                      <span className="text-xs font-semibold text-brand-gray/70 dark:text-foreground/70">
                        No visible label
                      </span>
                      <span className="text-xs text-brand-gray/50 dark:text-foreground/50">
                        — label = value element(s)
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Phase action buttons */}
            <div className="flex flex-wrap gap-2">
              {phase === "label" && (
                <button
                  type="button"
                  disabled={pendingLabelIds.length === 0}
                  onClick={handleContinueToValue}
                  className={[
                    "rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1",
                    pendingLabelIds.length === 0
                      ? "bg-brand-silver text-brand-gray/40 cursor-not-allowed dark:bg-white/10 dark:text-foreground/40"
                      : "bg-brand-blue hover:bg-brand-blue-dark",
                  ].join(" ")}
                >
                  Continue to value →
                </button>
              )}

              {phase === "value" && (
                <>
                  <button
                    type="button"
                    onClick={handleBackToLabel}
                    className="rounded-lg border border-brand-silver px-4 py-2 text-sm text-brand-gray/60 hover:text-brand-gray transition-colors dark:border-blue/10 dark:text-foreground/60 dark:hover:text-foreground"
                  >
                    ← Back to label
                  </button>
                  {!noVisibleLabel && (
                    <button
                      type="button"
                      onClick={handleNoVisibleLabel}
                      className="rounded-lg border border-brand-silver bg-brand-surface px-4 py-2 text-sm text-brand-gray/70 hover:bg-brand-surface-alt hover:text-brand-gray transition-colors dark:border-blue/10 dark:bg-white/5 dark:text-foreground/60 dark:hover:text-foreground"
                    >
                      No visible label
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Add field button (value phase, label present) */}
            {phase === "value" && !noVisibleLabel && (
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!canAdd}
                  onClick={handleAddField}
                  className={[
                    "rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors",
                    "focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1",
                    canAdd
                      ? "bg-brand-blue hover:bg-brand-blue-dark"
                      : "bg-brand-silver text-brand-gray/40 cursor-not-allowed dark:bg-white/10 dark:text-foreground/40",
                  ].join(" ")}
                >
                  Add field
                </button>
              </div>
            )}

            {/* Add field form (value phase, no visible label) */}
            {phase === "value" && noVisibleLabel && (
              <div className="rounded-lg border border-brand-blue/20 bg-brand-surface/60 p-4 space-y-3 dark:border-brand-blue/15 dark:bg-brand-blue/5">
                <p className="text-sm font-medium text-brand-gray dark:text-foreground">
                  Field details
                </p>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-brand-gray/70 dark:text-foreground/70">
                    Label name{" "}
                    <span className="font-normal text-blue-600 dark:text-blue-400">
                      (required — no OCR label)
                    </span>
                  </label>
                  <input
                    value={form.label}
                    disabled={!canAdd}
                    onChange={(e) => {
                      setForm((p) => ({ ...p, label: e.target.value }));
                      setFormErrors((p) => ({ ...p, label: undefined }));
                    }}
                    placeholder="e.g. Visa Number"
                    className={[
                      "w-full rounded-md border px-3 py-1.5 text-sm",
                      "focus:outline-none focus:ring-2 focus:ring-brand-blue",
                      "dark:text-foreground dark:placeholder:text-foreground/40",
                      formErrors.label
                        ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
                        : "border-brand-silver bg-white dark:border-blue/10 dark:bg-white/5",
                    ].join(" ")}
                  />
                  {formErrors.label && (
                    <p className="text-xs text-red-500 dark:text-red-400">
                      {formErrors.label}
                    </p>
                  )}
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    disabled={!canAdd}
                    onClick={handleAddField}
                    className={[
                      "rounded-md px-4 py-1.5 text-sm font-medium text-white transition-colors",
                      "focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1",
                      canAdd
                        ? "bg-brand-blue hover:bg-brand-blue-dark"
                        : "bg-brand-silver text-brand-gray/40 cursor-not-allowed dark:bg-white/10 dark:text-foreground/40",
                    ].join(" ")}
                  >
                    Add field
                  </button>
                </div>
              </div>
            )}

            {/* Mapped fields list */}
            {fields.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray/60 dark:text-foreground/60">
                  Mapped fields ({fields.length})
                </p>
                <ul className="space-y-1.5">
                  {fields.map((f) => {
                    const isLabelless =
                      (f.label_element_ids ?? []).join(",") ===
                      (f.value_element_ids ?? []).join(",");
                    return (
                      <li
                        key={f.key}
                        className="flex items-center justify-between rounded-lg border border-brand-silver bg-white px-3 py-2 dark:border-blue/10 dark:bg-white/5"
                      >
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-brand-gray dark:text-foreground">
                            {f.label}
                          </span>
                          <span className="ml-2 font-mono text-xs text-brand-gray/40 dark:text-foreground/40">
                            {f.key}
                          </span>
                          {isLabelless && (
                            <span className="ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-xs text-blue-700 dark:bg-blue-750/30 dark:text-blue-400">
                              no label
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveField(f.key)}
                          aria-label={`Remove field ${f.key}`}
                          className="ml-3 shrink-0 text-brand-silver hover:text-red-400 transition-colors dark:text-foreground/30"
                        >
                          <svg
                            viewBox="0 0 16 16"
                            fill="none"
                            className="h-4 w-4"
                            aria-hidden
                          >
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
              </div>
            )}
          </>
        )}

        {/* ---- Anchor mode ---- */}
        {interactionMode === "anchor" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-brand-silver bg-brand-surface px-4 py-3 dark:border-blue/10 dark:bg-white/5">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray/60 mb-1 dark:text-foreground/60">
                Anchor marking
              </p>
              <p className="text-sm text-brand-gray/70 dark:text-foreground/70">
                Click text blocks that appear verbatim on every document of this
                type — e.g. &ldquo;PASAPORTE&rdquo;, &ldquo;REPÚBLICA
                MEXICANA&rdquo;. These help the pipeline locate fields reliably.
                Click again to deselect.
              </p>
            </div>

            {anchorTexts.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray/60 dark:text-foreground/60">
                  Anchors ({anchorTexts.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {anchorTexts.map((text, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-200/30 dark:text-amber-500"
                    >
                      {text}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-brand-gray/40 dark:text-foreground/40">
                No anchors marked yet. Click fixed text on the image.
              </p>
            )}
          </div>
        )}

        {/* ---- Image mode ---- */}
        {interactionMode === "image" && (
          <div className="space-y-3">
            <div className="rounded-lg border border-brand-silver bg-brand-surface px-4 py-3 dark:border-blue/10 dark:bg-white/5">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray/60 mb-1 dark:text-foreground/60">
                Photo regions
              </p>
              <p className="text-sm text-brand-gray/70 dark:text-foreground/70">
                Regions detected as photos (violet dashed border) are
                pre-selected. Click to remove a region or to add a new one. Text
                regions can also be added if needed.
              </p>
            </div>

            <p className="text-sm text-brand-gray/70 dark:text-foreground/70">
              <span className="font-semibold">{imageIds.size}</span> region
              {imageIds.size !== 1 ? "s" : ""} selected.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectedBadge — shows which OCR line(s) are currently selected
// ---------------------------------------------------------------------------

function SelectedBadge({
  role,
  texts,
  color,
}: {
  role: string;
  texts: string[];
  color: "blue" | "green";
}) {
  const colorCls =
    color === "blue"
      ? "border-brand-blue/30 bg-brand-surface text-brand-blue-dark dark:border-brand-blue/30 dark:bg-brand-blue/10 dark:text-brand-blue"
      : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-300 dark:text-emerald-500";

  return (
    <div
      className={[
        "flex items-start gap-2 rounded-md border px-3 py-1.5",
        colorCls,
      ].join(" ")}
    >
      <span className="text-xs font-semibold shrink-0">{role}:</span>
      <div className="text-xs break-all space-y-0.5">
        {texts.map((t, i) => (
          <div key={i}>{t}</div>
        ))}
      </div>
    </div>
  );
}
