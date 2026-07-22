"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_CHAIN_ID, arenaBalance, hasArenaWallet } from "../lib/arenaWallet";
import { useChainOnly } from "../lib/chainOnly";
import { useSession } from "../lib/session";

export function WalletButton() {
  const { profile, signIn, signOut, busy, authError, clearAuthError, promptPlayNow } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chainOnly = useChainOnly();

  // Chain-only mode: the menu bar shows the arena wallet's live balance
  // instead of paper money.
  const [arenaBal, setArenaBal] = useState<number | null>(null);
  useEffect(() => {
    if (!chainOnly || !profile) return;
    const poll = () => {
      if (hasArenaWallet()) arenaBalance(DEFAULT_CHAIN_ID).then(setArenaBal).catch(() => {});
      else setArenaBal(null);
    };
    poll();
    const t = setInterval(poll, 10_000);
    return () => clearInterval(t);
  }, [chainOnly, profile]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (profile) {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:border-lime-400/60"
          title={profile.address}
        >
          {(profile as unknown as { avatarUrl?: string }).avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(profile as unknown as { avatarUrl?: string }).avatarUrl}
              alt=""
              className="h-5 w-5 rounded-full object-cover"
            />
          ) : (
            <span className="h-2 w-2 rounded-full bg-lime-400" />
          )}
          <span className="hidden max-w-[7rem] truncate font-bold sm:inline">
            {profile.displayName ?? `${profile.address.slice(0, 6)}…${profile.address.slice(-4)}`}
          </span>
          {chainOnly ? (
            <span className="font-mono text-xs text-lime-300">
              ⚡ {arenaBal !== null ? `${arenaBal.toFixed(4)} ETH` : "arena"}
            </span>
          ) : (
            <span className="flex items-baseline gap-1.5 font-mono text-xs">
              <span className="text-lime-300">⚡ {(profile.arenaBalance ?? 0).toFixed(2)}</span>
              {/* the bank total is secondary — drop it on the tightest screens */}
              <span className="hidden text-zinc-500 sm:inline">
                / {(profile.paperBalance ?? 0).toFixed(2)} pETH
              </span>
            </span>
          )}
          <span className="text-xs text-zinc-500">▾</span>
        </button>
        {open && (
          <div className="absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
            <div className="border-b border-zinc-800 px-3 py-2 text-xs text-zinc-500">
              Lv{profile.level} {profile.title} · {profile.xp} XP
            </div>
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm hover:bg-zinc-800"
            >
              👤 Profile
            </Link>
            <Link
              href="/wallet"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm hover:bg-zinc-800"
            >
              ⚡ Arena Account
            </Link>
            <Link
              href={`/profile/${profile.address}`}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm hover:bg-zinc-800"
            >
              🌐 Public view
            </Link>
            <button
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className="block w-full px-3 py-2 text-left text-sm text-zinc-400 hover:bg-zinc-800"
            >
              ⏏ Sign out
            </button>
          </div>
        )}
      </div>
    );
  }
  // Signed out. On the public paper site the primary action is "Play Now"
  // (opens Privy — no wallet needed). On the invite-only chain site we keep
  // the "Connect Wallet" framing. Both surface sign-in problems inline —
  // a silent failure here strands the player with a button that "does nothing".
  if (!chainOnly) {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={promptPlayNow}
          disabled={busy}
          className="rounded bg-lime-400 px-3 py-1 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
        >
          {busy ? "Starting…" : "Play Now"}
        </button>
        {authError && (
          <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-amber-500/40 bg-zinc-900 p-3 text-xs shadow-2xl">
            <p className="text-amber-200">{authError}</p>
            <div className="mt-2 flex items-center justify-end">
              <button
                onClick={clearAuthError}
                className="text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => void signIn()}
        disabled={busy}
        className="rounded bg-lime-400 px-3 py-1 text-sm font-semibold text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
      >
        {busy ? "Signing…" : "Connect Wallet"}
      </button>
      {authError && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-amber-500/40 bg-zinc-900 p-3 text-xs shadow-2xl">
          <p className="text-amber-200">{authError}</p>
          <div className="mt-2 flex items-center justify-end">
            <button
              onClick={clearAuthError}
              className="text-[11px] text-zinc-500 hover:text-zinc-300"
            >
              dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
