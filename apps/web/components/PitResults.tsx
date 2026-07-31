"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { PIT_DURATIONS, PIT_DURATION_MAP, type PitDurationKey, type Round, type RoundSummary } from "@cookout/shared";
import { api } from "../lib/api";
import { pdotEth } from "../lib/pit";

const OUTCOME: Record<string, { text: string; cls: string; icon: string }> = {
  graduate: { text: "Graduated", cls: "text-lime-300", icon: "🍽️" },
  rug: { text: "The Swarm Rugged", cls: "text-red-400", icon: "🔻" },
  timer: { text: "Timer", cls: "text-zinc-200", icon: "⏱️" },
};

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/**
 * The Pit's post-match view: outcome, both prize pools, the caller's own result
 * (with a Double Winner celebration), and the full participant breakdown. Used
 * on the /pit/[id] results screen.
 */
export function PitResultsView({
  round,
  summary,
  me,
  fmt = pdotEth,
}: {
  round: Round;
  summary: RoundSummary | null;
  me?: string;
  /** pETH/USD formatter from the in-match toggle; defaults to pETH. */
  fmt?: (eth: number) => string;
}) {
  const pit = summary?.pit;
  if (!pit)
    return (
      <div className="rounded-2xl bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
        Results are being tallied…
      </div>
    );

  const o = OUTCOME[pit.outcome] ?? OUTCOME.timer!;
  const d = PIT_DURATION_MAP[pit.duration];
  const mine = me ? pit.players.find((p) => p.address === me) : undefined;

  return (
    <div className="space-y-4">
      {/* Outcome banner */}
      <div className="rounded-3xl bg-gradient-to-br from-fuchsia-500/10 via-zinc-900/50 to-zinc-950 p-6 text-center ring-1 ring-white/10">
        <div className="text-4xl">{o.icon}</div>
        <div className={`mt-1 text-2xl font-black ${o.cls}`}>{o.text}</div>
        <div className="mt-1 text-xs text-zinc-500">
          {d?.icon} {d?.name} · ${round.token.symbol}
        </div>
      </div>

      {/* Your result */}
      {mine && (mine.prediction || mine.tradingPnl !== undefined) && (
        <div
          className={`rounded-2xl p-4 ring-1 ${
            mine.doubleWinner
              ? "bg-amber-500/10 ring-amber-400/40"
              : mine.totalReward > 0
                ? "bg-lime-500/[0.08] ring-lime-500/30"
                : "bg-zinc-900/50 ring-white/10"
          }`}
        >
          {mine.doubleWinner && (
            <div className="mb-2 text-center text-lg font-black text-amber-300">
              🏆🏆 Double Winner 🏆🏆
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {mine.prediction && (
              <Stat
                label="Prediction"
                value={mine.prediction}
                sub={mine.predictionCorrect ? "Correct" : "Missed"}
                good={mine.predictionCorrect}
              />
            )}
            {mine.tradingPnl !== undefined && (
              <Stat
                label="Trading PnL"
                value={`${mine.tradingPnl >= 0 ? "+" : ""}${fmt(mine.tradingPnl)}`}
                sub={
                  mine.qualified
                    ? "Qualified"
                    : mine.tradingPnl > 0 && (mine.trades ?? 0) < pit.minTrades
                      ? `Only ${mine.trades ?? 0}/${pit.minTrades} trades`
                      : "No qualify"
                }
                good={mine.qualified}
              />
            )}
            <Stat label="Total reward" value={fmt(mine.totalReward)} good={mine.totalReward > 0} />
            <Stat
              label="Net"
              value={`${mine.net >= 0 ? "+" : ""}${fmt(mine.net)}`}
              good={mine.net >= 0}
            />
          </div>
        </div>
      )}

      {/* Pools */}
      <div className="grid grid-cols-2 gap-3">
        <PoolCard
          title="Prediction Pool"
          pot={pit.prediction.pot}
          winners={pit.prediction.winners}
          rewardEach={pit.prediction.rewardEach}
          carried={pit.prediction.carried}
          fmt={fmt}
        />
        <PoolCard
          title="Trading Pool"
          pot={pit.trading.pot}
          winners={pit.trading.qualified}
          rewardEach={pit.trading.rewardEach}
          carried={pit.trading.carried}
          winnersLabel="qualified"
          note={`${pit.minTrades}+ trades to qualify`}
          fmt={fmt}
        />
      </div>

      {/* Breakdown */}
      {pit.players.length > 0 && (
        <div className="overflow-x-auto rounded-2xl bg-zinc-900/40 ring-1 ring-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-zinc-600">
                <th className="px-3 py-2 text-left font-bold">Player</th>
                <th className="px-3 py-2 text-left font-bold">Call</th>
                <th className="px-3 py-2 text-right font-bold">Trades</th>
                <th className="px-3 py-2 text-right font-bold">PnL</th>
                <th className="px-3 py-2 text-right font-bold">Reward</th>
              </tr>
            </thead>
            <tbody>
              {pit.players.map((p) => (
                <tr key={p.address} className="border-t border-white/5">
                  <td className="px-3 py-2">
                    <Link href={`/profile/${p.address}`} className="font-bold text-zinc-100 hover:underline">
                      {p.displayName ?? short(p.address)}
                    </Link>
                    {p.doubleWinner && <span className="ml-1 text-amber-300">🏆</span>}
                  </td>
                  <td className="px-3 py-2">
                    {p.prediction ? (
                      <span className={p.predictionCorrect ? "text-lime-300" : "text-zinc-500"}>
                        {p.prediction}
                      </span>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {p.trades === undefined ? (
                      <span className="text-zinc-700">—</span>
                    ) : (
                      <span className={p.trades >= pit.minTrades ? "text-zinc-300" : "text-amber-300"}>
                        {p.trades}/{pit.minTrades}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {p.tradingPnl === undefined ? (
                      <span className="text-zinc-700">—</span>
                    ) : (
                      <span className={p.tradingPnl >= 0 ? "text-lime-300" : "text-red-400"}>
                        {p.tradingPnl >= 0 ? "+" : ""}
                        {fmt(p.tradingPnl)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-black text-zinc-100">
                    {p.totalReward > 0 ? fmt(p.totalReward) : <span className="text-zinc-700">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-center gap-3">
        <Link
          href="/pit"
          className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-black text-zinc-200 hover:bg-zinc-700"
        >
          Back to The Pit
        </Link>
        {me && round.creatorAddress.toLowerCase() === me && <RunItBack round={round} />}
      </div>
    </div>
  );
}

/** Creator-only: relaunch this coin into a fresh Pit lobby, optionally in a new
 *  duration. Confirms in a modal, then jumps to the new match. */
export function RunItBack({ round, compact = false }: { round: Round; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState<PitDurationKey>(round.pit?.duration ?? "standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const go = async () => {
    setError("");
    setBusy(true);
    try {
      const { round: fresh } = await api<{ round: { id: string } }>(`/api/pit/${round.id}/runback`, {
        body: { duration },
      });
      router.push(`/pit/${fresh.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={
          compact
            ? "rounded-lg bg-fuchsia-500/15 px-3 py-1.5 text-xs font-black text-fuchsia-300 transition hover:bg-fuchsia-500/25 active:scale-95"
            : "rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-fuchsia-400"
        }
      >
        {compact ? "↻ Run it back" : "Run it back"}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <div onClick={() => !busy && setOpen(false)} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
            <div className="relative w-full max-w-sm rounded-3xl bg-zinc-950 p-5 ring-1 ring-white/10">
              <h3 className="text-lg font-black text-zinc-50">{`Run $${round.token.symbol} back`}</h3>
              <p className="mt-1 text-xs text-zinc-500">Relaunch the same coin into a fresh Pit lobby.</p>
              <div className="mt-3 mb-1.5 text-xs text-zinc-500">Duration</div>
              <div className="grid grid-cols-3 gap-2">
                {PIT_DURATIONS.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => setDuration(d.key)}
                    className={`rounded-xl p-2.5 text-center ring-1 transition ${
                      duration === d.key ? "bg-fuchsia-500/15 ring-fuchsia-400/60" : "bg-zinc-900/60 ring-white/10 hover:ring-white/25"
                    }`}
                  >
                    <div className="text-lg">{d.icon}</div>
                    <div className="text-xs font-black text-zinc-100">{d.name}</div>
                    <div className="text-[10px] text-zinc-500">{d.minutes}m</div>
                  </button>
                ))}
              </div>
              {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-zinc-800 py-2.5 text-sm font-bold text-zinc-300 hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  onClick={go}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-fuchsia-500 py-2.5 text-sm font-black text-zinc-950 hover:bg-fuchsia-400 disabled:opacity-40"
                >
                  {busy ? "Launching…" : "Run it back →"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Stat({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="font-mono text-base font-black capitalize text-zinc-100">{value}</div>
      {sub && (
        <div className={`text-[11px] font-bold ${good ? "text-lime-300" : "text-zinc-500"}`}>{sub}</div>
      )}
    </div>
  );
}

function PoolCard({
  title,
  pot,
  winners,
  rewardEach,
  carried,
  winnersLabel = "winners",
  note,
  fmt = pdotEth,
}: {
  title: string;
  pot: number;
  winners: number;
  rewardEach: number;
  carried: boolean;
  winnersLabel?: string;
  note?: string;
  fmt?: (eth: number) => string;
}) {
  return (
    <div className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-zinc-500">{title}</span>
        {note && <span className="text-[10px] text-zinc-600">{note}</span>}
      </div>
      <div className="font-mono text-xl font-black text-zinc-50">{fmt(pot)}</div>
      {carried ? (
        <div className="text-[11px] font-bold text-amber-300">No qualifiers · carried over 🏆</div>
      ) : (
        <div className="text-[11px] text-zinc-600">
          {winners} {winnersLabel} · {fmt(rewardEach)} each
        </div>
      )}
    </div>
  );
}
