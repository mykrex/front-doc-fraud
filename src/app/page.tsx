import Link from "next/link";

const CARDS = [
  {
    href: "/verify",
    title: "Verify a document",
    description:
      "Upload one or more pages and run the fraud detection pipeline to get a verdict, tampering score, and flags.",
    cta: "Start verification",
  },
  {
    href: "/templates",
    title: "Manage templates",
    description:
      "Browse reference templates or create a new one from a sample document to guide field extraction.",
    cta: "View templates",
  },
];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight text-brand-gray dark:text-foreground">
          Document fraud detection
        </h1>
        <p className="mt-3 text-base text-brand-blue/70 dark:text-foreground/70">
          Verify identity documents and manage the templates used to guide
          extraction.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex flex-col gap-3 rounded-lg border border-brand-silver bg-white p-6 transition-colors hover:border-brand-blue/50 hover:bg-brand-surface dark:border-blue/10 dark:bg-white/5 dark:hover:border-brand-blue/50 dark:hover:bg-brand-blue/10"
          >
            <h2 className="text-lg font-semibold text-brand-gray dark:text-foreground">
              {card.title}
            </h2>
            <p className="text-sm leading-6 text-brand-gray/70 dark:text-foreground/70">
              {card.description}
            </p>
            <span className="mt-2 text-sm font-medium text-brand-blue-dark transition-colors group-hover:text-brand-blue dark:text-brand-blue">
              {card.cta} →
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
