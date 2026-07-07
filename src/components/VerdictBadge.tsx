import type { Verdict } from "@/lib/types";

type Size = "sm" | "md" | "lg";

const STYLES: Record<Verdict, { classes: string; label: string }> = {
  ACCEPT: {
    label: "Accepted",
    classes:
      "border-green-200 bg-green-50 text-green-800 dark:border-green-600/50 dark:bg-green-550/30 dark:text-green-300",
  },
  REVIEW: {
    label: "Review",
    classes:
      "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-600/50 dark:bg-orange-550/30 dark:text-orange-300",
  },
  REJECT: {
    label: "Rejected",
    classes:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-600/50 dark:bg-red-550/30 dark:text-red-300",
  },
};

const DOT: Record<Verdict, string> = {
  ACCEPT: "bg-green-500",
  REVIEW: "bg-orange-500",
  REJECT: "bg-red-500",
};

const SIZES: Record<Size, string> = {
  sm: "px-2 py-0.5 text-xs gap-1.5",
  md: "px-3 py-1 text-sm gap-2",
  lg: "px-4 py-1.5 text-base gap-2.5",
};

const DOT_SIZES: Record<Size, string> = {
  sm: "h-1.5 w-1.5",
  md: "h-2 w-2",
  lg: "h-2.5 w-2.5",
};

interface VerdictBadgeProps {
  verdict: Verdict;
  size?: Size;
  /** Show the colored status dot. Defaults to true. */
  showDot?: boolean;
  className?: string;
}

export default function VerdictBadge({
  verdict,
  size = "md",
  showDot = true,
  className = "",
}: VerdictBadgeProps) {
  const { classes, label } = STYLES[verdict];

  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold ${SIZES[size]} ${classes} ${className}`}
    >
      {showDot ? (
        <span
          aria-hidden="true"
          className={`inline-block rounded-full ${DOT[verdict]} ${DOT_SIZES[size]}`}
        />
      ) : null}
      {label}
    </span>
  );
}
