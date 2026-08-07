"use client";

import { useEffect, useState } from "react";

/**
 * Is a graduated coin's Uniswap pool on DEX Screener yet?
 *
 * A bonded coin has two different markets behind it, and only one of them is
 * ours: the round's bonding curve (our candles, which exist nowhere on chain)
 * and the Uniswap pool it graduated into (real trades, which we do not index).
 * So this is never a replacement for our chart — it is the second half of the
 * story, and it only exists once someone else has indexed the pool.
 *
 * Indexing is not instant and not guaranteed, which is why this asks rather
 * than assuming. A link built from a guessed URL would 404 for hours after a
 * launch, and a dead link on a fresh coin looks like a broken product.
 */

/** DEX Screener's slug for Robinhood Chain, by our chain id. */
const CHAIN_SLUG: Record<number, string> = {
  4663: "robinhood",
  46630: "robinhood", // testnet pools are not indexed; the check will say so
};

export interface DexPair {
  /** Canonical page, taken from the API rather than built from a guess. */
  url: string;
  pairAddress: string;
  chainSlug: string;
  /** "v2" | "v3" | "v4" — ours graduate into v4. */
  label?: string;
  dexId?: string;
}

export type DexState =
  | { status: "unsupported" }
  | { status: "checking" }
  | { status: "missing" }
  | { status: "indexed"; pair: DexPair };

/** The embeddable chart for a pair. */
export function embedUrl(pair: DexPair): string {
  return `https://dexscreener.com/${pair.chainSlug}/${pair.pairAddress}?embed=1&theme=dark&info=0`;
}

/**
 * Watch for the pool showing up.
 *
 * Polls slowly and only while it is still missing: a coin can graduate minutes
 * before an indexer notices, and the answer never changes back once found.
 */
export function useDexPair(chainId?: number, tokenAddress?: string): DexState {
  const [state, setState] = useState<DexState>({ status: "checking" });

  useEffect(() => {
    const slug = chainId ? CHAIN_SLUG[chainId] : undefined;
    if (!slug || !tokenAddress) {
      setState({ status: "unsupported" });
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      try {
        const res = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as {
          pairs: Array<{
            chainId: string;
            url: string;
            pairAddress: string;
            labels?: string[];
            dexId?: string;
            liquidity?: { usd?: number };
          }> | null;
        };
        if (!alive) return;
        // Same token can appear on several chains; only ours counts. Deepest
        // pool wins when a coin somehow has more than one.
        const mine = (body.pairs ?? [])
          .filter((p) => p.chainId === slug)
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        const hit = mine[0];
        if (hit) {
          setState({
            status: "indexed",
            pair: {
              url: hit.url,
              pairAddress: hit.pairAddress,
              chainSlug: hit.chainId,
              label: hit.labels?.[0],
              dexId: hit.dexId,
            },
          });
          return; // settled — stop polling
        }
        setState({ status: "missing" });
        timer = setTimeout(() => void check(), 120_000);
      } catch {
        // Their API being down is not our coin's problem: fall back to the
        // state that hides the panel rather than showing a broken one.
        if (alive) setState({ status: "missing" });
      }
    };
    void check();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [chainId, tokenAddress]);

  return state;
}
