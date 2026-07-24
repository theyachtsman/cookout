"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * The live ETH/USD peg, so any surface can offer a dollar view of pETH
 * balances. The jackpot status already carries the server's peg, so we borrow
 * it from there rather than adding a new endpoint. Cached across mounts and
 * refreshed on a slow poll; falls back to the server default until the first
 * fetch lands.
 */
let cached: number | undefined;

export function useEthUsd(): number {
  const [peg, setPeg] = useState<number>(cached ?? 1925);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ ethUsd?: number }>("/api/jackpot")
        .then((d) => {
          if (alive && d.ethUsd && d.ethUsd > 0) {
            cached = d.ethUsd;
            setPeg(d.ethUsd);
          }
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return peg;
}

/** Render an ETH/pETH amount in the chosen denomination. */
export function fmtAmount(eth: number, usd: boolean, peg: number, unit = "pETH", dp = 3): string {
  return usd ? `$${(eth * peg).toFixed(2)}` : `${eth.toFixed(dp)} ${unit}`;
}

/** Persisted native/USD preference so the toggle sticks across the site. */
export function useDenomPref(): [boolean, (v: boolean) => void] {
  const [usd, setUsd] = useState(false);
  useEffect(() => {
    setUsd(localStorage.getItem("cookout:denom") === "usd");
  }, []);
  const set = (v: boolean) => {
    setUsd(v);
    try {
      localStorage.setItem("cookout:denom", v ? "usd" : "native");
    } catch {
      /* ignore */
    }
  };
  return [usd, set];
}
