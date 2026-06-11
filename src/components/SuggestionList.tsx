"use client";

// =============================================================================
// SuggestionList.tsx
// Shows the FieldSuggestion[] returned by POST /v1/templates/generate.
// Each card can be toggled on/off. Accepted suggestions are lifted to the
// parent as TemplateField[] via onSelectionChange.
// =============================================================================

import { useState, useEffect } from "react";
import type { FieldSuggestion, TemplateField } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700 border-emerald-200",
  medium: "bg-amber-50  text-amber-700  border-amber-200",
  low: "bg-slate-50  text-slate-500  border-slate-200",
};

const SOURCE_LABELS: Record<string, string> = {
  mrz: "MRZ",
  regex: "Regex",
  spatial_match: "Spatial",
};

function suggestionToField(s: FieldSuggestion): TemplateField {
  return {
    key: s.key,
    label: s.label,
    type: (s.type as TemplateField["type"]) ?? "text",
    category: null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SuggestionListProps {
  suggestions: FieldSuggestion[];
  /** Called every time the accepted set changes. */
  onSelectionChange: (accepted: TemplateField[]) => void;
}

export function SuggestionList({
  suggestions,
  onSelectionChange,
}: SuggestionListProps) {
  // Start with high-confidence ones pre-selected
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        suggestions.filter((s) => s.confidence === "high").map((s) => s.key),
      ),
  );

  // Notify parent whenever selection changes
  useEffect(() => {
    const accepted = suggestions
      .filter((s) => selected.has(s.key))
      .map(suggestionToField);
    onSelectionChange(accepted);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(suggestions.map((s) => s.key)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-slate-400 py-6 text-center">
        The API returned no suggestions for this document.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-700">{selected.size}</span> of{" "}
          {suggestions.length} suggestions selected
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
          >
            Select all
          </button>
          <span className="text-slate-300">·</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Cards */}
      <ul className="space-y-2">
        {suggestions.map((s) => {
          const isSelected = selected.has(s.key);
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => toggle(s.key)}
                className={[
                  "w-full text-left rounded-lg border px-4 py-3 transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                  isSelected
                    ? "border-indigo-300 bg-indigo-50"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Left: field info */}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      {/* Checkbox visual */}
                      <span
                        className={[
                          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          isSelected
                            ? "border-indigo-500 bg-indigo-500 text-white"
                            : "border-slate-300 bg-white",
                        ].join(" ")}
                        aria-hidden
                      >
                        {isSelected && (
                          <svg
                            viewBox="0 0 12 12"
                            fill="none"
                            className="h-3 w-3"
                          >
                            <path
                              d="M2 6l3 3 5-5"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                      <span className="font-medium text-slate-800 text-sm truncate">
                        {s.label}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 pl-6">
                      key:{" "}
                      <code className="font-mono text-slate-600">{s.key}</code>
                      {s.value_preview && (
                        <>
                          {" · "}
                          <span className="italic">"{s.value_preview}"</span>
                        </>
                      )}
                    </p>
                  </div>

                  {/* Right: badges */}
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={[
                        "rounded border px-1.5 py-0.5 text-xs font-medium",
                        CONFIDENCE_STYLES[s.confidence] ??
                          CONFIDENCE_STYLES.low,
                      ].join(" ")}
                    >
                      {s.confidence}
                    </span>
                    <span className="text-xs text-slate-400">
                      {SOURCE_LABELS[s.source] ?? s.source} · {s.type}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
