"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api } from "./api";
import { audio } from "./audio";

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
  /** Open the Privy login (email / social / wallet). Alias: promptPlayNow. */
  signIn: () => Promise<void>;
  /** Same as signIn — the name action gates use when nudging a guest to play. */
  promptPlayNow: () => void;
  signOut: () => void;
  refresh: () => Promise<void>;
  busy: boolean;
  /** True once the initial auth check has resolved (gate waits on this). */
  ready: boolean;
  /** Human-readable sign-in problem. */
  authError: string;
  clearAuthError: () => void;
}

const Ctx = createContext<Session>({
  profile: null,
  signIn: async () => {},
  promptPlayNow: () => {},
  signOut: () => {},
  refresh: async () => {},
  busy: false,
  ready: false,
  authError: "",
  clearAuthError: () => {},
});

const PRIVY_ENABLED = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

/**
 * Shared session state used by both provider variants: our own token/profile,
 * loaded from the API on mount if a session already exists. Auth identity comes
 * from Privy (the server verifies the token and keys the account to the embedded
 * wallet), so there is no wallet/keypair handling in the client anymore.
 */
function useSessionCore() {
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

  const clearAuthError = useCallback(() => setAuthError(""), []);

  return {
    profile,
    setProfile,
    busy,
    setBusy,
    ready,
    setReady,
    authError,
    setAuthError,
    refresh,
    clearAuthError,
  };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  // The choice is a build-time constant, so this branch is stable across renders
  // (never violates the rules of hooks) — PrivySession calls usePrivy, which is
  // only valid under a PrivyProvider, which only exists when the app id is set.
  return PRIVY_ENABLED ? (
    <PrivySession>{children}</PrivySession>
  ) : (
    <InertSession>{children}</InertSession>
  );
}

/** Real provider: bridges Privy auth → our session. */
function PrivySession({ children }: { children: React.ReactNode }) {
  const core = useSessionCore();
  const { setProfile, setBusy, setAuthError, refresh } = core;
  const router = useRouter();
  const { ready: privyReady, authenticated, login, logout, getAccessToken } = usePrivy();
  const exchanging = useRef(false);

  // When Privy reports an authenticated user and we don't yet hold our own
  // session, exchange the Privy access token for our session token, stake the
  // starter pETH, and drop them into a match.
  useEffect(() => {
    if (!privyReady || !authenticated) return;
    if (core.profile || localStorage.getItem("cookout_token")) return; // already in
    if (exchanging.current) return;
    exchanging.current = true;

    void (async () => {
      setBusy(true);
      setAuthError("");
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("No Privy session token.");
        const ref = new URLSearchParams(window.location.search).get("ref") ?? undefined;
        const { token: sessionToken, profile } = await api<{ token: string; profile: Profile }>(
          "/api/auth/privy",
          { body: { token, referralCode: ref } },
        );
        localStorage.setItem("cookout_token", sessionToken);
        setProfile(profile);
        // Stake the starter into the arena so they can play immediately (server
        // caps at the available bank; failure is non-fatal).
        try {
          await api("/api/me/arena/transfer", { body: { amount: 1e9, direction: "deposit" } });
          setProfile(await api<Profile>("/api/me"));
        } catch {
          /* they're in; they can stake manually */
        }
        audio.play("ui.walletConnect");
        // Send them into the arena only if they started at the front door; a
        // silent re-auth (expired session, Privy still logged in) or a login
        // triggered from a specific page leaves them where they are.
        if (window.location.pathname === "/") router.push("/matches");
      } catch (e) {
        setAuthError((e as Error).message || "Sign-in failed. Please try again.");
      } finally {
        setBusy(false);
        exchanging.current = false;
      }
    })();
  }, [
    privyReady,
    authenticated,
    core.profile,
    getAccessToken,
    router,
    setBusy,
    setAuthError,
    setProfile,
  ]);

  const signIn = useCallback(async () => {
    setAuthError("");
    login();
  }, [login, setAuthError]);

  const promptPlayNow = useCallback(() => {
    setAuthError("");
    login();
  }, [login, setAuthError]);

  const signOut = useCallback(() => {
    localStorage.removeItem("cookout_token");
    setProfile(null);
    void logout();
  }, [logout, setProfile]);

  return (
    <Ctx.Provider
      value={{
        profile: core.profile,
        signIn,
        promptPlayNow,
        signOut,
        refresh,
        busy: core.busy,
        ready: core.ready && privyReady,
        authError: core.authError,
        clearAuthError: core.clearAuthError,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

/** Fallback when Privy isn't configured: sessions still load from an existing
 *  token, but there's no way to log in. Keeps local dev / early builds working. */
function InertSession({ children }: { children: React.ReactNode }) {
  const core = useSessionCore();
  const notConfigured = useCallback(
    () => core.setAuthError("Login isn't configured in this environment."),
    [core],
  );
  const signIn = useCallback(async () => notConfigured(), [notConfigured]);
  const signOut = useCallback(() => {
    localStorage.removeItem("cookout_token");
    core.setProfile(null);
  }, [core]);

  return (
    <Ctx.Provider
      value={{
        profile: core.profile,
        signIn,
        promptPlayNow: notConfigured,
        signOut,
        refresh: core.refresh,
        busy: core.busy,
        ready: core.ready,
        authError: core.authError,
        clearAuthError: core.clearAuthError,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
