"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";

export interface Profile {
  address: string;
  displayName?: string;
  xp: number;
  level: number;
  title: string;
  paperBalance: number;
  achievements: string[];
  referralCode: string;
  creatorReputation: number;
  stats: Record<string, number>;
  jackpotWinnings?: number;
  jackpotWins?: { week: string; rank: number; amountEth: number; amountUsd: number; at: number }[];
}

interface Session {
  profile: Profile | null;
  signIn: () => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
  busy: boolean;
  /** True once the initial token check has resolved (gate waits on this). */
  ready: boolean;
  /** Human-readable sign-in problem (no wallet / not whitelisted). */
  authError: string;
  clearAuthError: () => void;
}

const Ctx = createContext<Session>({
  profile: null,
  signIn: async () => {},
  signOut: () => {},
  refresh: async () => {},
  busy: false,
  ready: false,
  authError: "",
  clearAuthError: () => {},
});

/**
 * Wallet-based auth. Requires a real injected wallet (window.ethereum) — there
 * is no burner/guest fallback: during the private beta only whitelisted (and
 * dev) wallets may sign in, so a self-generated key would be pointless. The
 * server only ever sees address + signature.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState("");

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
    } catch (e) {
      // 403 during the beta = wallet not whitelisted; surface the server copy.
      setAuthError((e as Error).message || "Sign-in failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem("cookout_token");
    setProfile(null);
  }, []);

  const clearAuthError = useCallback(() => setAuthError(""), []);

  return (
    <Ctx.Provider
      value={{ profile, signIn, signOut, refresh, busy, ready, authError, clearAuthError }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
