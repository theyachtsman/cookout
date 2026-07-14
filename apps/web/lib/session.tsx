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
}

interface Session {
  profile: Profile | null;
  signIn: () => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
  busy: boolean;
}

const Ctx = createContext<Session>({
  profile: null,
  signIn: async () => {},
  signOut: () => {},
  refresh: async () => {},
  busy: false,
});

/**
 * Wallet-based auth. Uses the injected wallet (window.ethereum) when present;
 * otherwise generates a local burner key so the paper MVP is playable
 * anywhere. Either way the server only ever sees address + signature.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!localStorage.getItem("cookout_token")) return;
    try {
      setProfile(await api<Profile>("/api/me"));
    } catch {
      localStorage.removeItem("cookout_token");
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async () => {
    setBusy(true);
    try {
      const { privateKeyToAccount, generatePrivateKey } = await import("viem/accounts");
      let address: string;
      let sign: (message: string) => Promise<string>;

      const eth = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } })
        .ethereum;
      if (eth) {
        const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
        address = accounts[0]!;
        sign = async (message) => {
          const hex = Array.from(new TextEncoder().encode(message))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          return (await eth.request({
            method: "personal_sign",
            params: [`0x${hex}`, address],
          })) as string;
        };
      } else {
        let pk = localStorage.getItem("cookout_burner") as `0x${string}` | null;
        if (!pk) {
          pk = generatePrivateKey();
          localStorage.setItem("cookout_burner", pk);
        }
        const account = privateKeyToAccount(pk);
        address = account.address;
        sign = (message) => account.signMessage({ message });
      }

      const { message } = await api<{ message: string }>("/api/auth/nonce", {
        body: { address },
      });
      const signature = await sign(message);
      const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
      const { token, profile } = await api<{ token: string; profile: Profile }>(
        "/api/auth/verify",
        { body: { address, signature, referralCode: ref } },
      );
      localStorage.setItem("cookout_token", token);
      setProfile(profile);
    } finally {
      setBusy(false);
    }
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem("cookout_token");
    setProfile(null);
  }, []);

  return <Ctx.Provider value={{ profile, signIn, signOut, refresh, busy }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
