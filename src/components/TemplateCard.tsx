import Link from "next/link";

import type { TemplateSummary } from "@/lib/types";

// Deterministic color per document_type so passports, IDs, licenses, etc. are
// visually distinguishable at a glance. Same type → same color across renders.
const BADGE_PALETTE = [
  "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-300",
  "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/50 dark:bg-purple-950/30 dark:text-purple-300",
  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300",
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300",
  "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900/50 dark:bg-pink-950/30 dark:text-pink-300",
  "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-300",
];

function badgeClasses(documentType: string): string {
  let hash = 0;
  for (let i = 0; i < documentType.length; i++) {
    hash = (hash * 31 + documentType.charCodeAt(i)) | 0;
  }
  return BADGE_PALETTE[Math.abs(hash) % BADGE_PALETTE.length];
}

// "3 days ago", "2 months ago", etc. Falls back to a plain date for old items.
const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const DATE_FMT = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  let duration = (date.getTime() - Date.now()) / 1000; // seconds, negative = past
  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(duration) < amount) {
      return RELATIVE.format(Math.round(duration), unit);
    }
    duration /= amount;
  }
  return DATE_FMT.format(date);
}

interface TemplateCardProps {
  template: TemplateSummary;
}

export default function TemplateCard({ template }: TemplateCardProps) {
  const { id, document_name, document_type, edition, country, created_at } =
    template;

  return (
    <Link
      href={`/templates/${encodeURIComponent(id)}`}
      className="group flex flex-col gap-3 rounded-lg border border-black/[.08] bg-white p-5 transition-colors hover:border-black/[.2] hover:bg-zinc-50 dark:border-white/[.145] dark:bg-black dark:hover:border-white/[.3] dark:hover:bg-zinc-950"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${badgeClasses(document_type)}`}
        >
          {document_type}
        </span>
        {country ? (
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
            {country}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold leading-tight text-black dark:text-zinc-50">
          {document_name}
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {document_type} · {edition}
        </p>
      </div>

      <div className="mt-1 flex items-center justify-between">
        {created_at ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-500">
            Created {formatCreatedAt(created_at)}
          </span>
        ) : (
          <span />
        )}
        <span className="text-sm font-medium text-zinc-700 transition-colors group-hover:text-black dark:text-zinc-300 dark:group-hover:text-zinc-50">
          View details →
        </span>
      </div>
    </Link>
  );
}
