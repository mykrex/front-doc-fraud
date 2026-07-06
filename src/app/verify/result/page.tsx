"use client";

// =============================================================================
// Verify result page.
// Reads the result stored in sessionStorage by /verify and displays it.
// Redirects back to /verify if no result is found (e.g. direct navigation).
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { getTamperingOverlayUrl } from "@/lib/api";
import type { BaseVerifyResponse, TamperingPage } from "@/lib/types";
import VerdictBadge from "@/components/VerdictBadge";
import Spinner from "@/components/ui/Spinner";

const STORAGE_KEY = "docfraud:verify_result";

type StoredResult = {
  result: BaseVerifyResponse;
  id: string;
};

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
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Verification result
          </h1>
          <p className="mt-1 font-mono text-sm text-zinc-500">{id}</p>
        </div>
        <Link
          href="/verify"
          className="inline-flex h-9 items-center rounded-full border border-black/[.12] px-4 text-sm text-zinc-600 transition-colors hover:border-black/[.3] dark:border-white/[.145] dark:text-zinc-400 dark:hover:border-white/[.3]"
        >
          ← Verify another
        </Link>
      </div>

      <VerifyResult result={result} verifyId={id} />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Result view (moved from verify/page.tsx)
// ---------------------------------------------------------------------------

function VerifyResult({
  result,
  verifyId,
}: {
  result: BaseVerifyResponse;
  verifyId: string;
}) {
  return (
    <section className="space-y-6">
      {/* Verdict + metrics */}
      <div className="flex flex-wrap items-center gap-6 rounded-lg border border-black/[.08] p-5 dark:border-white/[.145]">
        <VerdictBadge verdict={result.verdict} size="lg" />
        <Metric
          label="Tampering score"
          value={
            result.modules?.tampering?.worst_fraud_score != null
              ? result.modules.tampering.worst_fraud_score.toFixed(4)
              : "N/A"
          }
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

      {/* Tampering overlays */}
      <TamperingOverlays
        pages={result.modules.tampering.pages}
        verifyId={verifyId}
      />

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

function TamperingOverlays({
  pages,
  verifyId,
}: {
  pages: TamperingPage[];
  verifyId: string;
}) {
  const overlays = pages
    .map((page, i) => ({
      filename: page.overlay_filename ?? null,
      pageNumber: i + 1,
    }))
    .filter(
      (p): p is { filename: string; pageNumber: number } => p.filename !== null,
    );

  if (overlays.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
        Tampering analysis
      </h2>
      <div className="space-y-4">
        {overlays.map(({ filename, pageNumber }) => (
          <TamperingOverlayImage
            key={filename}
            filename={filename}
            pageNumber={pageNumber}
            verifyId={verifyId}
          />
        ))}
      </div>
    </div>
  );
}

function TamperingOverlayImage({
  filename,
  pageNumber,
  verifyId,
}: {
  filename: string;
  pageNumber: number;
  verifyId: string;
}) {
  const [imgError, setImgError] = useState(false);
  const src = getTamperingOverlayUrl(verifyId, filename);

  return (
    <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <p className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Tampering analysis — page {pageNumber}
      </p>
      {imgError ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-black/[.12] text-sm text-zinc-400 dark:border-white/[.12]">
          Overlay image unavailable
        </div>
      ) : (
        <img
          src={src}
          alt={`Tampering overlay page ${pageNumber}`}
          onError={() => setImgError(true)}
          className="max-w-full rounded-md"
        />
      )}
    </div>
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
