"use client";

// =============================================================================
// Full generate → review → confirm flow.
//
// Steps:
//   1. Upload a reference image  → POST /v1/templates/generate (mode="auto")
//   2. Review suggestions list + add manual fields
//   3. Fill in template metadata
//   4. Confirm                   → POST /v1/templates/confirm
// =============================================================================

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { generateTemplate, confirmTemplate, ApiError } from "@/lib/api";
import { SuggestionList } from "@/components/SuggestionList";
import { AddFieldForm } from "@/components/AddFieldForm";
import type {
  GenerateResponse,
  TemplateField,
  ConfirmTemplateRequest,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS = ["Upload image", "Review fields", "Confirm"] as const;

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
                      ? "border-indigo-600 bg-white text-indigo-600"
                      : "border-slate-200 bg-white text-slate-400",
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
                  active ? "text-indigo-700 font-medium" : "text-slate-400",
                ].join(" ")}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={[
                  "mx-3 mb-4 h-px w-12 transition-colors",
                  done ? "bg-indigo-400" : "bg-slate-200",
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
// Validation helpers  (mirrors server rules)
// ---------------------------------------------------------------------------

const DOC_TYPE_RE = /^[a-z0-9_]{1,60}$/;
const COUNTRY_ISO_RE = /^[A-Z]{3}$/;

interface MetaErrors {
  documentType?: string;
  documentName?: string;
  countryIso?: string;
  edition?: string;
  fields?: string;
}

function validateMeta(meta: MetaForm): MetaErrors {
  const e: MetaErrors = {};
  if (!DOC_TYPE_RE.test(meta.documentType))
    e.documentType =
      "Lowercase letters, digits, and underscores only (1–60 characters).";
  if (!meta.documentName.trim())
    e.documentName = "Document name is required.";
  if (meta.countryIso && !COUNTRY_ISO_RE.test(meta.countryIso))
    e.countryIso = "Must be exactly 3 uppercase letters (ISO alpha-3).";
  const edition = Number(meta.edition);
  if (!meta.edition || isNaN(edition) || edition < 1900 || edition > 2100)
    e.edition = "Year between 1900 and 2100.";
  return e;
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

  // Step 1 – review
  const [generate, setGenerate] = useState<GenerateResponse | null>(null);
  const [accepted, setAccepted] = useState<TemplateField[]>([]);
  const [manual, setManual] = useState<TemplateField[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Step 2 – confirm
  const [meta, setMeta] = useState<MetaForm>(EMPTY_META);
  const [metaErrors, setMetaErrors] = useState<MetaErrors>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // All fields in scope for the confirm call (accepted suggestions + manual)
  const allFields: TemplateField[] = [...accepted, ...manual];

  // Existing keys — prevents duplicates in AddFieldForm
  const existingKeys = allFields.map((f) => f.key);

  // -------------------------------------------------------------------------
  // Step 0 → 1: generate
  // -------------------------------------------------------------------------

  async function handleGenerate() {
    if (!file) return;
    setGenerating(true);
    setGenerateError(null);

    try {
      const data = await generateTemplate({ image: file, mode: "auto" });
      setGenerate(data);
      setStep(1);
    } catch (err) {
      if (err instanceof ApiError) setGenerateError(err.message);
      else setGenerateError("Unexpected error.");
    } finally {
      setGenerating(false);
    }
  }

  // -------------------------------------------------------------------------
  // Step 1 → 2: advance after reviewing fields
  // -------------------------------------------------------------------------

  function handleAdvanceToMeta() {
    if (allFields.length === 0) return; // guard — button is disabled anyway
    // Pre-fill document_type from preclass if available
    if (generate?.preclass?.doc_family && !meta.documentType) {
      setMeta((prev) => ({
        ...prev,
        documentType: generate.preclass.doc_family?.replace(/-/g, "_") ?? "",
        countryIso: generate.preclass.country_iso ?? "",
      }));
    }
    setStep(2);
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
      fields: allFields,
      anchors: generate.anchors_candidates,
      qr_config: generate.qr_config,
    };

    setConfirming(true);
    setConfirmError(null);

    try {
      const data = await confirmTemplate(body);
      router.push(`/templates/${data.id}`);
    } catch (err) {
      if (err instanceof ApiError) setConfirmError(err.message);
      else setConfirmError("Unexpected error while saving the template.");
    } finally {
      setConfirming(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          New template
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Upload a reference image, review the detected fields, and confirm.
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
                ? "border-indigo-400 bg-indigo-50"
                : file
                  ? "border-indigo-300 bg-indigo-50/50"
                  : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
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
                <p className="text-sm font-medium text-indigo-700">
                  {file.name}
                </p>
                <p className="text-xs text-slate-400">
                  {(file.size / 1024).toFixed(0)} KB · Click to change
                </p>
              </>
            ) : (
              <>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-8 w-8 text-slate-300"
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
                <p className="text-sm text-slate-500">
                  Drag an image or{" "}
                  <span className="text-indigo-600 underline">
                    select a file
                  </span>
                </p>
                <p className="text-xs text-slate-400">
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
            <p className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-600">
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
                ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                : "bg-indigo-600 hover:bg-indigo-700",
            ].join(" ")}
          >
            {generating ? "Processing image…" : "Detect fields"}
          </button>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 1 — Review suggestions + manual fields                          */}
      {/* ------------------------------------------------------------------ */}
      {step === 1 && generate && (
        <section className="space-y-6">
          {/* Preclass info banner */}
          {generate.preclass.doc_family && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Family:{" "}
                <strong className="text-slate-800">
                  {generate.preclass.doc_family}
                </strong>
              </span>
              {generate.preclass.country_iso && (
                <span>
                  Country ISO:{" "}
                  <strong className="text-slate-800">
                    {generate.preclass.country_iso}
                  </strong>
                </span>
              )}
              {generate.preclass.mrz_type && (
                <span>
                  MRZ:{" "}
                  <strong className="text-slate-800">
                    {generate.preclass.mrz_type}
                  </strong>
                </span>
              )}
              {generate.preclass.confidence != null && (
                <span>
                  Confidence:{" "}
                  <strong className="text-slate-800">
                    {(generate.preclass.confidence * 100).toFixed(0)}%
                  </strong>
                </span>
              )}
            </div>
          )}

          {/* Suggestions */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
              Detected suggestions
            </h2>
            <SuggestionList
              suggestions={generate.suggestions}
              onSelectionChange={setAccepted}
            />
          </div>

          {/* Manual fields list */}
          {manual.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                Manual fields
              </h2>
              <ul className="space-y-1.5">
                {manual.map((f) => (
                  <li
                    key={f.key}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2.5"
                  >
                    <div>
                      <span className="text-sm font-medium text-slate-800">
                        {f.label}
                      </span>
                      <span className="ml-2 font-mono text-xs text-slate-400">
                        {f.key}
                      </span>
                      <span className="ml-2 text-xs text-slate-400">
                        · {f.type}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setManual((prev) => prev.filter((x) => x.key !== f.key))
                      }
                      className="ml-4 text-slate-300 hover:text-red-400 transition-colors"
                      aria-label={`Remove field ${f.key}`}
                    >
                      <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4">
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

          {/* Add field form */}
          <AddFieldForm
            existingKeys={existingKeys}
            onAdd={(f) => setManual((prev) => [...prev, f])}
          />

          {/* Summary + advance */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-500">
              <span className="font-medium text-slate-700">
                {allFields.length}
              </span>{" "}
              field
              {allFields.length !== 1 ? "s" : ""} total
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                disabled={allFields.length === 0}
                onClick={handleAdvanceToMeta}
                className={[
                  "rounded-lg px-5 py-2 text-sm font-medium text-white transition-colors",
                  "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1",
                  allFields.length === 0
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed"
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
      {/* Step 2 — Metadata + confirm                                          */}
      {/* ------------------------------------------------------------------ */}
      {step === 2 && (
        <section className="space-y-5">
          <p className="text-sm text-slate-500">
            Fill in the template details. The <strong>type</strong>,{" "}
            <strong>edition</strong>, and <strong>country ISO</strong> form the
            unique identifier on the server.
          </p>

          <div className="grid grid-cols-2 gap-4">
            {/* document_type */}
            <Field
              label="Document type"
              hint="snake_case, e.g. passport"
              error={metaErrors.documentType}
            >
              <input
                value={meta.documentType}
                onChange={(e) =>
                  setMeta((p) => ({ ...p, documentType: e.target.value }))
                }
                placeholder="passport"
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
                placeholder="Mexican Passport"
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
                placeholder="Mexico"
                className={inputCls(false)}
              />
            </Field>

            {/* country_iso */}
            <Field
              label="Country ISO"
              hint="3 uppercase letters, optional"
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
                placeholder="MEX"
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
                placeholder="2024"
                min={1900}
                max={2100}
                className={inputCls(!!metaErrors.edition)}
              />
            </Field>
          </div>

          {/* Fields summary (read-only) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Fields to save ({allFields.length})
            </p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {allFields.map((f) => (
                <span
                  key={f.key}
                  className="rounded-md bg-white border border-slate-200 px-2 py-0.5 font-mono text-xs text-slate-600"
                >
                  {f.key}
                </span>
              ))}
            </div>
          </div>

          {confirmError && (
            <p className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-600">
              {confirmError}
            </p>
          )}

          <div className="flex justify-between border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
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
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
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
      <label className="text-xs font-medium text-slate-600">
        {label}
        {hint && (
          <span className="ml-1 font-normal text-slate-400">({hint})</span>
        )}
      </label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function inputCls(hasError: boolean) {
  return [
    "w-full rounded-md border px-3 py-1.5 text-sm",
    "focus:outline-none focus:ring-2 focus:ring-indigo-500",
    hasError ? "border-red-300 bg-red-50" : "border-slate-200 bg-white",
  ].join(" ");
}
