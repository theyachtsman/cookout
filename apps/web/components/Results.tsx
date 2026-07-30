"use client";

import Link from "next/link";
import { useState } from "react";
import type { AuctionResult, RedemptionEntry, Round, RoundSummary } from "@cookout/shared";
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
    <div className="rounded-2xl bg-zinc-900/40 p-5">
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
      {summary.redemption && summary.redemption.length > 0 && (
        <RedemptionBreakdown
          rows={summary.redemption}
          price={summary.redemptionPrice}
          unit={unit}
        />
      )}

      {auction && (
        <p className="mt-4 pt-3 text-xs text-zinc-500">
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

/**
 * The redemption breakdown: when a round does not graduate, everyone still
 * holding cashes out at one uniform price. This lists what each player was paid,
 * hidden behind a toggle so it does not crowd the summary.
 */
function RedemptionBreakdown({
  rows,
  price,
  unit,
}: {
  rows: RedemptionEntry[];
  price?: number;
  unit: string;
}) {
  const [open, setOpen] = useState(false);
  const total = rows.reduce((sum, r) => sum + r.eth, 0);
  const name = (r: RedemptionEntry) =>
    r.displayName ?? `${r.address.slice(0, 6)}…${r.address.slice(-4)}`;
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left text-sm font-black text-zinc-200"
      >
        <span>Redemption breakdown</span>
        <span className="font-mono text-xs font-normal text-zinc-500">{rows.length} paid</span>
        <svg
          viewBox="0 0 24 24"
          className={`ml-auto h-4 w-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <p className="mt-0.5 text-xs text-zinc-500">
        No graduation, so everyone still holding was cashed out at one price
        {price ? (
          <>
            {" "}
            (<span className="font-mono text-zinc-400">{price.toExponential(3)}</span> {unit}/token)
          </>
        ) : null}
        . Pro rata by tokens held, no exit-order advantage.
      </p>

      {open && (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-3 px-3 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
            <span className="min-w-0 flex-1">Player</span>
            <span className="w-24 text-right">Tokens</span>
            <span className="w-24 text-right">Paid</span>
            <span className="w-20 text-right">PnL</span>
          </div>
          <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {rows.map((r) => (
              <Link
                key={r.address}
                href={`/profile/${r.address}`}
                className="flex items-center gap-3 rounded-xl bg-zinc-950/40 px-3 py-2 transition hover:bg-zinc-900/70"
              >
                <span className="min-w-0 flex-1 truncate font-bold text-zinc-100">{name(r)}</span>
                <span className="w-24 text-right font-mono text-xs text-zinc-400">
                  {r.tokens.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
                <span className="w-24 text-right font-mono text-sm text-lime-300">
                  {r.eth.toFixed(4)}
                </span>
                <span
                  className={`w-20 text-right font-mono text-xs font-bold ${
                    r.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {r.pnl >= 0 ? "+" : ""}
                  {r.pnl.toFixed(3)}
                </span>
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3 px-3 pt-1 text-xs">
            <span className="flex-1 font-bold text-zinc-400">Total paid out</span>
            <span className="font-mono font-black text-lime-300">
              {total.toFixed(4)} {unit}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
