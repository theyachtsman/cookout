"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface Row {
  address: string;
  displayName?: string;
  level: number;
  title: string;
  value: number;
}

export default function Leaderboard() {
  const [scope, setScope] = useState<"alltime" | "season">("alltime");
  const [metric, setMetric] = useState<"pnl" | "xp" | "wins">("pnl");
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    api<{ rows: Row[] }>(`/api/leaderboard?scope=${scope}&metric=${metric}`)
      .then((d) => setRows(d.rows))
      .catch(() => {});
  }, [scope, metric]);

  return (
    <div>
      <h1 className="mb-4 text-2xl font-black">Leaderboard</h1>
      <div className="mb-4 flex gap-2">
        {(["alltime", "season"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`rounded px-3 py-1 text-sm ${scope === s ? "bg-amber-500 font-bold text-zinc-950" : "bg-zinc-800"}`}
          >
            {s === "alltime" ? "All-time" : "This season"}
          </button>
        ))}
        <div className="w-4" />
        {(["pnl", "xp", "wins"] as const).map((m) => (
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
                  {r.displayName ?? `${r.address.slice(0, 6)}…${r.address.slice(-4)}`}
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
