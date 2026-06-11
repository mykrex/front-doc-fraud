interface EmptyStateProps {
  title: string;
  description?: React.ReactNode;
  /** Optional icon/illustration shown above the title. */
  icon?: React.ReactNode;
  /** Optional call-to-action (e.g. a Link or button). */
  action?: React.ReactNode;
  className?: string;
}

export default function EmptyState({
  title,
  description,
  icon,
  action,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-black/[.12] px-6 py-12 text-center dark:border-white/[.145] ${className}`}
    >
      {icon ? (
        <div className="mb-4 text-zinc-400 dark:text-zinc-500">{icon}</div>
      ) : null}
      <h3 className="text-base font-semibold text-black dark:text-zinc-50">
        {title}
      </h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
