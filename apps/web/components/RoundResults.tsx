"use client";

import { useState } from "react";
import type { RoundSummary } from "@cookout/shared";
import { PnlShareCard } from "./PnlShareCard";

/**
 * End-of-round results overlay for rounds that rug or miss graduation: the
 * round's story plus YOUR breakdown — what you had at the bell, what the
 * uniform redemption returned, and the round P&L. Dismissible; the full
 * Results card stays on the page underneath.
 */

export interface EndBreakdown {
  /** Cost basis of the bag still held when the round ended. */
  invested: number;
  heldTokens: number;
  /** What the uniform redemption paid back for that bag. */
  returned: number;
  /** Total realized P&L for the round, redemption included. */
  roundPnl: number;
}

const REASON: Record<string, { title: string; emoji: string; note: string; tone: string }> = {
  rug_detected: {
    title: "BURNT",
    emoji: "🔥",
    note: "Liquidity drained — every remaining holder exited at the same salvage price. No exit-order games, even in a rug.",
    tone: "text-red-400",
  },
  liquidity_removed: {
    title: "BURNT",
    emoji: "🔥",
    note: "Liquidity pulled — everyone remaining exited at one uniform salvage price.",
    tone: "text-red-400",
  },
  timer: {
    title: "ROUND OVER",
    emoji: "⏱",
    note: "Bonding targets missed at the bell — every remaining holder exited at one uniform redemption price.",
    tone: "text-zinc-200",
  },
  low_volume: {
    title: "ROUND OVER",
    emoji: "💤",
    note: "Volume went quiet — the round closed and everyone exited at one uniform redemption price.",
    tone: "text-zinc-200",
  },
  mcap_target: {
    title: "TARGET HIT",
    emoji: "🎯",
    note: "Market-cap target reached — the round settled at one uniform price.",
    tone: "text-lime-300",
  },
};

export function RoundResultsOverlay({
  summary,
  symbol,
  artworkUrl,
  shareName,
  unit,
  ethUsd,
  breakdown,
  onClose,
}: {
  summary: RoundSummary;
  symbol: string;
  artworkUrl?: string;
  shareName?: string;
  unit: string;
  ethUsd: number;
  breakdown: EndBreakdown | null;
  onClose: () => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const r = REASON[summary.endReason] ?? REASON.timer!;
  const usd = (v: number) =>
    `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(2) + "k" : Math.abs(v).toFixed(2)}`;
  const played = breakdown && (breakdown.invested > 0 || breakdown.roundPnl !== 0);
  const pnl = breakdown?.roundPnl ?? 0;
  const up = pnl >= 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-[fadein_.3s_ease] rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          <div className="text-5xl">{r.emoji}</div>
          <h2 className={`mt-2 text-3xl font-black tracking-tight ${r.tone}`}>{r.title}</h2>
          <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">{r.note}</p>
        </div>

        {played && breakdown && (
          <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Your round
            </div>
            <div className={`mt-1 font-mono text-4xl font-black ${up ? "text-emerald-400" : "text-red-400"}`}>
              {up ? "+" : ""}
              {usd(pnl * ethUsd)}
            </div>
            <div className={`font-mono text-xs ${up ? "text-emerald-400/70" : "text-red-400/70"}`}>
              {up ? "+" : ""}
              {pnl.toFixed(4)} {unit} round P&amp;L
            </div>
            <dl className="mt-4 space-y-1.5 text-sm">
              {breakdown.heldTokens > 0 && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-zinc-500">Held at the bell</dt>
                    <dd className="font-mono text-zinc-200">
                      {breakdown.heldTokens >= 1000
                        ? `${(breakdown.heldTokens / 1000).toFixed(1)}k`
                        : breakdown.heldTokens.toFixed(0)}{" "}
                      {symbol}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-zinc-500">Cost of that bag</dt>
                    <dd className="font-mono text-zinc-200">
                      {breakdown.invested.toFixed(4)} {unit}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-zinc-500">Returned by redemption</dt>
                    <dd className="font-mono font-bold text-amber-300">
                      {breakdown.returned.toFixed(4)} {unit} ({usd(breakdown.returned * ethUsd)})
                    </dd>
                  </div>
                </>
              )}
              {breakdown.heldTokens <= 0 && (
                <div className="text-xs text-zinc-500">
                  You were fully out before the end — nothing left to redeem.
                </div>
              )}
            </dl>
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ["Duration", `${Math.floor(summary.durationSeconds / 60)}m ${summary.durationSeconds % 60}s`],
            ["Volume", `${summary.totalVolume.toFixed(2)} ${unit}`],
            ["Peak mcap", usd(summary.peakMcap * ethUsd)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-zinc-900 p-2">
              <div className="text-[9px] uppercase tracking-wide text-zinc-500">{k}</div>
              <div className="font-mono text-xs font-bold text-zinc-200">{v}</div>
            </div>
          ))}
        </div>
        {summary.winner && (
          <div className="mt-2 text-center text-xs text-zinc-500">
            Round winner:{" "}
            <span className="font-mono text-zinc-300">
              {summary.winner.address.slice(0, 6)}…{summary.winner.address.slice(-4)}
            </span>{" "}
            <span className="font-mono text-emerald-400">+{summary.winner.pnl.toFixed(3)}</span>
          </div>
        )}

        <div className="mt-5 flex gap-2">
          {played && breakdown && (
            <button
              onClick={() => setShareOpen(true)}
              className={`flex-1 rounded-lg py-2.5 font-black text-zinc-950 ${
                up ? "bg-emerald-500 hover:bg-emerald-400" : "bg-red-500 hover:bg-red-400"
              }`}
            >
              ➦ Share the damage
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-zinc-800 py-2.5 font-black text-zinc-200 hover:bg-zinc-700"
          >
            Dismiss
          </button>
        </div>
        {shareOpen && breakdown && (
          <PnlShareCard
            onClose={() => setShareOpen(false)}
            data={{
              symbol,
              artworkUrl,
              label: "ROUND P&L",
              pct: breakdown.invested > 0 ? (breakdown.roundPnl / breakdown.invested) * 100 : 0,
              pnlUsd: breakdown.roundPnl * ethUsd,
              valueUsd: breakdown.returned * ethUsd,
              costUsd: breakdown.invested * ethUsd,
              name: shareName,
            }}
          />
        )}
      </div>
    </div>
  );
}
