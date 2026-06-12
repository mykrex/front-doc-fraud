"use client";

// =============================================================================
// Verify page — POST /v1/verify.
// Uploads one or more document pages, runs the fraud detection pipeline, and
// renders the verdict, key metrics, flags, and the raw response.
// Pipeline: metadata → tampering → preprocessor → ocr → policy.
// =============================================================================

import { useRef, useState } from "react";

import { verifyDocument, ApiError } from "@/lib/api";
import type { BaseVerifyResponse } from "@/lib/types";
import VerdictBadge from "@/components/VerdictBadge";
import Spinner from "@/components/ui/Spinner";
import ErrorMessage from "@/components/ui/ErrorMessage";

const ACCEPTED = ".png,.jpg,.jpeg,.pdf";

export default function VerifyPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [id, setId] = useState("");
  const [documentType, setDocumentType] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BaseVerifyResponse | null>(null);

  const canSubmit = files.length > 0 && id.trim() !== "" && !loading;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await verifyDocument({
        documentImages: files,
        id: id.trim(),
        documentType: documentType.trim() || undefined,
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed.");
    } finally {
      setLoading(false);
    }
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Verify document
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Pipeline: metadata → tampering → preprocessor → ocr → policy.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {/* File picker */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Document images <span className="text-red-500">*</span>
          </label>
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) =>
              e.key === "Enter" && fileInputRef.current?.click()
            }
            className="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-black/[.12] px-6 py-8 text-center transition-colors hover:border-black/[.3] dark:border-white/[.145] dark:hover:border-white/[.3]"
          >
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Click to select one or more pages
            </p>
            <p className="text-xs text-zinc-400">PNG, JPG, JPEG or PDF</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            className="sr-only"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length) setFiles((prev) => [...prev, ...picked]);
              e.target.value = ""; // allow re-picking the same file
            }}
          />

          {files.length > 0 ? (
            <ul className="space-y-1.5 pt-1">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between rounded-lg border border-black/[.08] px-3 py-2 text-sm dark:border-white/[.145]"
                >
                  <span className="truncate text-zinc-700 dark:text-zinc-300">
                    {f.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-3 pl-3">
                    <span className="text-xs text-zinc-400">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      aria-label={`Remove ${f.name}`}
                      className="text-zinc-400 transition-colors hover:text-red-500"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* id + document_type */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              ID <span className="text-red-500">*</span>
            </span>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="request or document id"
              className="h-9 rounded-md border border-black/[.12] bg-white px-3 text-sm outline-none focus:border-black/[.3] dark:border-white/[.145] dark:bg-black dark:focus:border-white/[.3]"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Document type{" "}
              <span className="font-normal text-zinc-400">(optional)</span>
            </span>
            <input
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              placeholder="e.g. passport"
              className="h-9 rounded-md border border-black/[.12] bg-white px-3 text-sm outline-none focus:border-black/[.3] dark:border-white/[.145] dark:bg-black dark:focus:border-white/[.3]"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-10 items-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Verifying…" : "Verify"}
        </button>
      </form>

      {/* Result area */}
      <div className="mt-8">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner
              size="lg"
              label="Running pipeline… this can take a while on the first call."
            />
          </div>
        ) : error ? (
          <ErrorMessage title="Verification failed" message={error} />
        ) : result ? (
          <VerifyResult result={result} />
        ) : null}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Result view
// ---------------------------------------------------------------------------

function VerifyResult({ result }: { result: BaseVerifyResponse }) {
  return (
    <section className="space-y-6">
      {/* Verdict + metrics */}
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-black/[.08] p-5 dark:border-white/[.145]">
        <VerdictBadge verdict={result.verdict} size="lg" />
        <Metric
          label="Tampering score"
          value={result.tampering_score.toFixed(4)}
        />
        <Metric label="Confidence" value={result.confidence.toFixed(4)} />
      </div>

      {/* Flags */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          Flags ({result.flags.length})
        </h2>
        {result.flags.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No flags raised.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {result.flags.map((flag) => (
              <span
                key={flag}
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
              >
                {flag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Raw response */}
      <details className="rounded-lg border border-black/[.08] dark:border-white/[.145]">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Raw response
        </summary>
        <pre className="overflow-x-auto border-t border-black/[.06] px-4 py-3 font-mono text-xs text-zinc-600 dark:border-white/[.08] dark:text-zinc-400">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <span className="font-mono text-lg text-black dark:text-zinc-100">
        {value}
      </span>
    </div>
  );
}
