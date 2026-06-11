type SpinnerSize = "sm" | "md" | "lg";

const SIZES: Record<SpinnerSize, string> = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-[3px]",
};

interface SpinnerProps {
  size?: SpinnerSize;
  /** Optional text shown next to the spinner. */
  label?: string;
  className?: string;
}

export default function Spinner({
  size = "md",
  label,
  className = "",
}: SpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-3 ${className}`}
    >
      <span
        className={`inline-block animate-spin rounded-full border-zinc-300 border-t-zinc-800 dark:border-zinc-700 dark:border-t-zinc-100 ${SIZES[size]}`}
      />
      {label ? (
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {label}
        </span>
      ) : (
        <span className="sr-only">Loading…</span>
      )}
    </div>
  );
}
