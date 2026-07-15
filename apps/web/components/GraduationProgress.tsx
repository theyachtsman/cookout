"use client";

import type { RoundConfig } from "@cookout/shared";

const usd = (n: number) =>
  `$${n >= 1000 ? (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k" : n.toFixed(0)}`;

/** Live bonding progress toward the $40k serve-up — USD-first display. */
export function GraduationProgress({
  config,
  ticker,
}: {
  config: RoundConfig;
  ticker: { mcap: number; volume: number; holders: number; ethUsd?: number };
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

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        graduating ? "border-emerald-500/60 bg-emerald-500/10" : "border-zinc-800"
      }`}
    >
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
                  className={`h-full transition-[width] duration-700 ${pct >= 100 ? "bg-emerald-400" : "bg-lime-400"}`}
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
