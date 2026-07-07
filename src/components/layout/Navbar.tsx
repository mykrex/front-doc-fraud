"use client";

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
    <header className="bg-brand-blue">
      <nav className="mx-auto flex w-full max-w-5xl items-center gap-6 px-6 py-4">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight text-white"
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
                  ? "text-white"
                  : "text-white/70 transition-colors hover:text-white"
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
