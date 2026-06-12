"use client";

// =============================================================================
// Templates list page — GET /v1/templates.
// Fetches the template summaries, supports document_type / country filters,
// and renders them as a grid of TemplateCard with loading/error/empty states.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { listTemplates, ApiError } from "@/lib/api";
import type { TemplateSummary } from "@/lib/types";
import TemplateCard from "@/components/TemplateCard";
import Spinner from "@/components/ui/Spinner";
import ErrorMessage from "@/components/ui/ErrorMessage";
import EmptyState from "@/components/ui/EmptyState";

interface Filters {
  document_type: string;
  country: string;
}

const EMPTY_FILTERS: Filters = { document_type: "", country: "" };

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Applied filters (what the last request used) vs. the draft in the inputs.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);

  const fetchTemplates = useCallback(async (active: Filters) => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTemplates({
        document_type: active.document_type.trim() || undefined,
        country: active.country.trim() || undefined,
      });
      setTemplates(data);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load templates.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates(filters);
  }, [filters, fetchTemplates]);

  function applyFilters(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFilters(draft);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
  }

  const hasFilters =
    filters.document_type.trim() !== "" || filters.country.trim() !== "";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Templates
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Reference templates used to guide document extraction.
          </p>
        </div>
        <Link
          href="/templates/new"
          className="inline-flex h-10 items-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:opacity-90"
        >
          New template
        </Link>
      </div>

      {/* Filters */}
      <form
        onSubmit={applyFilters}
        className="mt-6 flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Document type
          </span>
          <input
            value={draft.document_type}
            onChange={(e) =>
              setDraft((p) => ({ ...p, document_type: e.target.value }))
            }
            placeholder="e.g. passport"
            className="h-9 w-48 rounded-md border border-black/[.12] bg-white px-3 text-sm outline-none focus:border-black/[.3] dark:border-white/[.145] dark:bg-black dark:focus:border-white/[.3]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Country
          </span>
          <input
            value={draft.country}
            onChange={(e) =>
              setDraft((p) => ({ ...p, country: e.target.value }))
            }
            placeholder="e.g. Mexico"
            className="h-9 w-48 rounded-md border border-black/[.12] bg-white px-3 text-sm outline-none focus:border-black/[.3] dark:border-white/[.145] dark:bg-black dark:focus:border-white/[.3]"
          />
        </label>
        <button
          type="submit"
          className="h-9 rounded-full border border-black/[.12] px-4 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
        >
          Apply
        </button>
        {hasFilters ? (
          <button
            type="button"
            onClick={clearFilters}
            className="h-9 px-2 text-sm text-zinc-500 transition-colors hover:text-black dark:hover:text-zinc-50"
          >
            Clear
          </button>
        ) : null}
      </form>

      {/* Results */}
      <div className="mt-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" label="Loading templates…" />
          </div>
        ) : error ? (
          <ErrorMessage
            title="Couldn't load templates"
            message={error}
            onRetry={() => fetchTemplates(filters)}
          />
        ) : templates.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No matching templates" : "No templates yet"}
            description={
              hasFilters
                ? "Try adjusting or clearing the filters."
                : "Create your first template from a reference document."
            }
            action={
              hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex h-10 items-center rounded-full border border-black/[.12] px-5 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
                >
                  Clear filters
                </button>
              ) : (
                <Link
                  href="/templates/new"
                  className="inline-flex h-10 items-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:opacity-90"
                >
                  New template
                </Link>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <TemplateCard key={t.id} template={t} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
