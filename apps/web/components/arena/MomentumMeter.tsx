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

/**
 * States, worst to best. "Balanced" is the resting state and is the only one
 * that shows without a threshold being crossed — the loud labels have to be
 * earned, otherwise they stop meaning anything.
 */
const BANDS = [
  { at: -0.75, label: "Capitulation", cls: "text-red-400", loud: true },
  { at: -0.45, label: "Sell Pressure", cls: "text-red-300", loud: true },
  { at: -0.15, label: "Balanced", cls: "text-zinc-300" },
  { at: 0.15, label: "Balanced", cls: "text-zinc-300" },
  { at: 0.45, label: "Buy Pressure", cls: "text-lime-300", loud: true },
  { at: 1.01, label: "Momentum Surge", cls: "text-emerald-300", loud: true },
];

/** A single trade this big flips the read to a whale call. */
const WHALE_SHARE = 0.45;
/** Volume jump vs the previous window that counts as a surge. */
const SURGE_RATIO = 2.2;

export function MomentumMeter({
  trades,
  live,
  urgent,
}: {
  trades: Trade[];
  live: boolean;
  /** Final minute: the meter glows to match the rest of the arena. */
  urgent?: boolean;
}) {
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
  // Biggest single trade in the window, and the window before it, so we can
  // tell "one whale moved" apart from "everyone moved".
  let biggest = 0;
  let biggestSide: "buy" | "sell" = "buy";
  let prevVol = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    const t = trades[i]!;
    const age = now - t.at;
    if (age > WINDOW_MS * 2) break;
    if (age > WINDOW_MS) {
      prevVol += t.ethAmount;
      continue;
    }
    if (t.ethAmount > biggest) {
      biggest = t.ethAmount;
      biggestSide = t.side;
    }
  }
  const total = buys + sells;
  const target = total > 0 ? (buys - sells) / total : 0;
  const rawVol = buys + sells;
  const whale = total > 0 && biggest / total >= WHALE_SHARE;
  const surging = prevVol > 0 && rawVol / prevVol >= SURGE_RATIO && rawVol > 0.05;

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
  let band = BANDS.find((b) => shown < b.at) ?? BANDS[2]!;
  // A dominant single trade outranks the aggregate read — that's the story.
  if (whale && Math.abs(shown) > 0.15)
    band =
      biggestSide === "buy"
        ? { at: 0, label: "Whale Buying", cls: "text-amber-300", loud: true }
        : { at: 0, label: "Whale Selling", cls: "text-orange-300", loud: true };
  else if (surging && shown > 0.15)
    band = { at: 0, label: "Momentum Surge", cls: "text-emerald-300", loud: true };
  const buyShare = total > 0 ? (buys / total) * 100 : 50;

  return (
    <div
      className={`rounded-xl border bg-zinc-900/40 p-3 transition-shadow duration-500 ${
        urgent
          ? "border-amber-400/50 shadow-[0_0_22px_rgba(252,211,77,0.25)]"
          : (band as { loud?: boolean }).loud
            ? "border-zinc-700"
            : "border-zinc-800"
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
          Momentum
        </span>
        <span
          className={`text-xs font-black transition-colors duration-300 ${band.cls} ${
            (band as { loud?: boolean }).loud ? "animate-[fadein_.3s_ease]" : ""
          }`}
        >
          {band.label}
        </span>
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
