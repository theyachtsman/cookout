"use client";

import { useEffect, useState } from "react";
import { MAX_SLIPPAGE_BPS } from "@cookout/shared";
import { setSlippageBps, slippageBps } from "../lib/chainTx";

/**
 * Trade slippage tolerance, for on-chain rounds.
 *
 * Every buy and sell now sends a minimum-out, which is what stops a trade from
 * filling at a price the player never agreed to. That protection has a visible
 * cost — a trade can revert when the price moves — so the tolerance has to be
 * theirs to set, and visible at the moment they trade. A hidden floor just
 * reads as "the button is broken".
 */

const PRESETS = [50, 100, 300, 1_000];

export function SlippageControl({ compact = false }: { compact?: boolean }) {
  const [bps, setBps] = useState(100);
  const [open, setOpen] = useState(false);

  useEffect(() => setBps(slippageBps()), []);

  const choose = (next: number) => {
    const clamped = Math.min(Math.max(next, 1), MAX_SLIPPAGE_BPS);
    setBps(clamped);
    setSlippageBps(clamped);
    setOpen(false);
  };

  const label = `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Maximum price movement you'll accept before the trade reverts"
        className={`rounded-lg bg-zinc-800/60 font-bold text-zinc-400 transition hover:bg-zinc-700 hover:text-zinc-200 ${
          compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"
        }`}
      >
        ⇅ {label}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl bg-zinc-900 p-3 shadow-2xl ring-1 ring-white/10">
          <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">
            Slippage tolerance
          </div>
          <p className="mt-1 text-[11px] leading-snug text-zinc-500">
            How far the price may move against you before the trade reverts instead of filling.
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => choose(p)}
                className={`rounded-lg px-2 py-1 text-xs font-bold transition ${
                  bps === p
                    ? "bg-lime-400 text-zinc-950"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {p / 100}%
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-snug text-zinc-600">
            Higher fills more often on a fast curve. Lower protects the price you saw. Capped at{" "}
            {MAX_SLIPPAGE_BPS / 100}% — past that it stops protecting anything.
          </p>
        </div>
      )}
    </div>
  );
}
