import type { Metadata } from "next";
import Link from "next/link";
import { SessionProvider } from "../lib/session";
import { BrandLogo } from "../components/BrandLogo";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { JackpotPill } from "../components/JackpotPill";
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
          <nav className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800 bg-zinc-950/90 px-3 py-2.5 backdrop-blur sm:gap-x-6 sm:px-6">
            <BrandLogo />
            <span className="hidden rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 sm:inline">
              paper beta
            </span>
            <JackpotPill />
            <div className="flex-1" />
            <Link href="/matches" className="text-sm text-zinc-400 hover:text-lime-300">
              Matches
            </Link>
            <Link href="/submissions" className="text-sm text-zinc-400 hover:text-lime-300">
              Launchpad
            </Link>
            <Link href="/leaderboard" className="text-sm text-zinc-400 hover:text-lime-300">
              Board
            </Link>
            <Link href="/jackpot" className="text-sm text-amber-400/90 hover:text-amber-300">
              Jackpot
            </Link>
            <Link href="/docs" className="text-sm text-zinc-400 hover:text-lime-300">
              Docs
            </Link>
            {/* /admin is reachable by URL only — no nav link by design.
                Profile lives in the wallet dropdown. */}
            <WalletButton />
          </nav>
          <main className="mx-auto max-w-6xl px-3 py-6 sm:px-4">{children}</main>
          <FeedbackWidget />
        </SessionProvider>
      </body>
    </html>
  );
}
