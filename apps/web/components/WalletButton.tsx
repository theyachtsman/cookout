"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSession } from "../lib/session";

export function WalletButton() {
  const { profile, signIn, signOut, busy, authError, clearAuthError } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
          <span className="font-bold">
            {profile.displayName ?? `${profile.address.slice(0, 6)}…${profile.address.slice(-4)}`}
          </span>
          <span className="font-mono text-xs text-zinc-400">
            {profile.paperBalance.toFixed(2)} pETH
          </span>
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
          <div className="mt-2 flex items-center gap-3">
            <a
              href="/#beta"
              onClick={clearAuthError}
              className="rounded bg-lime-400 px-2 py-1 text-[11px] font-bold text-zinc-950 hover:bg-lime-300"
            >
              Go to the sign-up form →
            </a>
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
