"use client";

// =============================================================================
// Template detail page — GET /v1/templates/{template_id}.
// Renders the full TemplateDetail: metadata, fields table, anchors, and the
// raw config blobs (fingerprint / field_rules / qr_config).
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { getTemplate, ApiError } from "@/lib/api";
import type { TemplateDetail } from "@/lib/types";
import Spinner from "@/components/ui/Spinner";
import ErrorMessage from "@/components/ui/ErrorMessage";

export default function TemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [template, setTemplate] = useState<TemplateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplate = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setTemplate(await getTemplate(id));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load the template.",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTemplate();
  }, [fetchTemplate]);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <Link
        href="/templates"
        className="text-sm text-zinc-500 transition-colors hover:text-black dark:hover:text-zinc-50"
      >
        ← Back to templates
      </Link>

      <div className="mt-6">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" label="Loading template…" />
          </div>
        ) : error ? (
          <ErrorMessage
            title="Couldn't load template"
            message={error}
            onRetry={fetchTemplate}
          />
        ) : template ? (
          <TemplateView template={template} />
        ) : null}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function TemplateView({ template: t }: { template: TemplateDetail }) {
  const createdAt = t.created_at
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(t.created_at))
    : null;

  return (
    <article className="space-y-8">
      {/* Header */}
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {t.document_name}
        </h1>
        <p className="font-mono text-sm text-zinc-500">{t.id}</p>
      </header>

      {/* Metadata grid */}
      <section className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-lg border border-black/[.08] p-5 dark:border-white/[.145] sm:grid-cols-3">
        <Meta label="Document type" value={t.document_type} mono />
        <Meta label="Edition" value={t.edition} />
        <Meta label="Schema version" value={t.schema_version} />
        <Meta label="Country" value={t.country} />
        <Meta label="Country ISO" value={t.country_iso} mono />
        <Meta label="State" value={t.state} />
        <Meta label="Doc family" value={t.doc_family} mono />
        <Meta label="MRZ type" value={t.mrz_type} mono />
        <Meta label="Created" value={createdAt} />
      </section>

      {/* Sample image path */}
      {t.img_path ? (
        <section>
          <SectionTitle>Sample image</SectionTitle>
          <p className="mt-2 break-all font-mono text-sm text-zinc-600 dark:text-zinc-400">
            {t.img_path}
          </p>
        </section>
      ) : null}

      {/* Fields */}
      <section>
        <SectionTitle>Fields ({t.fields.length})</SectionTitle>
        {t.fields.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No fields defined.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-black/[.08] dark:border-white/[.145]">
            <table className="w-full text-left text-sm">
              <thead className="bg-black/[.03] text-xs uppercase tracking-wide text-zinc-500 dark:bg-white/[.04]">
                <tr>
                  <th className="px-4 py-2 font-medium">Key</th>
                  <th className="px-4 py-2 font-medium">Label</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[.06] dark:divide-white/[.08]">
                {t.fields.map((f) => (
                  <tr key={f.key}>
                    <td className="px-4 py-2 font-mono text-zinc-800 dark:text-zinc-200">
                      {f.key}
                    </td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">
                      {f.label}
                    </td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                      {f.type}
                    </td>
                    <td className="px-4 py-2 text-zinc-500">
                      {f.category ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Anchors */}
      <section>
        <SectionTitle>Anchors ({t.anchors.length})</SectionTitle>
        {t.anchors.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">No anchors.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {t.anchors.map((a, i) => (
              <span
                key={`${a}-${i}`}
                className="rounded-full border border-black/[.08] bg-black/[.03] px-3 py-1 text-xs text-zinc-700 dark:border-white/[.145] dark:bg-white/[.04] dark:text-zinc-300"
              >
                {a}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Raw config blobs */}
      <section className="space-y-3">
        <SectionTitle>Configuration</SectionTitle>
        <JsonBlock label="Fingerprint" value={t.fingerprint} />
        <JsonBlock label="Field rules" value={t.field_rules} />
        <JsonBlock label="QR config" value={t.qr_config} />
      </section>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
      {children}
    </h2>
  );
}

function Meta({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  const isEmpty = value === null || value === undefined || value === "";
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-zinc-500">{label}</span>
      <span
        className={`text-sm ${isEmpty ? "text-zinc-400" : "text-black dark:text-zinc-100"} ${mono && !isEmpty ? "font-mono" : ""}`}
      >
        {isEmpty ? "—" : value}
      </span>
    </div>
  );
}

function JsonBlock({
  label,
  value,
}: {
  label: string;
  value: Record<string, unknown>;
}) {
  const isEmpty = !value || Object.keys(value).length === 0;
  return (
    <details className="group rounded-lg border border-black/[.08] dark:border-white/[.145]">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        <span>{label}</span>
        <span className="text-xs text-zinc-400">
          {isEmpty ? "empty" : `${Object.keys(value).length} keys`}
        </span>
      </summary>
      {!isEmpty ? (
        <pre className="overflow-x-auto border-t border-black/[.06] px-4 py-3 font-mono text-xs text-zinc-600 dark:border-white/[.08] dark:text-zinc-400">
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : null}
    </details>
  );
}
