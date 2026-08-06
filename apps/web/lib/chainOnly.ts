"use client";

import { useEffect, useState } from "react";

/**
 * Chain-only mode: the dev/staging site runs real on-chain rounds, so paper
 * money (pETH) disappears from the chrome and the arena wallet takes its
 * place. Detected from the host at runtime (dev./localhost) — same signal as
 * the dev banner — or forced with NEXT_PUBLIC_CHAIN_ONLY=1. Production www
 * stays paper until the real-money launch flips it.
 */
export function useChainOnly(): boolean {
  const [on, setOn] = useState(process.env.NEXT_PUBLIC_CHAIN_ONLY === "1");
  useEffect(() => {
    const h = window.location.hostname.toLowerCase();
    if (h.startsWith("dev.") || h === "localhost" || h === "127.0.0.1") setOn(true);
  }, []);
  return on;
}

/** The money label for profile/global surfaces: real ETH on the chain-only
 *  site, pETH on the paper beta. Round-scoped surfaces should key off
 *  `round.chain` instead so archived paper rounds stay honest. */
export function useUnit(): "ETH" | "pETH" {
  return useChainOnly() ? "ETH" : "pETH";
}

/**
 * Is the Squad Collection — recruits, Recruit Crates, the whole NFT surface —
 * visible on this site?
 *
 * Unannounced. It runs on dev while we build it and reveals itself on the
 * public site the day that site goes on chain, which is the same day the
 * collection becomes real. Deliberately keyed to the host rather than a
 * feature flag: a flag lives in the database, defaults to on, and would
 * expose the whole thing on a fresh deploy or a restored backup. This cannot.
 *
 * Separate from the Burger economy, which stays visible everywhere.
 */
export function useCollectionVisible(): boolean {
  return useChainOnly();
}
