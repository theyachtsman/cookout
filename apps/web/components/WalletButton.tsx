"use client";

import { useSession } from "../lib/session";

export function WalletButton() {
  const { profile, signIn, signOut, busy } = useSession();
  if (profile) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs text-zinc-400">
          Lv{profile.level} {profile.title} · {profile.paperBalance.toFixed(2)} pETH
        </span>
        <button
          onClick={signOut}
          className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          title={profile.address}
        >
          {profile.displayName ?? `${profile.address.slice(0, 6)}…${profile.address.slice(-4)}`}
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => void signIn()}
      disabled={busy}
      className="rounded bg-amber-500 px-3 py-1 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
    >
      {busy ? "Signing…" : "Connect Wallet"}
    </button>
  );
}
