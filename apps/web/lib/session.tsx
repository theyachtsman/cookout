"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { audio } from "./audio";
import { accountAddress, signWithAccount } from "./accountKey";

export interface Profile {
  address: string;
  displayName?: string;
  xp: number;
  level: number;
  title: string;
  paperBalance: number;
  /** Staked into the arena — the only money matches can spend. */
  arenaBalance?: number;
  achievements: string[];
  referralCode: string;
  creatorReputation: number;
  stats: Record<string, number>;
  jackpotWinnings?: number;
  jackpotWins?: { week: string; rank: number; amountEth: number; amountUsd: number; at: number }[];
}

interface Session {
  profile: Profile | null;
  /** Option B: sign in with an existing injected wallet (MetaMask/Robinhood). */
  signIn: () => Promise<void>;
  /** Default onboarding: mint (or reuse) a local arena account and sign in as
   *  it, with no wallet popup. Optionally sets the chosen username. */
  signInLocal: (username?: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
  busy: boolean;
  /** True once the initial token check has resolved (gate waits on this). */
  ready: boolean;
  /** Human-readable sign-in problem (no wallet / not whitelisted). */
  authError: string;
  clearAuthError: () => void;
  /** Whether the "Play Now" onboarding modal is open, and how to toggle it.
   *  Any gated action (queue/trade/chat) calls promptPlayNow() when signed out. */
  playNowOpen: boolean;
  promptPlayNow: () => void;
  closePlayNow: () => void;
}

const Ctx = createContext<Session>({
  profile: null,
  signIn: async () => {},
  signInLocal: async () => {},
  signOut: () => {},
  refresh: async () => {},
  busy: false,
  ready: false,
  authError: "",
  clearAuthError: () => {},
  playNowOpen: false,
  promptPlayNow: () => {},
  closePlayNow: () => {},
});

/**
 * Auth with two paths onto the same SIWE surface (address + signature):
 *  - signInLocal(): the default. Mints a self-custodied arena account in this
 *    browser (accountKey.ts) and signs the login challenge with it — no wallet,
 *    no popup, no whitelist. This is the Open Beta "create account & play" flow.
 *  - signIn(): Option B, an existing injected wallet (window.ethereum) for
 *    players who'd rather bring their own key (and, at mainnet, deposit from it).
 * The server only ever sees an address + signature and can't tell the two apart.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [playNowOpen, setPlayNowOpen] = useState(false);
  // Kept in sync so the wallet event listener can read the current address
  // without re-subscribing on every profile change.
  const profileRef = useRef<Profile | null>(null);
  profileRef.current = profile;

  const refresh = useCallback(async () => {
    try {
      if (!localStorage.getItem("cookout_token")) {
        setProfile(null);
        return;
      }
      setProfile(await api<Profile>("/api/me"));
    } catch {
      localStorage.removeItem("cookout_token");
      setProfile(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Wallet account switching: the old token belongs to the old address, so a
  // switch leaves a mismatched session that can crash on the next render. Drop
  // it cleanly the moment the wallet's account changes, so the user just
  // re-connects as whoever they switched to.
  useEffect(() => {
    const eth = (
      window as unknown as {
        ethereum?: {
          on?: (e: string, cb: (a: string[]) => void) => void;
          removeListener?: (e: string, cb: (a: string[]) => void) => void;
        };
      }
    ).ethereum;
    if (!eth?.on) return;
    const onAccounts = (accounts: string[]) => {
      const next = accounts[0]?.toLowerCase();
      const current = profileRef.current?.address.toLowerCase();
      // Ignore the echo from our own connect (same account we're signed in as).
      if (next && current && next === current) return;
      localStorage.removeItem("cookout_token");
      setProfile(null);
      setAuthError("");
    };
    eth.on("accountsChanged", onAccounts);
    return () => eth.removeListener?.("accountsChanged", onAccounts);
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    setAuthError("");
    try {
      const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } })
        .ethereum;
      if (!eth) {
        setAuthError(
          "No wallet detected. Install a browser wallet (e.g. MetaMask, Rabby) to sign in.",
        );
        return;
      }
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts[0];
      if (!address) {
        setAuthError("No account selected in your wallet.");
        return;
      }
      const sign = async (message: string) => {
        const hex = Array.from(new TextEncoder().encode(message))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return (await eth.request({
          method: "personal_sign",
          params: [`0x${hex}`, address],
        })) as string;
      };

      const { message } = await api<{ message: string }>("/api/auth/nonce", { body: { address } });
      const signature = await sign(message);
      const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
      const { token, profile } = await api<{ token: string; profile: Profile }>(
        "/api/auth/verify",
        { body: { address, signature, referralCode: ref } },
      );
      localStorage.setItem("cookout_token", token);
      setProfile(profile);
      audio.play("ui.walletConnect"); // secure locking click on a fresh sign-in
    } catch (e) {
      // 403 during the beta = wallet not whitelisted; surface the server copy.
      setAuthError((e as Error).message || "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  // Default onboarding: mint (or reuse) the browser's arena account and sign in
  // as it with no wallet prompt. The address is deterministic per browser, so
  // signing out and back in lands on the same profile; a fresh username just
  // renames it. This is the "create account & play" path the Open Beta leads with.
  const signInLocal = useCallback(async (username?: string) => {
    setBusy(true);
    setAuthError("");
    try {
      const address = accountAddress();
      const { message } = await api<{ message: string }>("/api/auth/nonce", { body: { address } });
      const signature = await signWithAccount(message);
      const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
      const { token, profile: signed } = await api<{ token: string; profile: Profile }>(
        "/api/auth/verify",
        { body: { address, signature, referralCode: ref } },
      );
      localStorage.setItem("cookout_token", token);
      let next = signed;
      const name = username?.trim().slice(0, 24);
      // Only (re)name when a handle was supplied and actually differs — a
      // returning account keeps the name it already chose.
      if (name && name !== signed.displayName) {
        try {
          next = await api<Profile>("/api/me", { method: "PATCH", body: { displayName: name } });
        } catch {
          /* keep the auto profile if the rename fails — they're already in */
        }
      }
      setProfile(next);
      setPlayNowOpen(false);
      audio.play("ui.walletConnect");
    } catch (e) {
      // On the dev/whitelist site a fresh account hits the 403 gate; surface it.
      setAuthError((e as Error).message || "Couldn't start your account. Please try again.");
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  // Sign out drops the session but KEEPS the local account key, so "Play Now"
  // signs back in as the same player. (The key is the account; wiping it would
  // orphan their XP/history.)
  const signOut = useCallback(() => {
    localStorage.removeItem("cookout_token");
    setProfile(null);
  }, []);

  const clearAuthError = useCallback(() => setAuthError(""), []);
  const promptPlayNow = useCallback(() => setPlayNowOpen(true), []);
  const closePlayNow = useCallback(() => setPlayNowOpen(false), []);

  return (
    <Ctx.Provider
      value={{
        profile,
        signIn,
        signInLocal,
        signOut,
        refresh,
        busy,
        ready,
        authError,
        clearAuthError,
        playNowOpen,
        promptPlayNow,
        closePlayNow,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
