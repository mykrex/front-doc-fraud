"use client";

// =============================================================================
// New-template wizard — manual OCR pairing flow.
//
// Steps:
//   0. Upload a reference image  → POST /v1/templates/generate (mode="manual", SSE)
//   1. Pair OCR lines as label/value with ManualFieldMapper
//   2. Preview regions on the preprocessed image (static, no interaction)
//   3. Fill in template metadata + Confirm → POST /v1/templates/confirm
// =============================================================================

import { useState, useRef, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  generateTemplate,
  confirmTemplate,
  fetchSessionImage,
  ApiError,
} from "@/lib/api";
import { ManualFieldMapper } from "@/components/ManualFieldMapper";
import type {
  GenerateResponse,
  TemplateField,
  ConfirmTemplateRequest,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS = ["Upload image", "Map fields", "Preview", "Confirm"] as const;

function StepBar({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-0" aria-label="Steps">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <span
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold border-2 transition-colors",
                  done
                    ? "border-brand-blue bg-brand-blue text-white"
                    : active
                      ? "border-brand-blue bg-white text-brand-blue dark:bg-brand-white"
                      : "border-brand-silver bg-white text-brand-gray/40 dark:border-blue/15 dark:text-foreground/40",
                ].join(" ")}
              >
                {done ? (
                  <svg viewBox="0 0 12 12" fill="none" className="h-3.5 w-3.5">
                    <path
                      d="M2 6l3 3 5-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={[
                  "text-xs whitespace-nowrap",
                  active
                    ? "text-brand-blue-dark font-medium dark:text-brand-blue"
                    : "text-brand-gray/40 dark:text-foreground/40",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={[
                  "mx-3 mb-4 h-px w-12 transition-colors",
                  done ? "bg-brand-blue" : "bg-brand-silver dark:bg-white/15",
                ].join(" ")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Validation helpers (mirrors server rules)
// ---------------------------------------------------------------------------

const DOC_TYPE_RE = /^[a-z0-9_]{1,60}$/;
const COUNTRY_ISO_RE = /^[A-Z]{3}$/;

interface MetaErrors {
  documentType?: string;
  documentName?: string;
  countryIso?: string;
  edition?: string;
}

function validateMeta(meta: MetaForm): MetaErrors {
  const e: MetaErrors = {};
  if (!DOC_TYPE_RE.test(meta.documentType))
    e.documentType =
      "Lowercase letters, digits, and underscores only (1–60 characters).";
  if (!meta.documentName.trim()) e.documentName = "Document name is required.";
  if (meta.countryIso && !COUNTRY_ISO_RE.test(meta.countryIso))
    e.countryIso = "Must be exactly 3 uppercase letters (ISO alpha-3).";
  const edition = Number(meta.edition);
  if (!meta.edition || isNaN(edition) || edition < 1900 || edition > 2100)
    e.edition = "Year between 1900 and 2100.";
  return e;
}

// ---------------------------------------------------------------------------
// Region preview helpers (mirror ManualFieldMapper logic)
// ---------------------------------------------------------------------------

type Rect = { x1: number; y1: number; x2: number; y2: number };

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

function enclosingRect(
  ids: number[],
  lines: { id: number; bbox: number[][] }[],
): Rect | null {
  const elems = ids
    .map((id) => lines.find((l) => l.id === id))
    .filter(Boolean) as { bbox: number[][] }[];
  if (!elems.length) return null;
  const pts = elems.flatMap((e) => e.bbox);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return {
    x1: r(Math.min(...xs)),
    y1: r(Math.min(...ys)),
    x2: r(Math.max(...xs)),
    y2: r(Math.max(...ys)),
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetaForm {
  documentType: string;
  documentName: string;
  country: string;
  countryIso: string;
  edition: string;
}

const EMPTY_META: MetaForm = {
  documentType: "",
  documentName: "",
  country: "",
  countryIso: "",
  edition: String(new Date().getFullYear()),
};

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function NewTemplatePage() {
  const router = useRouter();

  // Step 0 – upload
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Step 1 – generate result + preprocessed image
  const [generate, setGenerate] = useState<GenerateResponse | null>(null);
  const [preprocessedImageUrl, setPreprocessedImageUrl] = useState<
    string | null
  >(null);
  const [manualFields, setManualFields] = useState<TemplateField[]>([]);
  const [manualAnchors, setManualAnchors] = useState<string[]>([]);
  const [manualImageRegions, setManualImageRegions] = useState<
    { x1: number; y1: number; x2: number; y2: number }[]
  >([]);

  // Session expiry countdown (updates every second)
  const [expiryCountdown, setExpiryCountdown] = useState<string>("");
  useEffect(() => {
    if (!generate?.expires_at) return;
    const expiresAt = new Date(generate.expires_at).getTime();
    function tick() {
      const diff = expiresAt - Date.now();
      if (diff <= 0) {
        setExpiryCountdown("Expired");
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setExpiryCountdown(`${mins}:${secs.toString().padStart(2, "0")}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [generate?.expires_at]);

  // Revoke the preprocessed image Object URL when it changes or the component unmounts
  useEffect(() => {
    return () => {
      if (preprocessedImageUrl) URL.revokeObjectURL(preprocessedImageUrl);
    };
  }, [preprocessedImageUrl]);

  // Step 2 – confirm
  const [meta, setMeta] = useState<MetaForm>(EMPTY_META);
  const [metaErrors, setMetaErrors] = useState<MetaErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Step 0 → 1: generate + fetch preprocessed image
  // -------------------------------------------------------------------------

  async function handleGenerate() {
    if (!file) return;
    setGenerating(true);
    setGenerateError(null);

    // Revoke any previous session image before starting a new one
    if (preprocessedImageUrl) {
      URL.revokeObjectURL(preprocessedImageUrl);
      setPreprocessedImageUrl(null);
    }
    setManualFields([]);
    setManualAnchors([]);
    setManualImageRegions([]);

    try {
      const data = await generateTemplate({ image: file, mode: "manual" });
      setGenerate(data);

      // The preprocessed image is only available during the session window
      // (generate → confirm). Fetch it immediately after OCR completes.
      const imgUrl = await fetchSessionImage(data.generate_id);
      setPreprocessedImageUrl(imgUrl);
      setStep(1);
    } catch (err) {
      if (err instanceof ApiError) setGenerateError(err.message);
      else setGenerateError("Unexpected error while processing the image.");
    } finally {
      setGenerating(false);
    }
  }

  // -------------------------------------------------------------------------
  // Step 1 → 0: back to upload (release image Object URL)
  // -------------------------------------------------------------------------

  function handleBackToUpload() {
    if (preprocessedImageUrl) {
      URL.revokeObjectURL(preprocessedImageUrl);
      setPreprocessedImageUrl(null);
    }
    setManualFields([]);
    setManualAnchors([]);
    setManualImageRegions([]);
    setStep(0);
  }

  // -------------------------------------------------------------------------
  // Step 1 → 2: show region preview
  // -------------------------------------------------------------------------

  function handleAdvanceToPreview() {
    if (manualFields.length === 0) return;
    setStep(2);
  }

  // -------------------------------------------------------------------------
  // Step 2 → 3: advance to metadata form
  // -------------------------------------------------------------------------

  function handleAdvanceToMeta() {
    // Pre-fill country ISO from preclass hint (advisory — user can override)
    setMeta((prev) => ({
      ...prev,
      countryIso: prev.countryIso || generate?.preclass?.country_iso || "",
    }));
    setStep(3);
  }

  // -------------------------------------------------------------------------
  // Step 2: confirm
  // -------------------------------------------------------------------------

  async function handleConfirm() {
    const errors = validateMeta(meta);
    if (Object.keys(errors).length > 0) {
      setMetaErrors(errors);
      return;
    }
    setMetaErrors({});

    if (!generate) return;

    const body: ConfirmTemplateRequest = {
      generate_id: generate.generate_id,
      document_type: meta.documentType,
      document_name: meta.documentName,
      country: meta.country || null,
      country_iso: meta.countryIso || null,
      edition: Number(meta.edition),
      doc_family: generate.preclass.doc_family ?? null,
      mrz_type: generate.preclass.mrz_type ?? null,
      fields: manualFields,
      anchors: manualAnchors,
      image_regions: manualImageRegions,
      fingerprint: {},
      field_rules: {},
      qr_config: generate.qr_config,
    };

    setConfirming(true);
    setConfirmError(null);

    try {
      const data = await confirmTemplate(body);
      router.push(`/templates/${data.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setConfirmError(
            `A template already exists for those identifiers (document type / country ISO / edition). ` +
              `Edit the fields below and try again, or ask an admin to remove the existing template first.`,
          );
        } else if (err.status === 410) {
          setConfirmError(
            `The generation session has expired. Please go back to step 1 and upload the image again.`,
          );
        } else {
          setConfirmError(err.message);
        }
      } else {
        setConfirmError("Unexpected error while saving the template.");
      }
    } finally {
      setConfirming(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className={[
        "mx-auto px-4 py-10 space-y-8",
        step === 1 || step === 2 ? "max-w-5xl" : "max-w-2xl",
      ].join(" ")}
    >
      <div>
        <h1 className="text-2xl font-semibold text-brand-gray dark:text-foreground">
          New template
        </h1>
        <p className="mt-1 text-sm text-brand-gray/60 dark:text-foreground/60">
          Upload a reference image, pair OCR lines as label / value fields, then
          confirm.
        </p>
      </div>

      <StepBar current={step} />

      {/* ------------------------------------------------------------------ */}
      {/* Step 0 — Upload                                                      */}
      {/* ------------------------------------------------------------------ */}
      {step === 0 && (
        <section className="space-y-4">
          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) =>
              e.key === "Enter" && fileInputRef.current?.click()
            }
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const dropped = e.dataTransfer.files[0];
              if (dropped) setFile(dropped);
            }}
            className={[
              "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed",
              "cursor-pointer px-6 py-12 text-center transition-colors",
              dragOver
                ? "border-brand-blue bg-brand-surface dark:bg-brand-blue/20"
                : file
                  ? "border-brand-blue/50 bg-brand-surface dark:border-brand-blue/40 dark:bg-brand-blue/10"
                  : "border-brand-silver bg-white hover:border-brand-blue/50 hover:bg-brand-surface dark:border-blue/10 dark:bg-white/5 dark:hover:border-brand-blue/40",
            ].join(" ")}
          >
            {file ? (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-8 w-8 text-brand-blue"
                  aria-hidden
                >
                  <path
                    d="M4 4h16v16H4z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8 12l3 3 5-5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p className="text-sm font-medium text-brand-blue-dark dark:text-brand-blue">
                  {file.name}
                </p>
                <p className="text-xs text-brand-gray/40 dark:text-foreground/40">
                  {(file.size / 1024).toFixed(0)} KB · Click to change
                </p>
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-8 w-8 text-brand-gray/30 dark:text-foreground/30"
                  aria-hidden
                >
                  <path
                    d="M12 16V8M9 11l3-3 3 3"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <rect
                    x="3"
                    y="3"
                    width="18"
                    height="18"
                    rx="3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
                <p className="text-sm text-brand-black dark:text-foreground">
                  Drag an image or{" "}
                  <span className="text-brand-blue underline">
                    select a file
                  </span>
                </p>
                <p className="text-xs text-brand-gray/40 dark:text-foreground/40">
                  PNG, JPG, JPEG or PDF · max. 10 MB
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.pdf"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
            }}
          />

          {generateError && (
            <p className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
              {generateError}
            </p>
          )}

          <button
            type="button"
            disabled={!file || generating}
            onClick={handleGenerate}
            className={[
              "w-full rounded-lg py-2.5 text-sm font-medium text-white transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1",
              !file || generating
                ? "bg-brand-silver text-brand-gray/40 cursor-not-allowed dark:bg-white/10 dark:text-foreground/40"
                : "bg-brand-blue hover:bg-brand-blue-dark",
            ].join(" ")}
          >
            {generating ? "Processing image…" : "Detect fields"}
          </button>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 1 — Pair OCR lines as label / value                             */}
      {/* ------------------------------------------------------------------ */}
      {step === 1 && generate && preprocessedImageUrl && (
        <section className="space-y-6">
          {/* Preclass info banner */}
          {(generate.preclass.doc_family ||
            generate.preclass.country_iso ||
            generate.preclass.mrz_type) && (
            <div className="rounded-lg border border-brand-silver bg-brand-surface px-4 py-3 text-sm text-brand-gray/70 flex flex-wrap gap-x-4 gap-y-1 dark:border-blue/10 dark:bg-white/5 dark:text-foreground/70">
              {generate.preclass.doc_family && (
                <span>
                  Family:{" "}
                  <strong className="text-brand-gray dark:text-foreground">
                    {generate.preclass.doc_family}
                  </strong>
                </span>
              )}
              {generate.preclass.country_iso && (
                <span>
                  Country ISO:{" "}
                  <strong className="text-brand-gray dark:text-foreground">
                    {generate.preclass.country_iso}
                  </strong>
                </span>
              )}
              {generate.preclass.mrz_type && (
                <span>
                  MRZ:{" "}
                  <strong className="text-brand-gray dark:text-foreground">
                    {generate.preclass.mrz_type}
                  </strong>
                </span>
              )}
              {generate.preclass.confidence != null && (
                <span>
                  Confidence:{" "}
                  <strong className="text-brand-gray dark:text-foreground">
                    {(generate.preclass.confidence * 100).toFixed(0)}%
                  </strong>
                </span>
              )}
              {generate.expires_at && expiryCountdown && (
                <span>
                  Session expires in:{" "}
                  <strong
                    className={
                      expiryCountdown === "Expired" ||
                      parseInt(expiryCountdown) < 5
                        ? "text-red-600 dark:text-red-400"
                        : "text-brand-gray dark:text-foreground"
                    }
                  >
                    {expiryCountdown}
                  </strong>
                </span>
              )}
            </div>
          )}

          <ManualFieldMapper
            imageUrl={preprocessedImageUrl}
            ocrLines={generate.ocr_lines}
            onFieldsChange={setManualFields}
            onAnchorsChange={setManualAnchors}
            onImageRegionsChange={setManualImageRegions}
          />

          {/* Summary + navigation */}
          <div className="flex items-center justify-between border-t border-brand-silver/50 pt-4 dark:border-blue/10">
            <p className="text-sm text-brand-gray/60 dark:text-foreground/60">
              <span className="font-medium text-brand-gray dark:text-foreground">
                {manualFields.length}
              </span>{" "}
              field{manualFields.length !== 1 ? "s" : ""} mapped
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleBackToUpload}
                className="rounded-lg px-4 py-2 text-sm text-brand-gray/60 hover:text-brand-blue-dark transition-colors dark:text-foreground/60 dark:hover:text-foreground"
              >
                Back
              </button>
              <button
                type="button"
                disabled={manualFields.length === 0}
                onClick={handleAdvanceToPreview}
                className={[
                  "rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors",
                  "focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1",
                  manualFields.length === 0
                    ? "bg-brand-silver text-brand-gray/40 cursor-not-allowed dark:bg-white/10 dark:text-foreground/40"
                    : "bg-brand-blue hover:bg-brand-blue-dark",
                ].join(" ")}
              >
                Continue
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 2 — Region preview                                              */}
      {/* ------------------------------------------------------------------ */}
      {step === 2 && generate && preprocessedImageUrl && (
        <section className="space-y-6">
          <p className="text-sm text-brand-gray/60 dark:text-foreground/60">
            Review the mapped regions below.{" "}
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-blue-400 bg-blue-300/30" />
              <span>Blue = label</span>
            </span>
            {" · "}
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-emerald-400 bg-emerald-300/30" />
              <span>Green = value</span>
            </span>
            {" · "}
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm border-2 border-dashed border-violet-500 bg-violet-300/20" />
              <span>Violet = photo</span>
            </span>
            . Go back if something is wrong, or confirm to continue.
          </p>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,300px)]">
            {/* Image with overlays */}
            <div className="relative inline-block w-full select-none">
              <img
                src={preprocessedImageUrl}
                alt="Region preview"
                className="block w-full rounded-lg border border-brand-silver shadow-sm dark:border-blue/10"
                draggable={false}
              />
              {manualFields.map((f) => {
                const lRect = enclosingRect(
                  f.label_element_ids ?? [],
                  generate.ocr_lines,
                );
                const vRect = enclosingRect(
                  f.value_element_ids ?? [],
                  generate.ocr_lines,
                );
                const sameRegion =
                  JSON.stringify(lRect) === JSON.stringify(vRect);
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
                          backgroundColor: "rgba(74,144,217,0.18)",
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
                            color: "#1d4ed8",
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
                          backgroundColor: "rgba(92,184,92,0.18)",
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
                            color: "#166534",
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
                  </Fragment>
                );
              })}

              {/* Image region overlays */}
              {manualImageRegions.map((r, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: `${r.x1 * 100}%`,
                    top: `${r.y1 * 100}%`,
                    width: `${(r.x2 - r.x1) * 100}%`,
                    height: `${(r.y2 - r.y1) * 100}%`,
                    border: "2px dashed #8b5cf6",
                    backgroundColor: "rgba(139,92,246,0.10)",
                    borderRadius: "3px",
                    pointerEvents: "none",
                  }}
                />
              ))}
            </div>

            {/* Field list + anchors + image regions */}
            <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray/60 dark:text-foreground/60">
                Fields ({manualFields.length})
              </p>
              <ul className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
                {manualFields.map((f) => {
                  const isLabelless =
                    (f.label_element_ids ?? []).join(",") ===
                    (f.value_element_ids ?? []).join(",");
                  return (
                    <li
                      key={f.key}
                      className="rounded-lg border border-brand-silver bg-white px-3 py-2 dark:border-blue/10 dark:bg-white/5"
                    >
                      <span className="text-sm font-medium text-brand-gray dark:text-foreground">
                        {f.label}
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-xs text-brand-gray/40 dark:text-foreground/40">
                          {f.key}
                        </span>
                        {isLabelless && (
                          <span className="rounded bg-blue-100 px-1 py-0.5 text-xs text-blue-700 dark:bg-blue-750/30 dark:text-blue-400">
                            no label
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {manualAnchors.length > 0 && (
                <div className="pt-2 space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-gray/60 dark:text-foreground/60">
                    Anchors ({manualAnchors.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {manualAnchors.map((text, i) => (
                      <span
                        key={i}
                        className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-200/30 dark:text-amber-500"
                      >
                        {text}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {manualImageRegions.length > 0 && (
                <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-brand-gray/60 dark:text-foreground/60">
                  Photo regions:{" "}
                  <span className="font-bold text-brand-purple dark:text-brand-purple">
                    {manualImageRegions.length}
                  </span>
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-between border-t border-brand-silver/50 pt-4 dark:border-blue/10">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg px-4 py-2 text-sm text-brand-gray/60 hover:text-brand-blue-dark transition-colors dark:text-foreground/60 dark:hover:text-foreground"
            >
              ← Back to mapping
            </button>
            <button
              type="button"
              onClick={handleAdvanceToMeta}
              className="rounded-lg bg-brand-blue px-6 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1"
            >
              Regions look correct →
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 3 — Metadata + confirm                                          */}
      {/* ------------------------------------------------------------------ */}
      {step === 3 && (
        <section className="space-y-5">
          <p className="text-sm text-brand-gray/60 dark:text-foreground">
            Fill in the template details. The <strong>type</strong>,{" "}
            <strong>edition</strong>, and <strong>country ISO</strong> form the
            unique identifier on the server.
          </p>

          <div className="grid grid-cols-2 gap-4">
            {/* document_type */}
            <Field
              label="Document type"
              hint="snake_case, e.g. visa_ind"
              error={metaErrors.documentType}
            >
              <input
                value={meta.documentType}
                onChange={(e) =>
                  setMeta((p) => ({ ...p, documentType: e.target.value }))
                }
                placeholder="visa_ind"
                className={inputCls(!!metaErrors.documentType)}
              />
            </Field>

            {/* document_name */}
            <Field label="Document name" error={metaErrors.documentName}>
              <input
                value={meta.documentName}
                onChange={(e) =>
                  setMeta((p) => ({ ...p, documentName: e.target.value }))
                }
                placeholder="India Visa (MRV-A)"
                className={inputCls(!!metaErrors.documentName)}
              />
            </Field>

            {/* country */}
            <Field label="Country" hint="optional">
              <input
                value={meta.country}
                onChange={(e) =>
                  setMeta((p) => ({ ...p, country: e.target.value }))
                }
                placeholder="India"
                className={inputCls(false)}
              />
            </Field>

            {/* country_iso */}
            <Field
              label="Country ISO"
              hint="3 uppercase letters (ISO alpha-3)"
              error={metaErrors.countryIso}
            >
              <input
                value={meta.countryIso}
                onChange={(e) =>
                  setMeta((p) => ({
                    ...p,
                    countryIso: e.target.value.toUpperCase(),
                  }))
                }
                placeholder="IND"
                maxLength={3}
                className={inputCls(!!metaErrors.countryIso)}
              />
            </Field>

            {/* edition */}
            <Field label="Edition (year)" error={metaErrors.edition}>
              <input
                type="number"
                value={meta.edition}
                onChange={(e) =>
                  setMeta((p) => ({ ...p, edition: e.target.value }))
                }
                placeholder="2026"
                min={1900}
                max={2100}
                className={inputCls(!!metaErrors.edition)}
              />
            </Field>
          </div>

          {/* Summary (read-only) */}
          <div className="rounded-lg border border-brand-silver bg-brand-surface px-4 py-3 space-y-3 dark:border-blue/10 dark:bg-white/5">
            <div className="space-y-1">
              <p className="text-xs font-medium text-brand-gray/60 uppercase tracking-wide dark:text-foreground/60">
                Fields to save ({manualFields.length})
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {manualFields.map((f) => (
                  <span
                    key={f.key}
                    className="rounded-md bg-white border border-brand-blue px-2 py-0.5 font-mono text-xs text-brand-gray dark:border-blue/15 dark:bg-white/10 dark:text-foreground/70"
                  >
                    {f.key}
                  </span>
                ))}
              </div>
            </div>

            {manualAnchors.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-brand-gray/60 uppercase tracking-wide dark:text-foreground/60">
                  Anchors ({manualAnchors.length})
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {manualAnchors.map((text, i) => (
                    <span
                      key={i}
                      className="rounded-md border border-amber-200 px-2 py-0.5 text-xs font-medium text-brand-gray/60 dark:border-amber-500/40 dark:text-brand-gray/60"
                    >
                      {text}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {manualImageRegions.length > 0 && (
              <p className="text-xs font-medium text-brand-gray/60 dark:text-foreground/60">
                Photo regions:{" "}
                <span className="font-semibold text-brand-purple dark:text-brand-purple">
                  {manualImageRegions.length}
                </span>
              </p>
            )}
          </div>

          {confirmError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30">
              <p className="text-sm text-red-600 dark:text-red-400">
                {confirmError}
              </p>
            </div>
          )}

          <div className="flex justify-between border-t border-brand-silver/50 pt-4 dark:border-blue/10">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg px-4 py-2 text-sm text-brand-gray/60 hover:text-brand-blue-dark transition-colors dark:text-foreground/60 dark:hover:text-foreground"
            >
              Back
            </button>
            <button
              type="button"
              disabled={confirming}
              onClick={handleConfirm}
              className={[
                "rounded-lg px-6 py-2 text-sm font-medium text-white transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1",
                confirming
                  ? "bg-brand-silver text-brand-gray/40 cursor-not-allowed dark:bg-white/10 dark:text-foreground/40"
                  : "bg-brand-blue hover:bg-brand-blue-dark",
              ].join(" ")}
            >
              {confirming ? "Saving…" : "Save template"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mini field wrapper (label + optional hint + error)
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-brand-gray/70 dark:text-foreground/70">
        {label}
        {hint && (
          <span className="ml-1 font-normal text-brand-gray/40 dark:text-foreground/40">
            ({hint})
          </span>
        )}
      </label>
      {children}
      {error && (
        <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

function inputCls(hasError: boolean) {
  return [
    "w-full rounded-md border px-3 py-1.5 text-sm",
    "text-brand-gray placeholder:text-brand-gray/40 dark:text-foreground dark:placeholder:text-foreground/40",
    "focus:outline-none focus:ring-2 focus:ring-brand-blue",
    hasError
      ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
      : "border-brand-silver bg-white dark:border-blue/15 dark:bg-white/5",
  ].join(" ");
}
