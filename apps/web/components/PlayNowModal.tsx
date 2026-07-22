"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { hasAccount } from "../lib/accountKey";
import { useSession } from "../lib/session";

/**
 * Open Beta onboarding — "Play Now" in one small step.
 *
 * Pick a handle, and we mint a self-custodied arena account in your browser and
 * sign you in with no wallet popup (see accountKey.ts / session.signInLocal),
 * then stake your starter pETH into the arena so you can walk straight into a
 * match. "I already have a wallet" drops down to the Option-B injected-wallet
 * path. Opened from anywhere via session.promptPlayNow().
 */

function suggestHandle(): string {
  const cooks = ["chef", "griller", "pitmaster", "saucier", "linecook", "flametamer"];
  return `${cooks[Math.floor(Math.random() * cooks.length)]}-${1000 + Math.floor(Math.random() * 9000)}`;
}

export function PlayNowModal() {
  const { profile, signIn, signInLocal, refresh, busy, authError, clearAuthError, playNowOpen, closePlayNow } =
    useSession();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [name, setName] = useState("");
  const [showWallet, setShowWallet] = useState(false);
  const [returning, setReturning] = useState(false);
  const placeholder = useMemo(suggestHandle, [playNowOpen]);

  useEffect(() => setMounted(true), []);

  // Reset transient UI each time the modal opens; if the visitor is already
  // signed in there's nothing to onboard, so just close.
  useEffect(() => {
    if (!playNowOpen) return;
    if (profile) {
      closePlayNow();
      return;
    }
    setShowWallet(false);
    setReturning(hasAccount()); // this browser already has an account key
    clearAuthError();
  }, [playNowOpen, profile, closePlayNow, clearAuthError]);

  if (!mounted || !playNowOpen) return null;

  const finish = async () => {
    // Stake the starter into the arena so they can play immediately. The server
    // caps the deposit at the available bank, so a generous ask just moves the
    // whole starter; failure is non-fatal (they can stake manually later).
    try {
      await api("/api/me/arena/transfer", { body: { amount: 1e9, direction: "deposit" } });
      await refresh();
    } catch {
      /* non-fatal — onboarding still succeeded */
    }
    router.push("/matches");
  };

  const play = async () => {
    // Fresh account with a blank field → give them the suggested handle.
    // Returning account with a blank field → keep whatever name they had.
    const handle = name.trim() || (returning ? undefined : placeholder);
    try {
      await signInLocal(handle);
      await finish();
    } catch {
      /* authError is surfaced in the panel below */
    }
  };

  const playWithWallet = async () => {
    try {
      await signIn();
      await finish();
    } catch {
      /* authError surfaced below */
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div
        onClick={() => !busy && closePlayNow()}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="border-b border-zinc-800 bg-gradient-to-b from-lime-400/[0.08] to-transparent px-6 py-5 text-center">
          <div className="text-3xl">🔥</div>
          <h2 className="mt-1 text-2xl font-black tracking-tight">
            {returning ? "Welcome back" : "Play Now"}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            {returning
              ? "Jump back into your account. Paper money, no wallet needed."
              : "Pick a name and you're in. Paper money, no deposit, no wallet needed."}
          </p>
        </div>

        <div className="px-6 py-5">
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-zinc-500">
            {returning ? "Change your handle (optional)" : "Your handle"}
          </label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && void play()}
            maxLength={24}
            placeholder={returning ? "keep your current name" : placeholder}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-base outline-none focus:border-lime-400/60"
          />
          <p className="mt-1.5 text-[11px] text-zinc-600">
            You can change this anytime in your profile.
          </p>

          {authError && (
            <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {authError}
            </p>
          )}

          <button
            onClick={() => void play()}
            disabled={busy}
            className="mt-4 w-full rounded-xl bg-lime-400 px-4 py-3 text-lg font-black text-zinc-950 shadow-lg shadow-lime-400/25 transition hover:bg-lime-300 disabled:opacity-50"
          >
            {busy ? "Starting…" : returning ? "Continue →" : "Let's go →"}
          </button>

          <div className="mt-4 border-t border-zinc-800 pt-3 text-center">
            {showWallet ? (
              <button
                onClick={() => void playWithWallet()}
                disabled={busy}
                className="text-sm font-bold text-zinc-300 hover:text-lime-300 disabled:opacity-50"
              >
                Connect MetaMask / Robinhood →
              </button>
            ) : (
              <button
                onClick={() => setShowWallet(true)}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                I already have a wallet
              </button>
            )}
          </div>
        </div>

        <button
          onClick={() => !busy && closePlayNow()}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
    </div>,
    document.body,
  );
}
