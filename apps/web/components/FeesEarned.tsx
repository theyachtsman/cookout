"use client";

import { CREATOR_FEE_SHARE } from "@cookout/shared";
import { fmtAmount, useDenomPref, useEthUsd } from "../lib/ethUsd";

/**
 * Accrued creator fees, with a native/USD toggle (the preference is shared
 * site-wide via useDenomPref). Used on a player's own profile and their public
 * creator page. Fees are the creator's cut of trading fees, paid into their
 * Cook Out balance as each of their rounds ends.
 */
export function FeesEarned({
  eth,
  unit = "pETH",
  self = false,
}: {
  eth: number;
  unit?: string;
  self?: boolean;
}) {
  const [usd, setUsd] = useDenomPref();
  const peg = useEthUsd();
  return (
    <section className="rounded-2xl bg-gradient-to-br from-lime-400/[0.1] to-lime-400/[0.02] p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-lime-300">
          💰 Creator Fees Earned
        </h2>
        <button
          onClick={() => setUsd(!usd)}
          className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-bold text-zinc-300 transition hover:bg-zinc-700"
          title="Toggle between native and USD"
        >
          {usd ? "USD" : unit} ⇄
        </button>
      </div>
      <div className="mt-1 font-mono text-3xl font-black text-lime-300">
        {fmtAmount(eth, usd, peg, unit)}
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {self ? "Your" : "Their"} {Math.round(CREATOR_FEE_SHARE * 100)}% cut of trading fees from
        every coin {self ? "you've" : "they've"} launched.{" "}
        {self && "Paid straight into your Cook Out balance as each round ends."}
      </p>
    </section>
  );
}
