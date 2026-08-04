"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Row {
  address: string;
  displayName?: string;
  level: number;
  title: string;
  badge?: string;
  value: number;
}

/**
 * Two boards, not one. The Cook Out board ranks PvP match play over a time
 * window; The Pit board ranks lifetime PvE record against the Goon Squad.
 * They measure different things, so they're picked at the top level and each
 * brings its own controls — a Pit board squeezed in beside "Today / This Week"
 * read as if it were another time window, which it never was.
 */
type Board = "cookout" | "pit";

const COOKOUT_SCOPES = [
  ["today", "Today"],
  ["week", "This Week"],
  ["alltime", "All-time"],
] as const;

// XP is bucketed per UTC day (Today) and per ISO week (This Week); All-time
// uses lifetime XP.
const COOKOUT_METRICS: [string, string][] = [
  ["pnl", "PnL"],
  ["xp", "XP"],
  ["wins", "Wins"],
];

// The Pit's own boards, keyed to its lifetime stats.
const PIT_METRICS: [string, string][] = [
  ["profit", "Highest Profit"],
  ["accuracy", "Prediction Accuracy"],
  ["predWins", "Prediction Wins"],
  ["tradeWins", "Trading Wins"],
  ["double", "Double Wins"],
  ["largest", "Largest Win"],
  ["streak", "Profit Streak"],
  ["earnings", "Total Earnings"],
  ["blitz", "Best Blitz"],
  ["standard", "Best Standard"],
  ["marathon", "Best Marathon"],
  ["trialWins", "🔥 Trial Wins"],
  ["trialXp", "🔥 Trial XP"],
  ["trialStreak", "🔥 Trial Streak"],
  ["trialPnl", "🔥 Trial PnL"],
];

const PETH_METRICS = new Set(["profit", "largest", "earnings"]);

function formatValue(board: Board, metric: string, v: number): string {
  if (board === "pit") {
    if (metric === "accuracy") return `${v}%`;
    if (metric === "trialPnl") return `+${v}%`;
    if (PETH_METRICS.has(metric)) return v.toFixed(3);
    return String(v);
  }
  return metric === "pnl" ? `${v >= 0 ? "+" : ""}${v.toFixed(3)}` : String(v);
}

export default function Leaderboard() {
  const [board, setBoard] = useState<Board>("cookout");
  const [scope, setScope] = useState<(typeof COOKOUT_SCOPES)[number][0]>("alltime");
  const [metric, setMetric] = useState<string>("pnl");
  const [pitMetric, setPitMetric] = useState<string>("profit");
  const [rows, setRows] = useState<Row[]>([]);

  const metricList = board === "pit" ? PIT_METRICS : COOKOUT_METRICS;
  const active = board === "pit" ? pitMetric : metric;
  const activeMetric = metricList.some(([m]) => m === active) ? active : metricList[0]![0];
  // The Pit board is lifetime-only, so it has no time scope of its own.
  const query = board === "pit" ? "pit" : scope;

  useEffect(() => {
    let alive = true;
    api<{ rows: Row[] }>(`/api/leaderboard?scope=${query}&metric=${activeMetric}`)
      .then((d) => alive && setRows(d.rows))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [query, activeMetric]);

  const metricLabel = metricList.find(([m]) => m === activeMetric)?.[1] ?? activeMetric;

  return (
    <div>
      <h1 className="mb-1 text-2xl font-black">Leaderboard</h1>
      <p className="mb-4 text-sm text-zinc-500">
        {board === "pit"
          ? "Lifetime record in The Pit: predictions called, Goons out-traded, Flame Trials cleared."
          : "PvP match play at the Cook Out — profit, XP, and wins over your chosen window."}
      </p>

      {/* Board picker — the top-level choice. */}
      <div className="mb-3 flex w-fit overflow-hidden rounded-xl bg-zinc-900/70 text-sm font-black ring-1 ring-white/10">
        {(
          [
            ["cookout", "🍳 The Cook Out"],
            ["pit", "🕳️ The Pit"],
          ] as const
        ).map(([b, label]) => (
          <button
            key={b}
            onClick={() => setBoard(b)}
            className={`px-4 py-2 transition ${
              board === b ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {board === "cookout" &&
          COOKOUT_SCOPES.map(([s, label]) => (
            <button
              key={s}
              onClick={() => setScope(s)}
              className={`rounded px-3 py-1 text-sm ${
                scope === s ? "bg-lime-400 font-bold text-zinc-950" : "bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
        {board === "cookout" && <div className="w-4" />}
        {metricList.map(([m, label]) => (
          <button
            key={m}
            onClick={() => (board === "pit" ? setPitMetric(m) : setMetric(m))}
            className={`rounded px-3 py-1 text-sm ${
              activeMetric === m ? "bg-zinc-200 font-bold text-zinc-950" : "bg-zinc-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Trophy podium: top three, gold center-stage */}
      {rows.length > 0 && (
        <div className="mb-6 grid grid-cols-3 items-end gap-3">
          {[rows[1], rows[0], rows[2]].map((r, slot) => {
            if (!r) return <div key={slot} />;
            const rank = slot === 1 ? 0 : slot === 0 ? 1 : 2;
            const style = [
              "bg-gradient-to-b from-amber-500/25 to-amber-500/[0.03] pt-8",
              "bg-gradient-to-b from-zinc-400/20 to-zinc-400/[0.03] pt-5",
              "bg-gradient-to-b from-orange-700/25 to-orange-700/[0.03] pt-5",
            ][rank];
            return (
              <a
                key={r.address}
                href={`/profile/${r.address}`}
                className={`rounded-2xl p-4 text-center transition hover:scale-[1.02] ${style}`}
              >
                <div className="text-4xl">{["🥇", "🥈", "🥉"][rank]}</div>
                <div className="mt-2 truncate font-black">
                  {r.badge && <span className="mr-1">{r.badge}</span>}
                  {r.displayName ?? `${r.address.slice(0, 6)}…${r.address.slice(-4)}`}
                </div>
                <div className="text-xs text-zinc-400">
                  Lv{r.level} {r.title}
                </div>
                <div
                  className={`mt-1 font-mono text-lg font-black ${
                    rank === 0 ? "text-amber-300" : rank === 1 ? "text-zinc-300" : "text-orange-400"
                  }`}
                >
                  {formatValue(board, activeMetric, r.value)}
                </div>
              </a>
            );
          })}
        </div>
      )}

      {/* the rest of the board — borderless rows, no table */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-4 px-4 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
          <span className="w-8 shrink-0">#</span>
          <span className="min-w-0 flex-1">Player</span>
          <span className="shrink-0">{metricLabel.toUpperCase()}</span>
        </div>
        {rows.slice(3).map((r, i) => (
          <a
            key={r.address}
            href={`/profile/${r.address}`}
            className="flex items-center gap-4 rounded-2xl bg-zinc-900/40 px-4 py-2.5 transition hover:bg-zinc-900/80"
          >
            <span className="w-8 shrink-0 font-mono text-zinc-500">{i + 4}</span>
            <span className="min-w-0 flex-1 truncate">
              {r.badge && <span className="mr-1.5">{r.badge}</span>}
              <span className="font-bold text-zinc-100">
                {r.displayName ?? `${r.address.slice(0, 6)}…${r.address.slice(-4)}`}
              </span>
              <span className="ml-2 text-xs text-zinc-500">
                Lv{r.level} {r.title}
              </span>
            </span>
            <span className="shrink-0 font-mono font-black text-zinc-100">
              {formatValue(board, activeMetric, r.value)}
            </span>
          </a>
        ))}
        {rows.length === 0 && (
          <div className="rounded-2xl bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
            {board === "pit"
              ? "Nobody has a Pit record yet. Play a match in The Pit to open the board."
              : "Nobody on the board yet."}
          </div>
        )}
        {rows.length > 0 && rows.length <= 3 && (
          <div className="rounded-2xl bg-zinc-900/40 p-4 text-center text-xs text-zinc-600">
            Top {rows.length} on the podium.{" "}
            {board === "pit" ? "Play The Pit to join the board." : "Play rounds to join the board."}
          </div>
        )}
      </div>
    </div>
  );
}
