import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Doc Fraud · eKYC",
  description: "Document fraud detection and template management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-black/[.08] bg-white dark:border-white/[.145] dark:bg-black">
          <nav className="mx-auto flex w-full max-w-5xl items-center gap-6 px-6 py-4">
            <Link
              href="/"
              className="text-base font-semibold tracking-tight text-black dark:text-zinc-50"
            >
              Doc Fraud
            </Link>
            <div className="flex items-center gap-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              <Link
                href="/"
                className="transition-colors hover:text-black dark:hover:text-zinc-50"
              >
                Verify
              </Link>
              <Link
                href="/templates"
                className="transition-colors hover:text-black dark:hover:text-zinc-50"
              >
                Templates
              </Link>
            </div>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
