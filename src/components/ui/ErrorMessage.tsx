interface ErrorMessageProps {
  /** Title line; defaults to a generic error heading. */
  title?: string;
  /** Detail message — accepts a string or any node (e.g. an Error message). */
  message?: React.ReactNode;
  /** Optional retry handler button when provided. */
  onRetry?: () => void;
  className?: string;
}

export default function ErrorMessage({
  title = "Something went wrong",
  message,
  onRetry,
  className = "",
}: ErrorMessageProps) {
  return (
    <div
      role="alert"
      className={`rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-550/30 ${className}`}
    >
      <p className="text-sm font-semibold text-red-800 dark:text-red-300">
        {title}
      </p>
      {message ? (
        <p className="mt-1 text-sm text-red-700 dark:text-red-400">{message}</p>
      ) : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex h-9 items-center rounded-full border border-red-300 px-4 text-sm font-medium text-red-800 transition-colors hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
