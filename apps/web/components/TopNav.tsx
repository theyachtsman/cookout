"use client";

import Link from "next/link";
import { BrandLogo } from "./BrandLogo";
import { JackpotPill } from "./JackpotPill";
import { WalletButton } from "./WalletButton";
import { useSession } from "../lib/session";

/**
 * Top navigation. During the private beta the app links only appear for
 * signed-in (whitelisted/dev) wallets; everyone else sees just the logo and
 * the connect button on the splash.
 */
export function TopNav() {
  const { profile } = useSession();
  return (
    <nav className="sticky top-0 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800 bg-zinc-950/90 px-3 py-2.5 backdrop-blur sm:gap-x-6 sm:px-6">
      <BrandLogo />
      <span className="hidden rounded bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-300 sm:inline">
        private beta
      </span>
      {profile && <JackpotPill />}
      <div className="flex-1" />
      {profile && (
        <>
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
        </>
      )}
      {/* Docs is public — available to everyone, signed in or not. */}
      <Link href="/docs" className="text-sm text-zinc-400 hover:text-lime-300">
        Docs
      </Link>
      <WalletButton />
    </nav>
  );
}
