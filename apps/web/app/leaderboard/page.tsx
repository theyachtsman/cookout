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
            className={`rounded px-3 py-1 text-sm ${scope === s ? "bg-amber-500 font-bold text-zinc-950" : "bg-zinc-800"}`}
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
      <div className="overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">#</th>
              <th className="px-4 py-2">Player</th>
              <th className="px-4 py-2">Level</th>
              <th className="px-4 py-2 text-right">{metric.toUpperCase()}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.address} className="border-t border-zinc-800/60">
                <td className="px-4 py-2 font-mono text-zinc-500">{i + 1}</td>
                <td className="px-4 py-2">
                  <a href={`/profile/${r.address}`} className="hover:underline">
                    {r.badge && <span className="mr-1.5">{r.badge}</span>}
                    {r.displayName ?? `${r.address.slice(0, 6)}…${r.address.slice(-4)}`}
                  </a>
                  {i < 3 && <span className="ml-2">{["🥇", "🥈", "🥉"][i]}</span>}
                </td>
                <td className="px-4 py-2 text-zinc-400">
                  Lv{r.level} {r.title}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  {metric === "pnl" ? r.value.toFixed(3) : r.value}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  Nobody on the board yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
