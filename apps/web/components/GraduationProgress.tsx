"use client";

import type { RoundConfig } from "@cookout/shared";

/** Live bonding progress: the three graduation criteria, updated per tick. */
export function GraduationProgress({
  config,
  ticker,
}: {
  config: RoundConfig;
  ticker: { mcap: number; volume: number; holders: number };
}) {
  const bars = [
    { label: "Market cap", now: ticker.mcap, goal: config.graduationMcap, unit: "pETH" },
    { label: "Volume", now: ticker.volume, goal: config.graduationMinVolume, unit: "pETH" },
    { label: "Holders", now: ticker.holders, goal: config.graduationMinHolders, unit: "" },
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
          🎓 Graduation progress {graduating && "— criteria met, hold to the bell"}
        </span>
        <span className="font-mono text-zinc-400">{Math.min(100, overall * 100).toFixed(0)}%</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {bars.map((b) => {
          const pct = Math.min(100, (b.now / b.goal) * 100);
          return (
            <div key={b.label}>
              <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
                <div
                  className={`h-full transition-[width] duration-700 ${pct >= 100 ? "bg-emerald-400" : "bg-amber-500"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
                <span>{b.label}</span>
                <span className="font-mono">
                  {b.unit ? (b.now >= 100 ? b.now.toFixed(0) : b.now.toFixed(1)) : Math.round(b.now)}/
                  {b.goal}
                  {b.unit && ` ${b.unit}`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
