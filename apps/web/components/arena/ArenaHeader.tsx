"use client";

import { useEffect, useRef, useState } from "react";
import type { Round } from "@cookout/shared";

/**
 * The arena header — the one piece of furniture every phase shares.
 *
 * Lobby, queue, live, and results all render this exact component; only the
 * state changes. That's what keeps a match feeling like one continuous thing
 * instead of four different pages. Status strip up top (label, subtitle, big
 * countdown, progress), coin identity and live stats underneath.
 */

export interface ArenaTicker {
  price: number;
  mcap: number;
  athMcap?: number;
  liquidity: number;
  volume: number;
  holders: number;
  ageSeconds: number;
  cooking?: boolean;
  ethUsd?: number;
}

interface PhaseSkin {
  label: string;
  detail: string;
  from?: number;
  until?: number;
  /** border / text / bar colors, in Cookout palette. */
  border: string;
  text: string;
  bar: string;
  glow?: boolean;
}

function skinFor(round: Round): PhaseSkin {
  switch (round.state) {
    case "scheduled":
      return {
        label: "STARTING SOON",
        detail: "Coin reveals when the lobby opens",
        from: round.scheduledAt - 15 * 60_000,
        until: round.scheduledAt,
        border: "border-zinc-700",
        text: "text-zinc-300",
        bar: "bg-zinc-500",
      };
    case "lobby":
      return {
        label: "LOBBY OPEN",
        detail: "Queue opens next. Get your entry ready.",
        from: round.scheduledAt,
        until: round.queueOpensAt,
        border: "border-sky-500/50",
        text: "text-sky-300",
        bar: "bg-sky-400",
      };
    case "queue_open":
      return {
        label: "QUEUE OPEN",
        detail: "Everyone settles at ONE price. Speed buys you nothing.",
        from: round.queueOpensAt,
        until: round.queueClosesAt,
        border: "border-lime-400/60",
        text: "text-lime-300",
        bar: "bg-lime-400",
        glow: true,
      };
    case "settling":
      return {
        label: "SETTLING",
        detail: "Queue closed. Working out the one price.",
        border: "border-violet-500/50",
        text: "text-violet-300",
        bar: "bg-violet-400",
      };
    case "live":
      return {
        label: "LIVE TRADING",
        detail: "Market closes in",
        from: round.liveAt,
        until: round.endsAt,
        border: "border-emerald-500/60",
        text: "text-emerald-300",
        bar: "bg-emerald-400",
        glow: true,
      };
    case "ended":
      return {
        label: "RESOLVING",
        detail: "Counting it up.",
        border: "border-zinc-600",
        text: "text-zinc-300",
        bar: "bg-zinc-500",
      };
    default:
      if (round.graduated)
        return {
          label: "SERVED UP",
          detail: "Bonded and out in the wild. It keeps trading.",
          border: "border-lime-400/60",
          text: "text-lime-300",
          bar: "bg-lime-400",
        };
      if (round.endReason === "rug_detected" || round.endReason === "liquidity_removed")
        return {
          label: "RUGGED",
          detail: "Liquidity went. Everyone exited at one price.",
          border: "border-red-500/60",
          text: "text-red-300",
          bar: "bg-red-500",
        };
      return {
        label: "ROUND OVER",
        detail: "Everyone exited at one price.",
        border: "border-zinc-600",
        text: "text-zinc-300",
        bar: "bg-zinc-500",
      };
  }
}

/** A number that rolls to its new value instead of snapping. */
function useRolling(value: number, ms = 500): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const start = useRef(0);
  useEffect(() => {
    from.current = shown;
    start.current = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start.current) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from.current + (value - from.current) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);
  return shown;
}

export function ArenaHeader({
  round,
  ticker,
  position,
  rank,
  players,
}: {
  round: Round;
  ticker?: ArenaTicker | null;
  position?: { tokens: number; costBasisEth: number; realizedPnl: number } | null;
  /** Your live placing this round, when it's known. */
  rank?: number | null;
  /** Bodies in the room right now (queue phase mostly). */
  players?: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, []);

  const skin = skinFor(round);
  const remaining = skin.until ? Math.max(0, skin.until - now) : null;
  // Ceil the whole remaining, matching the RoundOverlays countdown so the top
  // timer and the big 5-4-3-2-1 overlay read the same number at the same time
  // (a floor here vs the overlay's ceil left them ~1s apart).
  const totalSec = remaining !== null ? Math.ceil(remaining / 1000) : 0;
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const urgent = remaining !== null && remaining < 15_000;
  const progress =
    skin.until && skin.from
      ? Math.min(100, Math.max(0, ((now - skin.from) / (skin.until - skin.from)) * 100))
      : null;

  const ethUsd = ticker?.ethUsd ?? 1925;
  const unit = round.chain ? "ETH" : "pETH";
  const mcapUsd = useRolling((ticker?.mcap ?? 0) * ethUsd);
  const posValue = position ? position.tokens * (ticker?.price ?? 0) : 0;
  const posPnl = position ? position.realizedPnl + posValue - position.costBasisEth : 0;

  const money = (v: number) =>
    v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(2)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
  const age = ticker?.ageSeconds ?? 0;
  const ageText = age >= 60 ? `${Math.floor(age / 60)}m ${age % 60}s` : `${age}s`;

  const stats: Array<[string, string, string?]> = [];
  if (ticker) {
    stats.push(["Market Cap", money(mcapUsd)]);
    stats.push(["Liquidity", `${ticker.liquidity.toFixed(2)} ${unit}`]);
    stats.push(["Volume", `${ticker.volume.toFixed(2)} ${unit}`]);
    stats.push(["Holders", String(ticker.holders)]);
    stats.push(["Age", ageText]);
  } else {
    stats.push(["Seed liquidity", `${round.config.initialEthLiquidity} ${unit}`]);
    stats.push(["Supply", round.config.totalSupply.toLocaleString()]);
    stats.push(["Trade fee", `${round.config.tradeFeeBps / 100}%`]);
    if (players !== undefined) stats.push(["In the room", String(players)]);
  }
  if (position && position.tokens > 0) {
    stats.push([
      "Your position",
      `${money(posValue * ethUsd)}`,
      posPnl >= 0 ? "text-emerald-400" : "text-red-400",
    ]);
  }
  if (rank) stats.push(["Your rank", `#${rank}`, rank <= 3 ? "text-amber-300" : undefined]);

  // The creator's promo banner backs the whole header once the coin is
  // revealed (never during the scheduled teaser). A left-heavy gradient keeps
  // the status strip and stats readable over any artwork.
  const banner = round.state !== "scheduled" ? round.token.bannerUrl : undefined;
  return (
    <div className={`relative overflow-hidden rounded-xl border bg-zinc-900/40 ${skin.border}`}>
      {banner && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={banner}
            alt=""
            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-zinc-950/90 via-zinc-950/70 to-zinc-950/40" />
        </>
      )}
      <div className="relative">
      {/* status strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5">
        <span className={`flex items-center gap-2 text-lg font-black tracking-wide ${skin.text}`}>
          {skin.glow && (
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${skin.bar} opacity-70`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${skin.bar}`} />
            </span>
          )}
          {skin.label}
        </span>
        <span className="text-sm text-zinc-400">{skin.detail}</span>
        {round.state === "settling" && (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />
        )}
        {remaining !== null && (
          <span
            className={`ml-auto font-mono text-3xl font-black tabular-nums transition-colors md:text-4xl ${
              urgent ? "animate-pulse text-red-400" : skin.text
            }`}
          >
            {mm}:{String(ss).padStart(2, "0")}
          </span>
        )}
      </div>
      {progress !== null && (
        <div className="h-1 w-full bg-zinc-800">
          <div
            className={`h-full transition-[width] duration-200 ${skin.bar}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* identity + live stats */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-zinc-800/80 px-4 py-3">
        <div className="flex items-center gap-3">
          {round.token.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={round.token.artworkUrl}
              alt=""
              className={`h-11 w-11 rounded-xl border border-zinc-700 object-cover ${
                round.state === "scheduled" ? "blur-md" : ""
              }`}
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-xl">
              🪙
            </div>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-black leading-none">
                {round.state === "scheduled" ? "???" : round.token.name}
              </span>
              {round.state !== "scheduled" && (
                <span className="font-mono text-sm text-zinc-500">${round.token.symbol}</span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-300">
                {round.tier}
              </span>
              {round.graduated && (
                <span className="rounded bg-lime-400/20 px-1.5 py-0.5 text-[10px] font-bold text-lime-300">
                  alumni
                </span>
              )}
              {round.chain && (
                <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                  on-chain
                </span>
              )}
              {ticker?.cooking && (
                <span className="animate-pulse rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-bold text-orange-300">
                  🔥 cooking
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-x-6 gap-y-2">
          {stats.map(([k, v, tone]) => (
            <div key={k} className="min-w-[4.5rem]">
              <div className="text-[9px] uppercase tracking-wide text-zinc-500">{k}</div>
              <div className={`font-mono text-sm font-bold ${tone ?? "text-zinc-100"}`}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}
