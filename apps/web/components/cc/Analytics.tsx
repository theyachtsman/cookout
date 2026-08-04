"use client";

import { useCallback, useEffect, useState } from "react";
import { cc } from "../../lib/cc";
import { Panel } from "./CcModules";

/**
 * Analytics dashboards.
 *
 * Charts are hand-drawn SVG rather than a charting library: the shapes needed
 * here are bars and a line, the payloads are already daily buckets, and it
 * keeps the admin bundle from carrying a dependency for six sparklines.
 *
 * Every series arrives zero-filled, so a quiet day is drawn as a gap rather
 * than being closed up — a chart that hides downtime is worse than no chart.
 */

interface Point {
  day: string;
  value: number;
}

interface Analytics {
  range: number;
  generatedAt: number;
  players: {
    total: number;
    new: number;
    dau: number;
    wau: number;
    signups: Point[];
    active: Point[];
    retention: Record<"d1" | "d7" | "d30", { cohort: number; retained: number; pct: number }>;
    levels: { bucket: number; count: number }[];
    linkedTelegram: number;
    founders: number;
  };
  trading: {
    volumeEth: number;
    trades: number;
    traders: number;
    volume: Point[];
    tradeCount: Point[];
    avgTradeEth: number;
  };
  matches: {
    finished: number;
    live: number;
    graduationRate: number;
    perDay: Point[];
    endReasons: { reason: string; count: number }[];
    byMode: { mode: string; played: number; graduated: number }[];
  };
  pit: {
    players: number;
    matches: number;
    predictions: number;
    predictionAccuracy: number;
    tradingEntries: number;
    tradingWinRate: number;
    trials: number;
    trialPassRate: number;
    earnings: number;
  };
  xp: { perDay: Point[]; bySource: { source: string; xp: number }[]; total: number };
  burgers: {
    outstanding: number;
    earned: number;
    purchased: number;
    spent: number;
    perDay: Point[];
    bySource: Record<string, number>;
    revenueEth: number;
  };
  revenue: {
    feesLifetimeEth: number;
    jackpotPoolEth: number;
    jackpotLifetimeEth: number;
    jackpotPayouts: number;
    creatorFeesEth: number;
    ethUsd: number;
  };
  telegram: { sent: number; failed: number; linked: number; perDay: Point[] };
  leaders: Record<string, { address: string; name: string; value: number }[]>;
}

const n = (v: number, dp = 0) =>
  v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

function Stat({ label, value, hint, tone = "text-zinc-100" }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-zinc-950/60 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-black ${tone}`}>{value}</div>
      {hint && <div className="text-[10px] text-zinc-600">{hint}</div>}
    </div>
  );
}

/** Daily bars. Zero days render as an empty slot so gaps stay visible. */
function Bars({ points, color = "#a3e635", height = 64 }: { points: Point[]; color?: string; height?: number }) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 100 / points.length;
  return (
    <div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-16 w-full">
        {points.map((p, i) => {
          const h = (p.value / max) * (height - 2);
          return (
            <rect
              key={p.day}
              x={i * w + w * 0.15}
              y={height - h}
              width={w * 0.7}
              height={Math.max(p.value > 0 ? 1 : 0, h)}
              fill={color}
              opacity={p.value > 0 ? 0.9 : 0}
            >
              <title>{`${p.day}: ${n(p.value, p.value % 1 ? 2 : 0)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-[9px] text-zinc-600">
        <span>{points[0]!.day.slice(5)}</span>
        <span className="font-mono">peak {n(max, max % 1 ? 2 : 0)}</span>
        <span>{points.at(-1)!.day.slice(5)}</span>
      </div>
    </div>
  );
}

/** Horizontal breakdown bar for categorical splits. */
function Breakdown({ rows, color = "#a3e635" }: { rows: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div className="text-xs text-zinc-600">No data yet.</div>;
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-32 shrink-0 truncate text-[11px] text-zinc-400">{r.label}</span>
          <div className="h-3 min-w-0 flex-1 overflow-hidden rounded bg-zinc-900">
            <div className="h-full rounded" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-[11px] text-zinc-300">
            {n(r.value, r.value % 1 ? 2 : 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function Leaders({ rows, format }: { rows: { address: string; name: string; value: number }[]; format: (v: number) => string }) {
  if (rows.length === 0) return <div className="text-xs text-zinc-600">Nobody yet.</div>;
  return (
    <div className="space-y-1">
      {rows.map((r, i) => (
        <div key={r.address} className="flex items-center gap-2 rounded-lg bg-zinc-950/50 px-2 py-1 text-xs">
          <span className="w-5 shrink-0 font-mono text-zinc-600">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate text-zinc-200">{r.name}</span>
          <span className="shrink-0 font-mono font-black text-lime-300">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsModule() {
  const [data, setData] = useState<Analytics | null>(null);
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    cc<Analytics>(`/api/cc/analytics?days=${days}`)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [days]);
  useEffect(load, [load]);

  if (error) return <Panel title="Analytics"><div className="text-sm text-red-300">{error}</div></Panel>;
  if (!data) return <Panel title="Analytics"><div className="text-sm text-zinc-500">Crunching…</div></Panel>;

  const usd = (eth: number) => `$${n(eth * data.revenue.ethUsd)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-zinc-950/95 p-2 ring-1 ring-white/10">
        <span className="px-2 text-xs font-bold text-zinc-500">Window</span>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
              days === d ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
            }`}
          >
            {d} days
          </button>
        ))}
        <span className="ml-auto px-2 text-[11px] text-zinc-600">
          Bots and Goon Squad accounts are excluded from every player figure
        </span>
      </div>

      <Panel title="Players" subtitle={`${n(data.players.total)} total · ${n(data.players.new)} new in ${days} days`}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Total players" value={n(data.players.total)} />
          <Stat label="Active today" value={n(data.players.dau)} tone="text-lime-300" />
          <Stat label="Active this week" value={n(data.players.wau)} tone="text-lime-300" />
          <Stat label="Telegram linked" value={n(data.players.linkedTelegram)} hint={`${n(data.players.founders)} founders`} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">New players per day</div>
            <Bars points={data.players.signups} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Daily active players</div>
            <Bars points={data.players.active} color="#38bdf8" />
          </div>
        </div>
      </Panel>

      <Panel
        title="Retention"
        subtitle="Of the players who joined, how many came back. Cohorts too recent to judge are excluded rather than counted as churned."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {(["d1", "d7", "d30"] as const).map((k) => {
            const r = data.players.retention[k];
            return (
              <Stat
                key={k}
                label={`${k.toUpperCase()} retention`}
                value={r.cohort ? `${r.pct}%` : "—"}
                hint={r.cohort ? `${n(r.retained)} of ${n(r.cohort)}` : "no cohort old enough yet"}
                tone={r.pct >= 40 ? "text-lime-300" : r.pct >= 20 ? "text-amber-300" : "text-zinc-100"}
              />
            );
          })}
        </div>
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-bold text-zinc-400">Level distribution</div>
          <Breakdown
            rows={data.players.levels.map((l) => ({ label: `Level ${l.bucket}–${l.bucket + 9}`, value: l.count }))}
            color="#38bdf8"
          />
        </div>
      </Panel>

      <Panel title="Trading" subtitle={`${n(data.trading.trades)} trades from ${n(data.trading.traders)} traders`}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Volume" value={`${n(data.trading.volumeEth, 2)}`} hint={usd(data.trading.volumeEth)} tone="text-lime-300" />
          <Stat label="Trades" value={n(data.trading.trades)} />
          <Stat label="Distinct traders" value={n(data.trading.traders)} />
          <Stat label="Average trade" value={n(data.trading.avgTradeEth, 3)} hint="pETH" />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Volume per day (pETH)</div>
            <Bars points={data.trading.volume} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Trades per day</div>
            <Bars points={data.trading.tradeCount} color="#38bdf8" />
          </div>
        </div>
      </Panel>

      <Panel title="Matches" subtitle={`${n(data.matches.finished)} finished · ${n(data.matches.live)} live now`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Finished" value={n(data.matches.finished)} />
          <Stat
            label="Graduation rate"
            value={`${data.matches.graduationRate}%`}
            hint="Cook Out rounds only"
            tone={data.matches.graduationRate >= 30 ? "text-lime-300" : "text-amber-300"}
          />
          <Stat label="Live now" value={n(data.matches.live)} tone="text-emerald-300" />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Matches per day</div>
            <Bars points={data.matches.perDay} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">How they ended</div>
            <Breakdown
              rows={data.matches.endReasons.map((r) => ({ label: r.reason.replace(/_/g, " "), value: r.count }))}
              color="#fb7185"
            />
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-bold text-zinc-400">By mode</div>
          <Breakdown
            rows={data.matches.byMode.map((m) => ({ label: `${m.mode} (${m.graduated} served up)`, value: m.played }))}
          />
        </div>
      </Panel>

      <Panel title="The Pit" subtitle={`${n(data.pit.players)} players with a Pit record`}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Matches played" value={n(data.pit.matches)} />
          <Stat label="Prediction accuracy" value={`${data.pit.predictionAccuracy}%`} hint={`${n(data.pit.predictions)} calls`} tone="text-sky-300" />
          <Stat label="Trading win rate" value={`${data.pit.tradingWinRate}%`} hint={`${n(data.pit.tradingEntries)} entries`} tone="text-lime-300" />
          <Stat label="Flame Trial pass rate" value={`${data.pit.trialPassRate}%`} hint={`${n(data.pit.trials)} trials`} tone="text-orange-300" />
        </div>
      </Panel>

      <Panel title="XP" subtitle={`${n(data.xp.total)} XP earned all time`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">XP per day</div>
            <Bars points={data.xp.perDay} color="#fbbf24" />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Where XP comes from</div>
            <Breakdown rows={data.xp.bySource.map((s) => ({ label: s.source, value: s.xp }))} color="#fbbf24" />
          </div>
        </div>
      </Panel>

      <Panel title="BURGERS" subtitle={`${n(data.burgers.outstanding)} held by players`}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Outstanding" value={n(data.burgers.outstanding)} tone="text-orange-300" />
          <Stat label="Earned" value={n(data.burgers.earned)} />
          <Stat label="Purchased" value={n(data.burgers.purchased)} />
          <Stat label="Spent" value={n(data.burgers.spent)} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Issued per day</div>
            <Bars points={data.burgers.perDay} color="#fb923c" />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">By source</div>
            <Breakdown
              rows={Object.entries(data.burgers.bySource).map(([label, value]) => ({ label, value: value as number }))}
              color="#fb923c"
            />
          </div>
        </div>
      </Panel>

      <Panel title="Revenue" subtitle="Paper economy — Phase 1 values">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Fees collected" value={n(data.revenue.feesLifetimeEth, 3)} hint={usd(data.revenue.feesLifetimeEth)} tone="text-lime-300" />
          <Stat label="Jackpot pot" value={n(data.revenue.jackpotPoolEth, 4)} hint={usd(data.revenue.jackpotPoolEth)} tone="text-amber-300" />
          <Stat label="Jackpot paid out" value={n(data.revenue.jackpotLifetimeEth, 3)} hint={`${data.revenue.jackpotPayouts} payouts`} />
          <Stat label="Creator fees" value={n(data.revenue.creatorFeesEth, 3)} hint={usd(data.revenue.creatorFeesEth)} />
        </div>
      </Panel>

      <Panel title="Telegram" subtitle={`${n(data.telegram.linked)} accounts linked`}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Delivered" value={n(data.telegram.sent)} tone="text-lime-300" />
          <Stat label="Failed" value={n(data.telegram.failed)} tone={data.telegram.failed ? "text-red-300" : "text-zinc-100"} />
          <Stat label="Linked accounts" value={n(data.telegram.linked)} />
        </div>
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-bold text-zinc-400">Messages delivered per day</div>
          <Bars points={data.telegram.perDay} color="#38bdf8" />
        </div>
      </Panel>

      <Panel title="Leaderboards" subtitle="Top players by each measure">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">XP</div>
            <Leaders rows={data.leaders.xp ?? []} format={(v) => n(v)} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">PnL</div>
            <Leaders rows={data.leaders.pnl ?? []} format={(v) => n(v, 3)} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">Trades</div>
            <Leaders rows={data.leaders.trades ?? []} format={(v) => n(v)} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold text-zinc-400">BURGERS</div>
            <Leaders rows={data.leaders.burgers ?? []} format={(v) => n(v)} />
          </div>
        </div>
      </Panel>
    </div>
  );
}
