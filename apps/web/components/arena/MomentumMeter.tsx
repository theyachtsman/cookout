"use client";

import { useEffect, useRef, useState } from "react";
import type { Trade } from "@cookout/shared";

/**
 * Buy pressure vs sell pressure over the last ~45 seconds, weighted so a
 * whale counts more than ten dust trades. It's a real read on the tape, not
 * a mood ring: the needle is (buys - sells) / (buys + sells) by volume.
 *
 * Reads the same trade stream the chart does, so it moves the instant the
 * room moves.
 */

const WINDOW_MS = 45_000;

const BANDS = [
  { at: -0.6, label: "Panic", cls: "text-red-400" },
  { at: -0.25, label: "Heavy selling", cls: "text-red-300" },
  { at: 0.25, label: "Balanced", cls: "text-zinc-300" },
  { at: 0.6, label: "Buyers in control", cls: "text-lime-300" },
  { at: 1.01, label: "Mania", cls: "text-emerald-300" },
];

export function MomentumMeter({ trades, live }: { trades: Trade[]; live: boolean }) {
  const [, tick] = useState(0);
  const shownRef = useRef(0);
  const [shown, setShown] = useState(0);

  // Recompute on a light interval so the reading decays as trades age out,
  // even when nobody is trading.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 700);
    return () => clearInterval(t);
  }, [live]);

  const now = Date.now();
  let buys = 0;
  let sells = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    const t = trades[i]!;
    const age = now - t.at;
    if (age > WINDOW_MS) break;
    // Recent trades carry more weight than ones aging out of the window.
    const w = t.ethAmount * (1 - age / WINDOW_MS);
    if (t.side === "buy") buys += w;
    else sells += w;
  }
  const total = buys + sells;
  const target = total > 0 ? (buys - sells) / total : 0;

  // Ease toward the target so the needle glides.
  useEffect(() => {
    let raf = 0;
    const step = () => {
      shownRef.current += (target - shownRef.current) * 0.12;
      setShown(shownRef.current);
      if (Math.abs(target - shownRef.current) > 0.002) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const pct = ((shown + 1) / 2) * 100;
  const band = BANDS.find((b) => shown < b.at) ?? BANDS[2]!;
  const buyShare = total > 0 ? (buys / total) * 100 : 50;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          Momentum
        </span>
        <span className={`text-xs font-black ${band.cls}`}>{band.label}</span>
      </div>

      {/* pressure bar */}
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-600 to-emerald-400 transition-[width] duration-300"
          style={{ width: `${buyShare}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-gradient-to-l from-red-600 to-red-400 transition-[width] duration-300"
          style={{ width: `${100 - buyShare}%` }}
        />
        {/* needle */}
        <div
          className="absolute inset-y-0 w-0.5 bg-zinc-100 shadow-[0_0_6px_rgba(255,255,255,0.8)] transition-[left] duration-200"
          style={{ left: `${pct}%` }}
        />
      </div>

      <div className="mt-1.5 flex justify-between font-mono text-[10px]">
        <span className="text-emerald-400">{buyShare.toFixed(0)}% buying</span>
        <span className="text-zinc-600">
          {total > 0 ? `${total.toFixed(2)} in 45s` : "quiet"}
        </span>
        <span className="text-red-400">{(100 - buyShare).toFixed(0)}% selling</span>
      </div>
    </div>
  );
}
