"use client";

// =============================================================================
// Verify result page — structured report view.
// Reads the result stored in sessionStorage by /verify and displays it.
// Redirects back to /verify if no result is found (e.g. direct navigation).
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { getTamperingOverlayUrl } from "@/lib/api";
import type { BaseVerifyResponse } from "@/lib/types";
import VerdictBadge from "@/components/VerdictBadge";
import Spinner from "@/components/ui/Spinner";

const STORAGE_KEY = "docfraud:verify_result";

type StoredResult = { result: BaseVerifyResponse; id: string };

// Detailed shapes the backend actually returns (types.ts keeps these loose)
interface MetadataPage {
  summary?: string;
  flags?: string[];
  suspicion_score?: number;
}
interface TamperingPageFull {
  risk_label?: string;
  fraud_score?: number;
  overlay_filename?: string | null;
}
interface OCRPageFull {
  page_number?: number;
  document_type?: string;
  fields?: Record<string, string | null>;
  flags?: string[];
}
interface ConsistencyVerification {
  consistency?: boolean;
  identity_inconsistencies?: string[];
  mrz_inconsistencies?: string[];
}

export default function VerifyResultPage() {
  const router = useRouter();
  const [stored, setStored] = useState<StoredResult | null | "loading">(
    "loading",
  );

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      router.replace("/verify");
      return;
    }
    try {
      setStored(JSON.parse(raw) as StoredResult);
    } catch {
      router.replace("/verify");
    }
  }, [router]);

  if (stored === "loading") {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="flex justify-center py-12">
          <Spinner size="lg" label="Loading result…" />
        </div>
      </main>
    );
  }

  if (!stored) return null;

  const { result, id } = stored;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-brand-gray dark:text-foreground">
            Verification Report
          </h1>
        </div>
        <Link
          href="/verify"
          className="inline-flex h-9 items-center rounded-full border border-brand-silver px-4 text-sm text-brand-gray/70 transition-colors hover:border-brand-blue hover:text-brand-blue dark:border-blue/10 dark:text-foreground/70 dark:hover:border-brand-blue dark:hover:text-brand-blue"
        >
          ← Verify another
        </Link>
      </div>

      <VerifyReport result={result} verifyId={id} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Top-level report
// ---------------------------------------------------------------------------

function VerifyReport({
  result,
  verifyId,
}: {
  result: BaseVerifyResponse;
  verifyId: string;
}) {
  const rawModules = result.modules as unknown as Record<string, unknown>;

  const metadataPages: MetadataPage[] =
    (rawModules?.metadata as { pages?: MetadataPage[] })?.pages ?? [];

  const tamperingPages: TamperingPageFull[] =
    (rawModules?.tampering as { pages?: TamperingPageFull[] })?.pages ?? [];

  const ocrModule = rawModules?.ocr as
    | {
        pages?: OCRPageFull[];
        consistency_verification?: ConsistencyVerification;
      }
    | undefined;
  const ocrPages: OCRPageFull[] = ocrModule?.pages ?? [];
  const consistency: ConsistencyVerification | undefined =
    ocrModule?.consistency_verification;

  return (
    <section className="space-y-5">
      {/* 1 — Summary */}
      <ReportCard title="Summary">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <VerdictBadge verdict={result.verdict} size="lg" />
          <ScorePill
            label="Risk Score"
            value={result.risk_score ?? null}
            colorize
          />
          <ScorePill label="Confidence" value={result.confidence} />
        </div>
        {result.flags.length > 0 && (
          <div className="mt-4">
            <FlagList flags={result.flags} />
          </div>
        )}
        {result.flags.length === 0 && (
          <p className="mt-3 text-sm text-brand-gray/40 dark:text-foreground/40">
            No flags raised.
          </p>
        )}
      </ReportCard>

      {/* 2 — Metadata */}
      {metadataPages.length > 0 && (
        <ReportCard title="Metadata" defaultOpen={false}>
          <div className="space-y-3">
            {metadataPages.map((page, i) => (
              <div key={i}>
                {page.summary && (
                  <p className="text-sm text-brand-gray/80 dark:text-foreground/80">
                    {page.summary}
                  </p>
                )}
                {page.flags && page.flags.length > 0 ? (
                  <div className="mt-2">
                    <FlagList flags={page.flags} />
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-brand-gray/40 dark:text-foreground/40">
                    No flags.
                  </p>
                )}
              </div>
            ))}
          </div>
        </ReportCard>
      )}

      {/* 3 — Tampering */}
      {tamperingPages.length > 0 && (
        <ReportCard title="Tampering Analysis" defaultOpen={false}>
          <div className="space-y-6">
            {tamperingPages.map((page, i) => (
              <TamperingCard
                key={i}
                page={page}
                pageNumber={i + 1}
                verifyId={verifyId}
              />
            ))}
          </div>
        </ReportCard>
      )}

      {/* 4 — OCR / Extracted Fields */}
      {ocrPages.length > 0 && (
        <ReportCard title="Extracted Document Fields" defaultOpen={false}>
          <div className="space-y-6">
            {ocrPages.map((page, i) => (
              <OCRPageCard key={i} page={page} pageNumber={i + 1} />
            ))}
          </div>
        </ReportCard>
      )}

      {/* 5 — Consistency */}
      {consistency && (
        <ReportCard title="Consistency Verification" defaultOpen={false}>
          <ConsistencyCard cv={consistency} />
        </ReportCard>
      )}

      {/* Raw response */}
      <details className="group rounded-xl border border-brand-silver dark:border-blue/10">
        <summary className="flex cursor-pointer list-none select-none items-center justify-between px-5 py-4 hover:bg-brand-surface dark:hover:bg-white/[.03] [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-semibold uppercase tracking-wide text-brand-blue-dark dark:text-brand-blue">
            Raw JSON response
          </span>
          <svg
            className="h-4 w-4 shrink-0 text-brand-gray/40 transition-transform duration-200 group-open:rotate-180 dark:text-foreground/40"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </summary>
        <pre className="overflow-x-auto border-t border-brand-silver/50 px-4 py-3 font-mono text-xs text-brand-gray/70 dark:border-blue/[.06] dark:text-foreground/60">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tampering page card (metrics + overlay image)
// ---------------------------------------------------------------------------

function TamperingCard({
  page,
  pageNumber,
  verifyId,
}: {
  page: TamperingPageFull;
  pageNumber: number;
  verifyId: string;
}) {
  const [imgError, setImgError] = useState(false);
  const overlayUrl = page.overlay_filename
    ? getTamperingOverlayUrl(verifyId, page.overlay_filename)
    : null;

  return (
    <div className="space-y-4">
      {/* Metrics row */}
      <div className="flex flex-wrap gap-3">
        {page.risk_label && <RiskLabelBadge label={page.risk_label} />}
        {page.fraud_score != null && (
          <ScorePill label="Fraud Score" value={page.fraud_score} colorize />
        )}
      </div>

      {/* Overlay image */}
      {overlayUrl && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-brand-gray/40 dark:text-foreground/40">
            Tampering heatmap — page {pageNumber}
          </p>
          {imgError ? (
            <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-brand-silver text-sm text-brand-gray/40 dark:border-blue/10 dark:text-foreground/40">
              Overlay image unavailable
            </div>
          ) : (
            <img
              src={overlayUrl}
              alt={`Tampering overlay page ${pageNumber}`}
              onError={() => setImgError(true)}
              className="max-w-full rounded-lg"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OCR page card
// ---------------------------------------------------------------------------

function OCRPageCard({ page }: { page: OCRPageFull; pageNumber: number }) {
  const fields = page.fields ?? {};
  const entries = Object.entries(fields).filter(
    ([, v]) => v != null && v !== "",
  );

  return (
    <div className="space-y-3">
      {/* Header info */}
      <div className="flex flex-wrap gap-3 text-sm">
        {page.document_type && (
          <span className="rounded-full bg-brand-silver/50 px-3 py-0.5 font-medium capitalize text-brand-gray dark:bg-white/10 dark:text-foreground">
            {page.document_type}
          </span>
        )}
      </div>

      {/* Fields table */}
      {entries.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-brand-silver dark:border-blue/10">
          <table className="w-full text-sm">
            <tbody>
              {entries.map(([key, value], i) => (
                <tr
                  key={key}
                  className={
                    i % 2 === 0
                      ? "bg-brand-surface-alt dark:bg-white/[.04]"
                      : "bg-white dark:bg-transparent"
                  }
                >
                  <td className="w-2/5 px-4 py-2.5 font-medium text-brand-gray/70 dark:text-foreground/70">
                    {formatFieldKey(key)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-brand-gray dark:text-foreground ${
                      key === "mrz"
                        ? "break-all font-mono text-xs tracking-wide"
                        : ""
                    }`}
                  >
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Flags */}
      {page.flags && page.flags.length > 0 ? (
        <FlagList flags={page.flags} />
      ) : (
        <p className="text-sm text-brand-gray/40 dark:text-foreground/40">
          No OCR flags.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Consistency verification card
// ---------------------------------------------------------------------------

function ConsistencyCard({ cv }: { cv: ConsistencyVerification }) {
  const consistent = cv.consistency ?? false;
  const identityIssues = cv.identity_inconsistencies ?? [];
  const mrzIssues = cv.mrz_inconsistencies ?? [];
  const allClear = identityIssues.length === 0 && mrzIssues.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
            consistent
              ? "bg-green-50 text-green-700 dark:bg-green-650/50 dark:text-green-400"
              : "bg-red-50 text-red-700 dark:bg-red-650/50 dark:text-red-400"
          }`}
        >
          <span>{consistent ? "✓" : "✗"}</span>
          {consistent ? "Document is consistent" : "Inconsistencies detected"}
        </span>
      </div>

      {allClear ? (
        <p className="text-sm text-brand-gray/40 dark:text-foreground/40">
          No identity or MRZ inconsistencies found.
        </p>
      ) : (
        <div className="space-y-2">
          {identityIssues.length > 0 && (
            <IssueList
              title="Identity inconsistencies"
              items={identityIssues}
            />
          )}
          {mrzIssues.length > 0 && (
            <IssueList title="MRZ inconsistencies" items={mrzIssues} />
          )}
        </div>
      )}
    </div>
  );
}

function IssueList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-gray/60 dark:text-foreground/60">
        {title}
      </p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex gap-2 rounded-md bg-red-50 px-3 py-1.5 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400"
          >
            <span>•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function ReportCard({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-brand-silver dark:border-blue/10"
    >
      <summary className="flex cursor-pointer list-none select-none items-center justify-between px-5 py-4 hover:bg-brand-surface dark:hover:bg-white/[.03] [&::-webkit-details-marker]:hidden">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-brand-blue-dark dark:text-brand-blue">
          {icon && <span aria-hidden>{icon}</span>}
          {title}
        </h2>
        <svg
          className="h-4 w-4 shrink-0 text-brand-gray/40 transition-transform duration-200 group-open:rotate-180 dark:text-foreground/40"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </summary>
      <div className="border-t border-brand-silver/50 px-5 pb-5 pt-4 dark:border-blue/[.06]">
        {children}
      </div>
    </details>
  );
}

function ScorePill({
  label,
  value,
  colorize = false,
  green = false,
}: {
  label: string;
  value: number | null;
  colorize?: boolean;
  green?: boolean;
}) {
  if (value == null) return null;

  let color = "text-brand-gray/80 dark:text-foreground/80";
  if (green) {
    color = "text-green-700 dark:text-green-400";
  } else if (colorize) {
    if (value < 0.3) color = "text-green-700 dark:text-green-400";
    else if (value < 0.6) color = "text-amber-700 dark:text-amber-400";
    else color = "text-red-700 dark:text-red-400";
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-brand-gray/40 dark:text-foreground/40">
        {label}
      </span>
      <span className={`font-mono text-xl font-semibold ${color}`}>
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  );
}

function RiskLabelBadge({ label }: { label: string }) {
  const upper = label.toUpperCase();
  let cls =
    "bg-brand-silver/50 text-brand-gray dark:bg-white/10 dark:text-foreground";
  if (upper === "LEGITIMATE" || upper === "ACCEPT") {
    cls =
      "border border-green-400 bg-green-50 text-green-700 dark:bg-green-550/40 dark:text-green-400";
  } else if (upper === "SUSPICIOUS" || upper === "REVIEW") {
    cls =
      "border border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-550/40 dark:text-amber-400";
  } else if (upper === "TAMPERED" || upper === "FORGED" || upper === "REJECT") {
    cls =
      "border border-red-400 bg-red-50 text-red-700 dark:bg-red-550/40 dark:text-red-400";
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function ReliabilityBadge({ reliability }: { reliability: string }) {
  const upper = reliability.toUpperCase();
  let cls =
    "border-brand-silver text-brand-gray/70 dark:border-blue/10 dark:text-foreground/70";
  if (upper === "HIGH") {
    cls =
      "border-green-200 text-green-700 dark:border-green-800 dark:text-green-400";
  } else if (upper === "MEDIUM") {
    cls =
      "border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-400";
  } else if (upper === "LOW") {
    cls = "border-red-200 text-red-700 dark:border-red-800 dark:text-red-400";
  }

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${cls}`}
    >
      {reliability} reliability
    </span>
  );
}

function FlagList({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {flags.map((flag) => (
        <span
          key={flag}
          className="rounded-full border border-amber-200 bg-amber-50 px-3 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
        >
          {flag}
        </span>
      ))}
    </div>
  );
}

function formatFieldKey(key: string): string {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
