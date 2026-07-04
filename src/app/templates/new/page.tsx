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
                    ? "border-indigo-600 bg-indigo-600 text-white"
                    : active
                      ? "border-indigo-600 bg-white text-indigo-600 dark:bg-zinc-900"
                      : "border-slate-200 bg-white text-slate-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500",
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
                    ? "text-indigo-700 font-medium dark:text-indigo-300"
                    : "text-slate-400 dark:text-zinc-500",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={[
                  "mx-3 mb-4 h-px w-12 transition-colors",
                  done ? "bg-indigo-400" : "bg-slate-200 dark:bg-zinc-700",
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
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

function enclosingRect(ids: number[], lines: { id: number; bbox: number[][] }[]): Rect | null {
  const elems = ids.map((id) => lines.find((l) => l.id === id)).filter(Boolean) as { bbox: number[][] }[];
  if (!elems.length) return null;
  const pts = elems.flatMap((e) => e.bbox);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return { x1: r(Math.min(...xs)), y1: r(Math.min(...ys)), x2: r(Math.max(...xs)), y2: r(Math.max(...ys)) };
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
      anchors: [],
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
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-zinc-50">
          New template
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
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
                ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30"
                : file
                  ? "border-indigo-300 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800",
            ].join(" ")}
          >
            {file ? (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-8 w-8 text-indigo-400"
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
                <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                  {file.name}
                </p>
                <p className="text-xs text-slate-400 dark:text-zinc-500">
                  {(file.size / 1024).toFixed(0)} KB · Click to change
                </p>
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-8 w-8 text-slate-300 dark:text-zinc-600"
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
                <p className="text-sm text-slate-500 dark:text-zinc-400">
                  Drag an image or{" "}
                  <span className="text-indigo-600 underline dark:text-indigo-400">
                    select a file
                  </span>
                </p>
                <p className="text-xs text-slate-400 dark:text-zinc-500">
                  PNG, JPG or JPEG · max. 10 MB
                </p>
              </>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".png,.jpg,.jpeg"
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
              "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1",
              !file || generating
                ? "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500"
                : "bg-indigo-600 hover:bg-indigo-700",
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
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 flex flex-wrap gap-x-4 gap-y-1 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              {generate.preclass.doc_family && (
                <span>
                  Family:{" "}
                  <strong className="text-slate-800 dark:text-zinc-100">
                    {generate.preclass.doc_family}
                  </strong>
                </span>
              )}
              {generate.preclass.country_iso && (
                <span>
                  Country ISO:{" "}
                  <strong className="text-slate-800 dark:text-zinc-100">
                    {generate.preclass.country_iso}
                  </strong>
                </span>
              )}
              {generate.preclass.mrz_type && (
                <span>
                  MRZ:{" "}
                  <strong className="text-slate-800 dark:text-zinc-100">
                    {generate.preclass.mrz_type}
                  </strong>
                </span>
              )}
              {generate.preclass.confidence != null && (
                <span>
                  Confidence:{" "}
                  <strong className="text-slate-800 dark:text-zinc-100">
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
                        : "text-slate-800 dark:text-zinc-100"
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
          />

          {/* Summary + navigation */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-4 dark:border-zinc-800">
            <p className="text-sm text-slate-500 dark:text-zinc-400">
              <span className="font-medium text-slate-700 dark:text-zinc-200">
                {manualFields.length}
              </span>{" "}
              field{manualFields.length !== 1 ? "s" : ""} mapped
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleBackToUpload}
                className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800 transition-colors dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Back
              </button>
              <button
                type="button"
                disabled={manualFields.length === 0}
                onClick={handleAdvanceToPreview}
                className={[
                  "rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors",
                  "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1",
                  manualFields.length === 0
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500"
                    : "bg-indigo-600 hover:bg-indigo-700",
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
          <p className="text-sm text-slate-500 dark:text-zinc-400">
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
            . Go back if something is wrong, or confirm to continue.
          </p>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,300px)]">
            {/* Image with overlays */}
            <div className="relative inline-block w-full select-none">
              <img
                src={preprocessedImageUrl}
                alt="Region preview"
                className="block w-full rounded-lg border border-slate-200 shadow-sm dark:border-zinc-800"
                draggable={false}
              />
              {manualFields.map((f) => {
                const lRect = enclosingRect(f.label_element_ids ?? [], generate.ocr_lines);
                const vRect = enclosingRect(f.value_element_ids ?? [], generate.ocr_lines);
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
            </div>

            {/* Field list */}
            <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-zinc-400">
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
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <span className="text-sm font-medium text-slate-800 dark:text-zinc-100">
                        {f.label}
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-xs text-slate-400 dark:text-zinc-500">
                          {f.key}
                        </span>
                        {isLabelless && (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                            no label
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="flex justify-between border-t border-slate-100 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800 transition-colors dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              ← Back to mapping
            </button>
            <button
              type="button"
              onClick={handleAdvanceToMeta}
              className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
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
          <p className="text-sm text-slate-500 dark:text-zinc-400">
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

          {/* Fields summary (read-only) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 space-y-1 dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide dark:text-zinc-400">
              Fields to save ({manualFields.length})
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {manualFields.map((f) => (
                <span
                  key={f.key}
                  className="rounded-md bg-white border border-slate-200 px-2 py-0.5 font-mono text-xs text-slate-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                >
                  {f.key}
                </span>
              ))}
            </div>
          </div>

          {confirmError && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/30">
              <p className="text-sm text-red-600 dark:text-red-400">
                {confirmError}
              </p>
            </div>
          )}

          <div className="flex justify-between border-t border-slate-100 pt-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800 transition-colors dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              Back
            </button>
            <button
              type="button"
              disabled={confirming}
              onClick={handleConfirm}
              className={[
                "rounded-lg px-6 py-2 text-sm font-medium text-white transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1",
                confirming
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-500"
                  : "bg-indigo-600 hover:bg-indigo-700",
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
      <label className="text-xs font-medium text-slate-600 dark:text-zinc-300">
        {label}
        {hint && (
          <span className="ml-1 font-normal text-slate-400 dark:text-zinc-500">
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
    "text-slate-900 placeholder:text-slate-400 dark:text-zinc-100 dark:placeholder:text-zinc-500",
    "focus:outline-none focus:ring-2 focus:ring-indigo-500",
    hasError
      ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30"
      : "border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-900",
  ].join(" ");
}
