"use client";

import { useEffect, useRef, useState } from "react";
import { UserName } from "../UserCard";

/**
 * The round race. Same data as before, but it remembers where everyone was a
 * moment ago and shows the movement — that's the difference between a table
 * and a leaderboard you actually watch.
 */

export interface LeaderRow {
  address: string;
  displayName?: string;
  badge?: string;
  value: number;
}

type Move = "up" | "down" | "new" | null;

export function LiveLeaders({
  rows,
  me,
  ethUsd,
  title = "Round Leaders",
}: {
  rows: LeaderRow[];
  me?: string;
  ethUsd?: number;
  title?: string;
}) {
  const prevRank = useRef<Map<string, number>>(new Map());
  const [moves, setMoves] = useState<Map<string, Move>>(new Map());

  useEffect(() => {
    const next = new Map<string, Move>();
    const now = new Map<string, number>();
    rows.forEach((r, i) => {
      const key = r.address.toLowerCase();
      now.set(key, i);
      const before = prevRank.current.get(key);
      if (before === undefined) next.set(key, prevRank.current.size ? "new" : null);
      else if (i < before) next.set(key, "up");
      else if (i > before) next.set(key, "down");
      else next.set(key, null);
    });
    prevRank.current = now;
    setMoves(next);
    // Movement badges fade after a beat so the board settles.
    const t = setTimeout(() => setMoves(new Map()), 4000);
    return () => clearTimeout(t);
  }, [rows]);

  if (rows.length === 0)
    return (
      <div className="rounded-xl border border-zinc-800 p-4">
        <h4 className="text-sm font-bold text-zinc-300">{title}</h4>
        <p className="mt-2 text-xs text-zinc-600">Nobody&apos;s taken a position yet.</p>
      </div>
    );

  return (
    <div className="rounded-xl border border-zinc-800 p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-sm font-bold text-zinc-300">{title}</h4>
        <span className="text-[10px] uppercase tracking-wide text-zinc-600">live</span>
      </div>
      <div className="space-y-1">
        {rows.map((r, i) => {
          const mine = !!me && r.address.toLowerCase() === me.toLowerCase();
          const move = moves.get(r.address.toLowerCase());
          const up = r.value >= 0;
          return (
            <div
              key={r.address}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                mine ? "bg-lime-400/10 ring-1 ring-lime-400/30" : "bg-zinc-900/60"
              }`}
            >
              <span
                className={`w-5 shrink-0 text-center font-mono text-xs font-black ${
                  i === 0 ? "text-amber-300" : i === 1 ? "text-zinc-300" : i === 2 ? "text-orange-400" : "text-zinc-600"
                }`}
              >
                {i + 1}
              </span>
              {move === "up" && <span className="shrink-0 text-[10px] text-emerald-400">▲</span>}
              {move === "down" && <span className="shrink-0 text-[10px] text-red-400">▼</span>}
              {move === "new" && (
                <span className="shrink-0 text-[9px] font-bold text-sky-300">NEW</span>
              )}
              <UserName
                address={r.address}
                name={r.displayName}
                badge={r.badge}
                className="min-w-0 flex-1 text-left text-xs text-zinc-200"
              />
              <span
                className={`shrink-0 font-mono text-xs font-bold ${up ? "text-emerald-400" : "text-red-400"}`}
              >
                {up ? "+" : ""}
                {ethUsd ? `$${(r.value * ethUsd).toFixed(0)}` : r.value.toFixed(3)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
