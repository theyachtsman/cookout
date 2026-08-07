"use client";

import { useState } from "react";
import { embedUrl, useDexPair, type DexState } from "../lib/dexscreener";

/**
 * Chart source switch for a coin that has bonded out.
 *
 * A graduated coin has two markets and they are not the same chart. Ours is
 * the round that created the coin — the auction, the curve, every trade that
 * decided whether it graduated at all — and none of that exists on chain.
 * DEX Screener's is the Uniswap pool it graduated into, which is where the
 * coin actually lives now and which we do not index.
 *
 * So this is a toggle, not a replacement. Neither view can answer the other's
 * question, and quietly swapping one for the other would delete the entire
 * pre-bond history from the only place it is visible.
 */
export function ChartSource({
  chainId,
  tokenAddress,
  symbol,
  children,
}: {
  chainId?: number;
  tokenAddress?: string;
  symbol: string;
  /** Our own chart, rendered when "Cook Out" is selected. */
  children: React.ReactNode;
}) {
  const dex = useDexPair(chainId, tokenAddress);
  const [source, setSource] = useState<"cookout" | "dex">("cookout");

  // Nothing to offer: paper coins, or a chain we have no slug for.
  if (dex.status === "unsupported") return <>{children}</>;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {dex.status === "indexed" ? (
          <div className="flex overflow-hidden rounded-full bg-zinc-900/70 text-[11px] font-bold">
            {(
              [
                ["cookout", "Cook Out"],
                ["dex", "DEX Screener"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSource(key)}
                className={`px-3 py-1 ${
                  source === key ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <Pending state={dex} />
        )}

        {dex.status === "indexed" && (
          <a
            href={dex.pair.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-[11px] font-bold text-zinc-500 hover:text-lime-300"
          >
            Open on DEX Screener ↗
          </a>
        )}
      </div>

      {dex.status === "indexed" && source === "dex" ? (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
          <iframe
            key={dex.pair.pairAddress}
            src={embedUrl(dex.pair)}
            title={`${symbol} on DEX Screener`}
            className="h-[28rem] w-full border-0"
            loading="lazy"
          />
          <div className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-500">
            The Uniswap pool — trading since it bonded. The Cook Out tab has the
            round that got it here, which does not exist on chain.
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

/**
 * The honest state before an indexer has noticed the pool.
 *
 * Deliberately not a link. A URL built from a guess resolves to an empty page
 * for as long as indexing takes, and a dead link on a coin that just launched
 * reads as a broken product rather than as a third party being slow.
 */
function Pending({ state }: { state: DexState }) {
  if (state.status === "checking")
    return <span className="text-[11px] text-zinc-600">Checking DEX Screener…</span>;
  return (
    <span className="text-[11px] text-zinc-600">
      Not on DEX Screener yet — the pool shows up once an indexer picks it up.
    </span>
  );
}
