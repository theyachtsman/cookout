"use client";

import type { AuctionResult, Round, RoundSummary } from "@cookout/shared";
import { CreatorBadge } from "./CreatorBadge";

function addr(a?: { address: string }) {
  return a ? `${a.address.slice(0, 6)}…${a.address.slice(-4)}` : "—";
}

export function Results({
  round,
  summary,
  auction,
}: {
  round: Round;
  summary: RoundSummary;
  auction: AuctionResult | null;
}) {
  const unit = round.chain ? "ETH" : "pETH";
  return (
    <div className="rounded-xl border border-zinc-800 p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-black">
          Round Over <span className="font-mono text-zinc-500">${round.token.symbol}</span>
        </h3>
        <span
          className={`rounded px-2 py-0.5 text-xs font-bold ${
            summary.graduated
              ? "bg-emerald-500/20 text-emerald-300"
              : summary.endReason === "rug_detected" || summary.endReason === "liquidity_removed"
                ? "bg-red-500/20 text-red-300"
                : "bg-zinc-800 text-zinc-300"
          }`}
        >
          {summary.graduated ? "🍽️ SERVED UP · Cook Out Alumni" : summary.endReason.replace("_", " ")}
        </span>
        <span className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Created by</span>
          <CreatorBadge address={round.creatorAddress} />
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm md:grid-cols-3">
        <R k="Winner" v={`${addr(summary.winner)} (${(summary.winner?.pnl ?? 0).toFixed(3)})`} />
        <R k="Best trade" v={`${addr(summary.bestTrade)} (+${(summary.bestTrade?.pnl ?? 0).toFixed(3)})`} />
        <R k="Biggest whale" v={`${addr(summary.biggestWhale)} (${(summary.biggestWhale?.ethIn ?? 0).toFixed(2)} ${unit})`} />
        <R k="Diamond hands" v={`${addr(summary.diamondHands)} (${summary.diamondHands?.holdSeconds ?? 0}s)`} />
        <R k="Fastest exit" v={`${addr(summary.fastestExit)} (${summary.fastestExit?.seconds ?? "—"}s)`} />
        <R k="Avg return" v={`${summary.averageReturnPct.toFixed(1)}%`} />
        <R k="Duration" v={`${summary.durationSeconds}s`} />
        <R k="Total volume" v={`${summary.totalVolume.toFixed(2)} ${unit}`} />
        <R k="Peak mcap" v={`${summary.peakMcap.toFixed(1)} ${unit}`} />
      </div>
      {auction && (
        <p className="mt-4 border-t border-zinc-800 pt-3 text-xs text-zinc-500">
          Opened via batch auction at {auction.clearingPrice.toExponential(4)} ·{" "}
          {auction.fills.length} intents · fill ratio {(auction.fillRatio * 100).toFixed(0)}% ·
          audit hash <span className="font-mono">{auction.auditHash}</span>. Recompute it from the
          published intents to verify settlement.
        </p>
      )}
    </div>
  );
}

function R({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</div>
      <div className="font-mono">{v}</div>
    </div>
  );
}
