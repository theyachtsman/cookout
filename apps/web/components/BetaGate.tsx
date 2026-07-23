"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useChainOnly } from "../lib/chainOnly";
import { useSession } from "../lib/session";

/**
 * Access gate — behaviour forks by site:
 *
 *  - Public Open Beta (paper, www): NO wall. Every route renders for everyone;
 *    logged-out visitors browse read-only and are nudged to "Play Now" only
 *    when they try to act (queue/trade/chat). Signed-in visitors who hit the
 *    splash get sent into the arena.
 *  - Dev / mainnet-staging (chain-only): stays invite-only. Only the splash and
 *    docs are public; every other route requires a session, which that server
 *    only issues to whitelisted/dev wallets. Non-signed-in visitors bounce home.
 */
const HOME = "/matches"; // where a signed-in wallet enters the app
const PUBLIC_PATHS = new Set(["/", "/docs"]); // viewable without a session on the gated site

export function BetaGate({ children }: { children: React.ReactNode }) {
  const { profile, ready } = useSession();
  const chainOnly = useChainOnly();
  const pathname = usePathname();
  const router = useRouter();
  const isSplash = pathname === "/";
  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (!ready) return;
    // Dev site only: bounce logged-out visitors off gated routes.
    if (chainOnly && !isPublic && !profile) {
      router.replace("/");
      return;
    }
    // Both sites: a signed-in player has no reason to sit on the splash.
    if (isSplash && profile) router.replace(HOME);
  }, [ready, isPublic, isSplash, profile, router, chainOnly]);

  // Open Beta: the whole app is browseable; write actions gate themselves.
  if (!chainOnly) return <>{children}</>;

  // Dev site: public pages render for everyone; signed-in users leave the splash.
  if (isPublic) return <>{children}</>;

  // Gated route: wait for the auth check, then require a session.
  if (!ready || !profile) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-lime-400" />
        <p className="text-sm text-zinc-500">
          {ready ? "Invite-only · redirecting…" : "Checking access…"}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
