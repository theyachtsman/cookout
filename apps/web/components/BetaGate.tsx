"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "../lib/session";

/**
 * Private-beta gate. Only the splash ("/") is public; every other route
 * requires a session, which the API only issues to whitelisted/dev wallets.
 * Non-signed-in visitors are bounced to the splash; signed-in visitors who
 * land on the splash are sent into the arena.
 */
const HOME = "/matches"; // where a signed-in wallet enters the app

export function BetaGate({ children }: { children: React.ReactNode }) {
  const { profile, ready } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const isSplash = pathname === "/";

  useEffect(() => {
    if (!ready) return;
    if (!isSplash && !profile) router.replace("/");
    else if (isSplash && profile) router.replace(HOME);
  }, [ready, isSplash, profile, router]);

  // Splash is always allowed to render (redirect for signed-in users happens above).
  if (isSplash) return <>{children}</>;

  // Gated route: wait for the auth check, then require a session.
  if (!ready || !profile) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-lime-400" />
        <p className="text-sm text-zinc-500">
          {ready ? "Private beta — redirecting…" : "Checking access…"}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
