"use client";

/**
 * The dev's rug meter — creator-only.
 *
 * A coin rugs the instant its creator's cumulative sells cross
 * DEV_DUMP_FRACTION (75%) of the most they ever held. This gauge is that math,
 * live: 0% = untouched, 100% = the next sell pulls the plug. It only renders
 * for the dev (the server sends `rug` to nobody else), and it's meant to sit
 * right on top of the trade controls so the line is impossible to miss.
 */

export interface RugInfo {
  /** Cumulative tokens the dev has sold this round. */
  sold: number;
  /** The most the dev has ever held (their peak bag). */
  maxHeld: number;
  /** Rug fires at this many tokens sold (= 0.75 × maxHeld). */
  threshold: number;
  /** 0 → 1 progress to the rug. */
  fraction: number;
}

function zone(f: number): { label: string; note: string; color: string; ring: string } {
  if (f >= 0.85)
    return {
      label: "ON THE EDGE",
      note: "One more sell and the coin rugs.",
      color: "#f87171",
      ring: "rgba(248,113,113,0.55)",
    };
  if (f >= 0.6)
    return {
      label: "DANGER",
      note: "Selling much more will pull the plug.",
      color: "#fbbf24",
      ring: "rgba(251,191,36,0.45)",
    };
  if (f > 0)
    return {
      label: "TRIMMING",
      note: "You're taking profit — still well clear.",
      color: "#a3e635",
      ring: "rgba(163,230,53,0.4)",
    };
  return {
    label: "CLEAN",
    note: "Nothing sold. Your bag is intact.",
    color: "#34e39b",
    ring: "rgba(52,227,155,0.4)",
  };
}

export function RugMeter({ rug, blitz }: { rug: RugInfo; blitz?: boolean }) {
  const held = rug.maxHeld > 0;
  const f = Math.max(0, Math.min(1, rug.fraction));
  const pct = Math.round(f * 100);
  const z = zone(f);
  // Share of the peak bag already sold — the rule the meter is built on (75%).
  const soldPctOfBag = rug.maxHeld > 0 ? Math.round((rug.sold / rug.maxHeld) * 100) : 0;

  return (
    <div
      className="rounded-xl border p-3"
      style={{
        borderColor: `color-mix(in srgb, ${z.color} 45%, transparent)`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${z.color} 8%, transparent), transparent)`,
      }}
    >
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">🪤</span>
          <span className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-300">
            Rug Meter
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider"
            style={{ color: z.color, background: `color-mix(in srgb, ${z.color} 16%, transparent)` }}
          >
            {held ? z.label : "NO BAG"}
          </span>
        </div>
        <span
          className="font-mono text-lg font-black tabular-nums"
          style={{ color: z.color, textShadow: `0 0 14px ${z.ring}` }}
        >
          {held ? `${pct}%` : "—"}
        </span>
      </div>

      {/* the gauge: green→amber→red track, a filled portion, and a needle */}
      <div className="relative mt-2 h-3 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="absolute inset-0 opacity-25"
          style={{ background: "linear-gradient(90deg, #34e39b 0%, #a3e635 45%, #fbbf24 72%, #f87171 100%)" }}
        />
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${
            f >= 0.85 ? "animate-pulse" : ""
          }`}
          style={{
            width: `${Math.max(held ? 2 : 0, pct)}%`,
            background: `linear-gradient(90deg, color-mix(in srgb, ${z.color} 55%, transparent), ${z.color})`,
          }}
        />
        {held && (
          <div
            className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${pct}%`, background: "#fff", boxShadow: `0 0 8px ${z.ring}` }}
          />
        )}
        {/* the redline — where the rug fires */}
        <div className="absolute inset-y-0 right-0 w-px bg-white/40" />
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className="text-zinc-400">{held ? z.note : "Buy your own coin to arm the meter."}</span>
        {held && (
          <span className="shrink-0 font-mono text-zinc-500" title="Share of your peak bag sold — rug at 75%">
            {soldPctOfBag}% / 75% of bag
          </span>
        )}
      </div>

      {blitz && (
        <div className="mt-1.5 text-[10px] font-bold text-amber-300/90">
          ⚡ Blitz — this rug is penalty-free. Pull whenever you want.
        </div>
      )}
    </div>
  );
}
