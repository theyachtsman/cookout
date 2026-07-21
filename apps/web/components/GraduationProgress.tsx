"use client";

import { useEffect, useRef, useState } from "react";
import type { RoundConfig } from "@cookout/shared";
import { playMilestone } from "../lib/sfx";

const usd = (n: number) =>
  `$${n >= 1000 ? (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k" : n.toFixed(0)}`;

/** Live bonding progress toward the $40k serve-up — USD-first display. */
/** Quarter marks worth celebrating on the way to the serve-up. */
const MILESTONES = [25, 50, 75, 100];

export function GraduationProgress({
  config,
  ticker,
  onMilestone,
  muted,
}: {
  config: RoundConfig;
  ticker: { mcap: number; volume: number; holders: number; ethUsd?: number };
  /** Announce the crossing so the page can push it to the event feed. */
  onMilestone?: (pct: number) => void;
  muted?: boolean;
}) {
  const ethUsd = ticker.ethUsd ?? 1925;
  const bars = [
    {
      label: "Market cap",
      now: ticker.mcap,
      goal: config.graduationMcap,
      fmt: (v: number) => usd(v * ethUsd),
    },
    {
      label: "Volume",
      now: ticker.volume,
      goal: config.graduationMinVolume,
      fmt: (v: number) => usd(v * ethUsd),
    },
    {
      label: "Holders",
      now: ticker.holders,
      goal: config.graduationMinHolders,
      fmt: (v: number) => String(Math.round(v)),
    },
  ];
  const overall = Math.min(...bars.map((b) => b.now / b.goal));
  const graduating = overall >= 1;

  // Milestone crossings glow and expand for a beat, once each. Ratcheted, so a
  // dip back under 50% doesn't re-fire the celebration on the way up again.
  const [celebrating, setCelebrating] = useState<number | null>(null);
  const passed = useRef<Set<number>>(new Set());
  const pctNow = Math.min(100, overall * 100);
  useEffect(() => {
    for (const m of MILESTONES) {
      if (pctNow >= m && !passed.current.has(m)) {
        passed.current.add(m);
        setCelebrating(m);
        onMilestone?.(m);
        if (!muted) playMilestone();
        setTimeout(() => setCelebrating((c) => (c === m ? null : c)), 1600);
      }
    }
  }, [pctNow, onMilestone, muted]);

  return (
    <div
      className={`relative rounded-xl border px-4 py-3 transition-all duration-500 ${
        celebrating
          ? "scale-[1.015] border-lime-400/70 bg-lime-400/10 shadow-[0_0_30px_rgba(163,230,53,0.35)]"
          : graduating
            ? "border-emerald-500/60 bg-emerald-500/10"
            : "border-zinc-800"
      }`}
    >
      {celebrating && (
        <div className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 animate-[bannerIn_.35s_cubic-bezier(.2,1.5,.4,1)] rounded-full border border-lime-400/60 bg-zinc-950 px-3 py-1 text-[11px] font-black text-lime-300 shadow-lg shadow-black/50">
          🎯 Bonding passed {celebrating}%
        </div>
      )}
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-bold text-zinc-300">
          🍽️ Bonding progress {graduating && "— targets met, serving up!"}
        </span>
        <span className="font-mono text-zinc-400">
          {usd(bars[0]!.now * ethUsd)} / {usd(bars[0]!.goal * ethUsd)} ·{" "}
          {Math.min(100, overall * 100).toFixed(0)}%
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {bars.map((b) => {
          const pct = Math.min(100, (b.now / b.goal) * 100);
          return (
            <div key={b.label}>
              <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
                <div
                  className={`h-full transition-[width] duration-700 ${
                    pct >= 100 ? "bg-emerald-400" : "bg-lime-400"
                  } ${celebrating ? "shadow-[0_0_12px_rgba(163,230,53,0.9)]" : ""}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
                <span>{b.label}</span>
                <span className="font-mono">
                  {b.fmt(b.now)}/{b.fmt(b.goal)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
