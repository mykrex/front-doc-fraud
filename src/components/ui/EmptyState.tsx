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
      className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-brand-silver px-6 py-12 text-center dark:border-blue/10 ${className}`}
    >
      {icon ? (
        <div className="mb-4 text-brand-gray/40 dark:text-foreground/40">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-brand-gray dark:text-foreground">
        {title}
      </h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-brand-gray/70 dark:text-foreground/70">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
