"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Site-wide jackpot ticker, shown in the nav on every page. Polls the live
 * pot and renders it in USD (the headline currency); the /jackpot page has
 * the full breakdown. Renders nothing until the first fetch succeeds so it
 * never flashes a zero.
 */
export function JackpotPill() {
  const [usd, setUsd] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ poolUsd: number }>("/api/jackpot")
        .then((d) => alive && setUsd(d.poolUsd))
        .catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (usd === null) return null;

  return (
    <Link
      href="/jackpot"
      title="Weekly Jackpot — paid to the top XP earners every week"
      className="group flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-gradient-to-r from-amber-500/15 to-yellow-500/10 px-3 py-1 text-sm font-black text-amber-300 transition hover:border-amber-300/70 hover:from-amber-500/25"
    >
      <span className="animate-pulse">🎰</span>
      <span className="tabular-nums">
        ${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </span>
      <span className="hidden text-[10px] font-bold uppercase tracking-wide text-amber-400/70 sm:inline">
        jackpot
      </span>
    </Link>
  );
}
