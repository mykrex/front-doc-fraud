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
        <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          Document fraud detection
        </h1>
        <p className="mt-3 text-base text-zinc-600 dark:text-zinc-400">
          Verify identity documents and manage the templates used to guide
          extraction.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group flex flex-col gap-3 rounded-lg border border-black/[.08] bg-white p-6 transition-colors hover:border-black/[.2] hover:bg-zinc-50 dark:border-white/[.145] dark:bg-black dark:hover:border-white/[.3] dark:hover:bg-zinc-950"
          >
            <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
              {card.title}
            </h2>
            <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {card.description}
            </p>
            <span className="mt-2 text-sm font-medium text-zinc-700 transition-colors group-hover:text-black dark:text-zinc-300 dark:group-hover:text-zinc-50">
              {card.cta} →
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
