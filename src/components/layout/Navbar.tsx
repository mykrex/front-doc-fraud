"use client";

// Global navigation bar. Rendered once from the root layout, so it appears on
// every page. Highlights the active section based on the current pathname.

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/verify", label: "Verify" },
  { href: "/templates", label: "Templates" },
];

export default function Navbar() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="border-b border-black/[.08] bg-white dark:border-white/[.145] dark:bg-black">
      <nav className="mx-auto flex w-full max-w-5xl items-center gap-6 px-6 py-4">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight text-black dark:text-zinc-50"
        >
          Doc Fraud
        </Link>
        <div className="flex items-center gap-4 text-sm font-medium">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={
                isActive(link.href)
                  ? "text-black dark:text-zinc-50"
                  : "text-zinc-600 transition-colors hover:text-black dark:text-zinc-400 dark:hover:text-zinc-50"
              }
            >
              {link.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
