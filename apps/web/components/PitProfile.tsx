"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PIT_DURATION_MAP, type PitDurationKey, type PitStats, type Round, type RoundSummary } from "@cookout/shared";
import { StatCard, StatGrid, SectionTitle } from "./ProfileUI";
import { pdotEth } from "../lib/pit";
import { api } from "../lib/api";

interface HistoryRow {
  round: Round;
  summary: RoundSummary;
  me: {
    prediction?: string;
    predictionCorrect?: boolean;
    tradingPnl?: number;
    qualified?: boolean;
    totalReward: number;
    doubleWinner: boolean;
  } | null;
}

const DURATIONS: PitDurationKey[] = ["blitz", "standard", "marathon"];

/** The profile's The Pit tab: lifetime record + recent matches. Shared by the
 *  own-profile and public-profile pages. Fetches its own stats so callers only
 *  pass the address (or the already-loaded pitStats to skip a request). */
export function PitProfile({ address, pitStats: initial }: { address: string; pitStats?: PitStats }) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [pitStats, setPitStats] = useState<PitStats | undefined>(initial);

  useEffect(() => {
    api<HistoryRow[]>(`/api/pit/history/${address}`)
      .then(setHistory)
      .catch(() => setHistory([]));
    if (!initial)
      api<{ pitStats?: PitStats }>(`/api/profile/${address}`)
        .then((p) => setPitStats(p.pitStats))
        .catch(() => {});
  }, [address, initial]);

  if (!pitStats || pitStats.matchesPlayed === 0)
    return (
      <div className="rounded-2xl bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
        No Pit matches yet.{" "}
        <Link href="/pit" className="font-bold text-sky-300 hover:underline">
          Enter The Pit
        </Link>{" "}
        to face the Goon Squad.
      </div>
    );

  const ps = pitStats;
  const accuracy = ps.predictionsMade ? Math.round((ps.predictionsCorrect / ps.predictionsMade) * 100) : 0;
  const avgPnl = ps.tradingEntries ? ps.totalPnl / ps.tradingEntries : 0;
  const houseRate = ps.houseEntered ? Math.round(((ps.houseWins ?? 0) / ps.houseEntered) * 100) : 0;
  const trialRate = ps.trialsPlayed ? Math.round(((ps.trialsWon ?? 0) / ps.trialsPlayed) * 100) : 0;
  const staked = ps.predictionStaked + ps.tradingStaked + (ps.houseStaked ?? 0);
  const roi = staked > 0 ? Math.round(((ps.totalEarnings - staked) / staked) * 100) : 0;
  const favorite = DURATIONS.reduce<PitDurationKey>(
    (best, k) => (ps.byDuration[k].played > ps.byDuration[best].played ? k : best),
    "standard",
  );

  return (
    <div className="space-y-6">
      <StatGrid>
        <StatCard label="Matches" value={ps.matchesPlayed} icon="🕳️" />
        <StatCard label="Prediction accuracy" value={`${accuracy}%`} icon="🎯" hint={`${ps.predictionsCorrect}/${ps.predictionsMade}`} />
        <StatCard label="Prediction wins" value={ps.predictionWins} icon="🔮" />
        <StatCard label="Prediction winnings" value={pdotEth(ps.predictionEarnings ?? 0)} icon="💵" tone="text-lime-300" />
        <StatCard
          label="House Special win rate"
          value={`${houseRate}%`}
          icon="🏠"
          tone="text-amber-300"
          hint={`${ps.houseWins ?? 0}/${ps.houseEntered ?? 0}`}
        />
        <StatCard label="House Special earnings" value={pdotEth(ps.houseEarnings ?? 0)} icon="🏦" tone="text-amber-300" />
        <StatCard label="Double Downs" value={ps.doubleDowns ?? 0} icon="🏆" tone="text-amber-300" hint={`largest ${pdotEth(ps.largestDoubleDown ?? 0)}`} />
        <StatCard label="Trading wins" value={ps.tradingWins} icon="⚔️" />
        <StatCard label="Highest PnL" value={`${ps.highestPnl >= 0 ? "+" : ""}${ps.highestPnl.toFixed(3)}`} icon="📈" tone={ps.highestPnl >= 0 ? "text-lime-300" : "text-red-400"} />
        <StatCard label="Average PnL" value={`${avgPnl >= 0 ? "+" : ""}${avgPnl.toFixed(3)}`} icon="📊" tone={avgPnl >= 0 ? "text-lime-300" : "text-red-400"} />
        <StatCard label="Longest streak" value={ps.longestProfitStreak} icon="🔥" />
        <StatCard label="Total earnings" value={pdotEth(ps.totalEarnings)} icon="💰" tone="text-lime-300" />
        <StatCard label="Lifetime ROI" value={`${roi >= 0 ? "+" : ""}${roi}%`} icon="♻️" tone={roi >= 0 ? "text-lime-300" : "text-red-400"} />
      </StatGrid>

      {(ps.trialsPlayed ?? 0) > 0 && (
        <div>
          <SectionTitle title="🔥 Flame Trial" />
          <StatGrid>
            <StatCard label="Trials played" value={ps.trialsPlayed ?? 0} icon="🔥" />
            <StatCard label="Trials won" value={ps.trialsWon ?? 0} icon="🏆" tone="text-orange-300" />
            <StatCard label="Win rate" value={`${trialRate}%`} icon="🎯" hint={`${ps.trialsWon ?? 0}/${ps.trialsPlayed ?? 0}`} />
            <StatCard label="Trial XP" value={(ps.trialXp ?? 0).toLocaleString()} icon="⚡" tone="text-lime-300" />
            <StatCard label="Highest Trial PnL" value={`+${Math.round((ps.highestTrialPnlPct ?? 0) * 100)}%`} icon="📈" tone="text-lime-300" />
            <StatCard label="Highest tier" value={ps.highestTrialTier || "—"} icon="🥇" tone="text-orange-300" />
            <StatCard label="Best win streak" value={ps.bestTrialWinStreak ?? 0} icon="🔥" />
            <StatCard label="Current streak" value={ps.trialWinStreak ?? 0} icon="🔥" tone="text-orange-300" />
          </StatGrid>
        </div>
      )}

      <div>
        <SectionTitle title="Duration records" />
        <div className="grid grid-cols-3 gap-3">
          {DURATIONS.map((k) => {
            const d = PIT_DURATION_MAP[k];
            const rec = ps.byDuration[k];
            return (
              <div
                key={k}
                className={`rounded-2xl bg-zinc-900/50 p-4 ring-1 ${
                  favorite === k ? "ring-sky-400/40" : "ring-white/10"
                }`}
              >
                <div className="text-sm font-black text-zinc-100">
                  {d.icon} {d.name}
                </div>
                <div className="mt-1 font-mono text-sm text-zinc-400">
                  {rec.wins}W / {rec.played} played
                </div>
                {favorite === k && rec.played > 0 && (
                  <div className="mt-1 text-[10px] font-bold uppercase text-sky-300">Favorite</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {history.length > 0 && (
        <div>
          <SectionTitle title="Recent Pit matches" />
          <div className="space-y-1.5">
            {history.map((h) => {
              const pit = h.summary.pit!;
              const won = (h.me?.totalReward ?? 0) > 0;
              return (
                <Link
                  key={h.round.id}
                  href={`/pit/${h.round.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-zinc-900/40 px-4 py-2.5 transition hover:bg-zinc-900/80"
                >
                  <span className="text-lg">{PIT_DURATION_MAP[pit.duration]?.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-bold text-zinc-100">${h.round.token.symbol}</span>
                    <span className="ml-2 text-xs capitalize text-zinc-500">{pit.outcome}</span>
                    {h.me?.doubleWinner && <span className="ml-2 text-xs text-amber-300">🏆 Double</span>}
                  </span>
                  <span className={`shrink-0 font-mono text-sm font-black ${won ? "text-lime-300" : "text-zinc-500"}`}>
                    {won ? `+${pdotEth(h.me!.totalReward)}` : "—"}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
