import type { Metadata } from "next";
import Link from "next/link";
import { SessionProvider } from "../lib/session";
import { WalletButton } from "../components/WalletButton";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Cookout",
  description: "Live multiplayer trading arena and launchpad — Phase 1 paper money",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <SessionProvider>
          <nav className="sticky top-0 z-20 flex items-center gap-6 border-b border-zinc-800 bg-zinc-950/90 px-6 py-3 backdrop-blur">
            <Link href="/" className="text-lg font-black tracking-tight text-amber-400">
              THE COOKOUT
            </Link>
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
              paper money
            </span>
            <div className="flex-1" />
            <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-100">
              Matches
            </Link>
            <Link href="/submissions" className="text-sm text-zinc-400 hover:text-zinc-100">
              Launchpad
            </Link>
            <Link href="/leaderboard" className="text-sm text-zinc-400 hover:text-zinc-100">
              Leaderboard
            </Link>
            <Link href="/profile" className="text-sm text-zinc-400 hover:text-zinc-100">
              Profile
            </Link>
            <Link href="/admin" className="text-sm text-zinc-600 hover:text-zinc-300">
              Admin
            </Link>
            <WalletButton />
          </nav>
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
