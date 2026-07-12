"use client";

// =============================================================================
// Policy configuration page — GET/PUT /v1/risk/thresholds.
// Lets the team adjust the three score-band boundaries used by /v1/verify
// when no hard rule fires. Changes are in-memory only on the server.
// =============================================================================

import { useEffect, useState } from "react";
import { getThresholds, updateThresholds, ApiError } from "@/lib/api";
import type { RiskThresholds } from "@/lib/types";
import ErrorMessage from "@/components/ui/ErrorMessage";
import Spinner from "@/components/ui/Spinner";

const DEFAULTS: RiskThresholds = {
  approve_max: 0.3,
  review_max: 0.6,
  edd_max: 0.8,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(v: number) {
  return v.toFixed(2);
}

function isAtDefaults(t: RiskThresholds) {
  return (
    t.approve_max === DEFAULTS.approve_max &&
    t.review_max === DEFAULTS.review_max &&
    t.edd_max === DEFAULTS.edd_max
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PolicyPage() {
  const [approveMax, setApproveMax] = useState(DEFAULTS.approve_max);
  const [reviewMax, setReviewMax] = useState(DEFAULTS.review_max);
  const [eddMax, setEddMax] = useState(DEFAULTS.edd_max);

  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedThresholds, setSavedThresholds] = useState<RiskThresholds | null>(
    null,
  );

  useEffect(() => {
    getThresholds()
      .then((data) => {
        setApproveMax(data.approve_max);
        setReviewMax(data.review_max);
        setEddMax(data.edd_max);
      })
      .catch((err) =>
        setFetchError(
          err instanceof ApiError ? err.message : "Could not load thresholds.",
        ),
      )
      .finally(() => setFetching(false));
  }, []);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  const approveError =
    approveMax <= 0 || approveMax >= 1
      ? "Must be strictly between 0 and 1."
      : null;

  const reviewError =
    reviewMax <= 0 || reviewMax >= 1
      ? "Must be strictly between 0 and 1."
      : !approveError && reviewMax <= approveMax
        ? "Must be greater than the ACCEPT ceiling."
        : null;

  const eddError =
    eddMax <= 0 || eddMax >= 1
      ? "Must be strictly between 0 and 1."
      : !approveError && !reviewError && eddMax <= reviewMax
        ? "Must be greater than the REVIEW ceiling."
        : null;

  const orderError =
    !approveError &&
    !reviewError &&
    !eddError &&
    !(approveMax < reviewMax && reviewMax < eddMax)
      ? "Thresholds must satisfy: ACCEPT ceiling < REVIEW ceiling < EDD ceiling."
      : null;

  const isValid = !approveError && !reviewError && !eddError && !orderError;
  const canSave = isValid && !loading;
  const isCustom = !isAtDefaults({
    approve_max: approveMax,
    review_max: reviewMax,
    edd_max: eddMax,
  });

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setLoading(true);
    setSaveError(null);
    setSavedThresholds(null);
    try {
      const result = await updateThresholds({
        approve_max: approveMax,
        review_max: reviewMax,
        edd_max: eddMax,
      });
      // Sync state from echoed response (server may round to 4 dp)
      setApproveMax(result.approve_max);
      setReviewMax(result.review_max);
      setEddMax(result.edd_max);
      setSavedThresholds(result);
    } catch (err) {
      setSaveError(
        err instanceof ApiError ? err.message : "Failed to save thresholds.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setApproveMax(DEFAULTS.approve_max);
    setReviewMax(DEFAULTS.review_max);
    setEddMax(DEFAULTS.edd_max);
    setSavedThresholds(null);
    setSaveError(null);
  }

  // ---------------------------------------------------------------------------
  // Band widths (clamped to non-negative for display even when invalid)
  // ---------------------------------------------------------------------------

  const bands = {
    accept: Math.max(0, approveMax) * 100,
    review: Math.max(0, reviewMax - approveMax) * 100,
    edd: Math.max(0, eddMax - reviewMax) * 100,
    reject: Math.max(0, 1 - eddMax) * 100,
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-gray dark:text-foreground">
          Risk threshold configuration
        </h1>
        <p className="mt-1 text-sm text-brand-gray/60 dark:text-foreground/60">
          Configure the score bands used by the verdict path in verify
        </p>
      </div>

      {/* In-memory warning 
      <div className="mt-6 flex items-start gap-3 rounded-lg border border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/80 dark:bg-amber-400/50 dark:text-amber-800">
        <span aria-hidden className="mt-0.5 shrink-0 text-base">
          ⚠
        </span>
        <p>
          Changes are stored in memory only and will be lost when the server
          restarts. Defaults are{" "}
          <strong>
            {fmt(DEFAULTS.approve_max)} / {fmt(DEFAULTS.review_max)} /{" "}
            {fmt(DEFAULTS.edd_max)}
          </strong>
          .
        </p>
      </div>
      */}

      {/* Custom-thresholds notice */}
      {isCustom && !fetching && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-brand-blue/30 bg-brand-surface px-4 py-2.5 text-sm text-brand-blue-dark dark:border-brand-blue/20 dark:bg-white/5 dark:text-brand-blue">
          <span aria-hidden className="shrink-0">
            ◆
          </span>
          Custom thresholds active — defaults are {fmt(DEFAULTS.approve_max)} /{" "}
          {fmt(DEFAULTS.review_max)} / {fmt(DEFAULTS.edd_max)}
        </div>
      )}

      {/* Fetch states */}
      {fetching && (
        <div className="mt-8 flex justify-center">
          <Spinner size="md" label="Loading current thresholds…" />
        </div>
      )}

      {fetchError && !fetching && (
        <div className="mt-6">
          <ErrorMessage
            title="Could not load thresholds"
            message={fetchError}
          />
        </div>
      )}

      {!fetching && !fetchError && (
        <form onSubmit={handleSubmit} className="mt-8 space-y-7">
          {/* Band visualization */}
          <BandMap
            bands={bands}
            approveMax={approveMax}
            reviewMax={reviewMax}
            eddMax={eddMax}
            valid={isValid}
          />

          {/* Threshold inputs */}
          <div className="space-y-5">
            <ThresholdRow
              id="approve_max"
              label="ACCEPT ceiling"
              description="Scores at or below this value → ACCEPT"
              color="green"
              value={approveMax}
              onChange={setApproveMax}
              error={approveError}
            />
            <ThresholdRow
              id="review_max"
              label="REVIEW ceiling"
              description="Scores above ACCEPT ceiling and at or below this value → REVIEW"
              color="orange"
              value={reviewMax}
              onChange={setReviewMax}
              error={reviewError}
            />
            <ThresholdRow
              id="edd_max"
              label="EDD ceiling"
              description="Scores above REVIEW ceiling and at or below this value → EDD (Enhanced Due Diligence)"
              color="amber"
              value={eddMax}
              onChange={setEddMax}
              error={eddError}
            />
          </div>

          {/* Cross-field order error */}
          {orderError && (
            <p className="rounded-md bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:bg-red-600/20 dark:text-red-400">
              {orderError}
            </p>
          )}

          {/* Server save error */}
          {saveError && (
            <ErrorMessage title="Save failed" message={saveError} />
          )}

          {/* Save confirmation */}
          {savedThresholds && !saveError && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-400/30 dark:bg-green-500/40 dark:text-green-600">
              <span aria-hidden>✓</span>
              Thresholds saved:{" "}
              <strong className="font-mono">
                {fmt(savedThresholds.approve_max)} /{" "}
                {fmt(savedThresholds.review_max)} /{" "}
                {fmt(savedThresholds.edd_max)}
              </strong>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSave}
              className="inline-flex h-10 items-center rounded-full bg-brand-blue px-6 text-sm font-medium text-white transition-colors hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Saving…" : "Save thresholds"}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={!isCustom || loading}
              className="inline-flex h-10 items-center rounded-full border border-brand-silver px-5 text-sm text-brand-gray/70 transition-colors hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-40 dark:border-blue/10 dark:text-foreground/70 dark:hover:border-brand-blue dark:hover:text-brand-blue"
            >
              Reset to defaults
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Band visualization
// ---------------------------------------------------------------------------

type BandWeights = {
  accept: number;
  review: number;
  edd: number;
  reject: number;
};

const BAND_CONFIG = [
  {
    key: "accept",
    label: "ACCEPT",
    bar: "bg-green-200 dark:bg-green-500/50",
    text: "text-green-700 dark:text-green-400",
  },
  {
    key: "review",
    label: "REVIEW",
    bar: "bg-orange-200 dark:bg-orange-500/50",
    text: "text-orange-700 dark:text-orange-400",
  },
  {
    key: "edd",
    label: "EDD",
    bar: "bg-amber-200 dark:bg-amber-500/50",
    text: "text-amber-700 dark:text-amber-400",
  },
  {
    key: "reject",
    label: "REJECT",
    bar: "bg-red-200 dark:bg-red-500/50",
    text: "text-red-700 dark:text-red-400",
  },
] as const;

function BandMap({
  bands,
  approveMax,
  reviewMax,
  eddMax,
  valid,
}: {
  bands: BandWeights;
  approveMax: number;
  reviewMax: number;
  eddMax: number;
  valid: boolean;
}) {
  return (
    <div className="rounded-xl border border-brand-silver p-4 dark:border-blue/10">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-blue-dark dark:text-brand-blue">
        Score band preview
      </p>

      {/* Colored bar */}
      <div
        className={`flex h-10 overflow-hidden rounded-md ${!valid ? "opacity-40" : ""}`}
        aria-hidden
      >
        {BAND_CONFIG.map(({ key, label, bar, text }) => (
          <div
            key={key}
            style={{ width: `${bands[key]}%` }}
            className={`flex min-w-0 items-center justify-center overflow-hidden ${bar}`}
          >
            {bands[key] > 12 && <span></span>}
          </div>
        ))}
      </div>

      {/* Threshold labels under the bar */}
      <div className="mt-3 grid grid-cols-4 gap-x-2 text-xs">
        {BAND_CONFIG.map(({ key, label, text }, i) => {
          const thresholds = [
            `0 – ${fmt(approveMax)}`,
            `${fmt(approveMax)} – ${fmt(reviewMax)}`,
            `${fmt(reviewMax)} – ${fmt(eddMax)}`,
            `${fmt(eddMax)} – 1`,
          ];
          return (
            <div key={key} className="space-y-0.5">
              <span className={`font-semibold ${text}`}>{label}</span>
              <p className="font-mono text-brand-gray/60 dark:text-foreground/50">
                {thresholds[i]}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual threshold row
// ---------------------------------------------------------------------------

type ThresholdColor = "green" | "orange" | "amber";

const COLOR_CLASSES: Record<ThresholdColor, { dot: string; focus: string }> = {
  green: { dot: "bg-green-500", focus: "focus:border-green-500" },
  orange: { dot: "bg-orange-500", focus: "focus:border-orange-500" },
  amber: { dot: "bg-amber-500", focus: "focus:border-amber-500" },
};

function ThresholdRow({
  id,
  label,
  description,
  color,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  description: string;
  color: ThresholdColor;
  value: number;
  onChange: (v: number) => void;
  error: string | null;
}) {
  const { dot, focus } = COLOR_CLASSES[color];
  const hasError = !!error;

  function handleNumberInput(raw: string) {
    const v = parseFloat(raw);
    if (!isNaN(v)) onChange(v);
  }

  function handleSlider(raw: string) {
    onChange(parseFloat(raw));
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand-silver p-4 dark:border-blue/10">
      {/* Label + value */}
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={id} className="flex items-center gap-2">
          <span
            aria-hidden
            className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`}
          />
          <span className="text-sm font-medium text-brand-gray dark:text-foreground">
            {label}
          </span>
        </label>
        <input
          id={`${id}-number`}
          type="number"
          min={0.01}
          max={0.99}
          step={0.01}
          value={value}
          onChange={(e) => handleNumberInput(e.target.value)}
          className={`h-8 w-24 rounded-md border bg-white px-2 text-right font-mono text-sm outline-none dark:bg-white/5 ${
            hasError
              ? "border-red-400 focus:border-red-500 dark:border-red-500"
              : `border-brand-silver ${focus} dark:border-blue/10`
          }`}
        />
      </div>

      <p className="pl-[18px] text-xs text-brand-gray/50 dark:text-foreground/50">
        {description}
      </p>

      {/* Slider */}
      <input
        id={id}
        type="range"
        min={0.01}
        max={0.99}
        step={0.01}
        value={value}
        onChange={(e) => handleSlider(e.target.value)}
        className="w-full accent-[#3781c2]"
      />

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
