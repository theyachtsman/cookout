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
