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

const SCOPES = [
  ["today", "Today"],
  ["week", "This Week"],
  ["season", "Season"],
  ["alltime", "All-time"],
] as const;

export default function Leaderboard() {
  const [scope, setScope] = useState<(typeof SCOPES)[number][0]>("alltime");
  const [metric, setMetric] = useState<"pnl" | "xp" | "wins">("pnl");
  const [rows, setRows] = useState<Row[]>([]);

  // today/week are computed from round history, which has pnl + wins only.
  const metrics = scope === "today" || scope === "week" ? (["pnl", "wins"] as const) : (["pnl", "xp", "wins"] as const);

  useEffect(() => {
    const m = (metrics as readonly string[]).includes(metric) ? metric : "pnl";
    if (m !== metric) {
      setMetric(m as typeof metric);
      return;
    }
    api<{ rows: Row[] }>(`/api/leaderboard?scope=${scope}&metric=${metric}`)
      .then((d) => setRows(d.rows))
      .catch(() => {});
  }, [scope, metric, metrics]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-black">Leaderboard</h1>
      <div className="mb-4 flex flex-wrap gap-2">
        {SCOPES.map(([s, label]) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`rounded px-3 py-1 text-sm ${scope === s ? "bg-lime-400 font-bold text-zinc-950" : "bg-zinc-800"}`}
          >
            {label}
          </button>
        ))}
        <div className="w-4" />
        {metrics.map((m) => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`rounded px-3 py-1 text-sm uppercase ${metric === m ? "bg-zinc-200 font-bold text-zinc-950" : "bg-zinc-800"}`}
          >
            {m}
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
                  {metric === "pnl" ? `${r.value >= 0 ? "+" : ""}${r.value.toFixed(3)}` : r.value}
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
          <span className="shrink-0">{metric.toUpperCase()}</span>
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
              {metric === "pnl" ? r.value.toFixed(3) : r.value}
            </span>
          </a>
        ))}
        {rows.length === 0 && (
          <div className="rounded-2xl bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
            Nobody on the board yet.
          </div>
        )}
        {rows.length > 0 && rows.length <= 3 && (
          <div className="rounded-2xl bg-zinc-900/40 p-4 text-center text-xs text-zinc-600">
            Top {rows.length} on the podium. Play rounds to join the board.
          </div>
        )}
      </div>
    </div>
  );
}
