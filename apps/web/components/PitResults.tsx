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
  rug: { text: "The Goon Squad Rugged", cls: "text-red-400", icon: "🔻" },
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
        {pit.houseSpecial && (
          <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-amber-500/10 px-3 py-1 text-xs ring-1 ring-amber-500/30">
            <span className="font-bold text-amber-200">🏠 {pit.houseSpecial.def.name}</span>
            <span className={pit.houseSpecial.hit ? "font-black text-lime-300" : "font-bold text-zinc-500"}>
              {pit.houseSpecial.hit ? "HIT ✅" : "missed"}
            </span>
          </div>
        )}
      </div>

      {/* Your result */}
      {mine && (mine.prediction || mine.houseSpecial || mine.tradingPnl !== undefined || mine.trial) && (
        <div
          className={`rounded-2xl p-4 ring-1 ${
            mine.doubleDownBonus > 0 || mine.trialPassed
              ? "bg-amber-500/10 ring-amber-400/40"
              : mine.totalReward > 0
                ? "bg-lime-500/[0.08] ring-lime-500/30"
                : "bg-zinc-900/50 ring-white/10"
          }`}
        >
          {mine.doubleDownBonus > 0 && (
            <div className="mb-2 text-center text-lg font-black text-amber-300">
              🏆 Double Down · +{fmt(mine.doubleDownBonus)}
            </div>
          )}
          {mine.trialPassed && (
            <div className="mb-2 text-center text-lg font-black text-orange-300">
              🔥 Flame Trial passed · +{mine.trialXp ?? 0} XP
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {mine.prediction && (
              <Stat
                label="Prediction"
                value={mine.prediction}
                sub={
                  mine.predictionCorrect
                    ? `✅ +${fmt(mine.predictionReward)}`
                    : "Missed"
                }
                good={mine.predictionCorrect}
              />
            )}
            {mine.houseSpecial && (
              <Stat
                label="🏠 House Special"
                value={mine.houseSpecialCorrect ? "Hit" : "Missed"}
                sub={mine.houseSpecialCorrect ? `+${fmt(mine.houseSpecialReward)}` : "no payout"}
                good={mine.houseSpecialCorrect}
              />
            )}
            {mine.tradingPnl !== undefined && !mine.trial && (
              <Stat
                label="Trading PnL"
                value={`${mine.tradingPnl >= 0 ? "+" : ""}${fmt(mine.tradingPnl)}`}
                sub={mine.qualified ? `Top PnL +${fmt(mine.tradingReward)}` : "Didn't win"}
                good={mine.qualified}
              />
            )}
            {mine.trial && (
              <Stat
                label={`🔥 Trial (${mine.trialTier ?? ""})`}
                value={`${(mine.trialPnlPct ?? 0) >= 0 ? "+" : ""}${Math.round((mine.trialPnlPct ?? 0) * 100)}%`}
                sub={mine.trialPassed ? `Passed · +${mine.trialXp ?? 0} XP` : "Failed"}
                good={mine.trialPassed}
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {round.pit?.predictionMode && (
          <PoolCard
            title="🔮 Main Pool"
            pot={pit.prediction.pot}
            winners={pit.prediction.winners}
            rewardEach={pit.prediction.rewardEach}
            carried={pit.prediction.carried}
            fmt={fmt}
          />
        )}
        {pit.houseSpecial && (
          <PoolCard
            title="🏠 House Special"
            pot={pit.house.pot}
            winners={pit.house.winners}
            rewardEach={pit.house.rewardEach}
            carried={pit.house.carried}
            note={pit.houseSpecial.hit ? "hit" : "missed"}
            fmt={fmt}
          />
        )}
        {round.pit?.tradingMode && (
          <PoolCard
            title="⚔️ Trading Pool"
            pot={pit.trading.pot}
            winners={pit.trading.qualified}
            rewardEach={pit.trading.rewardEach}
            carried={pit.trading.carried}
            winnersLabel="winner"
            note="highest PnL"
            fmt={fmt}
          />
        )}
        {round.pit?.trialMode && (
          <div className="rounded-2xl bg-zinc-900/50 p-4 ring-1 ring-white/10">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-zinc-500">🔥 Flame Trial</span>
              <span className="text-[10px] text-zinc-600">+{Math.round(pit.trial.requiredPnlBps / 100)}% to pass</span>
            </div>
            <div className="font-mono text-xl font-black text-orange-300">
              {pit.trial.passed}/{pit.trial.participants}
            </div>
            <div className="text-[11px] text-zinc-600">passed · prestige rewards</div>
          </div>
        )}
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
                    {p.houseSpecial && (
                      <span className={`ml-1.5 ${p.houseSpecialCorrect ? "text-lime-300" : "text-zinc-600"}`}>
                        🏠{p.houseSpecialCorrect ? "✓" : "✗"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {p.trades === undefined ? (
                      <span className="text-zinc-700">—</span>
                    ) : (
                      <span className="text-zinc-400">{p.trades}</span>
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
  const [modes, setModes] = useState({
    prediction: round.pit?.predictionMode ?? true,
    // Flame Trial is solo and can't pair with the Goons; trial wins the tie-break.
    trading: (round.pit?.tradingMode ?? true) && !round.pit?.trialMode,
    trial: round.pit?.trialMode ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const go = async () => {
    setError("");
    if (!modes.prediction && !modes.trading && !modes.trial) {
      setError("Pick at least one game mode.");
      return;
    }
    setBusy(true);
    try {
      const { round: fresh } = await api<{ round: { id: string } }>(`/api/pit/${round.id}/runback`, {
        body: { duration, modes },
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
              <div className="mt-3 mb-1.5 text-xs text-zinc-500">Game modes</div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["prediction", "🔮 Predict", "fuchsia"],
                    ["trading", "⚔️ Goons", "lime"],
                    ["trial", "🔥 Trial", "orange"],
                  ] as const
                ).map(([key, label, accent]) => {
                  const on = modes[key];
                  const onCls =
                    accent === "fuchsia"
                      ? "bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-400/50"
                      : accent === "lime"
                        ? "bg-lime-500/15 text-lime-200 ring-lime-400/50"
                        : "bg-orange-500/15 text-orange-200 ring-orange-400/50";
                  // Flame Trial is solo: it can't run alongside Battle the Goons.
                  const blocked = (key === "trading" && modes.trial) || (key === "trial" && modes.trading);
                  return (
                    <button
                      key={key}
                      disabled={blocked}
                      title={blocked ? "Flame Trial is single-player and can't run with the Goons" : undefined}
                      onClick={() =>
                        setModes((m) =>
                          key === "trial"
                            ? { ...m, trial: !m.trial, trading: !m.trial ? false : m.trading }
                            : key === "trading"
                              ? { ...m, trading: !m.trading, trial: !m.trading ? false : m.trial }
                              : { ...m, [key]: !m[key] },
                        )
                      }
                      className={`rounded-xl p-2.5 text-xs font-black ring-1 transition ${
                        blocked ? "cursor-not-allowed bg-zinc-900/30 text-zinc-600 ring-white/5 opacity-40" : on ? onCls : "bg-zinc-900/60 text-zinc-400 ring-white/10"
                      }`}
                    >
                      {on ? "✓ " : ""}
                      {label}
                    </button>
                  );
                })}
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
        <div className="text-[11px] font-bold text-amber-300">Unclaimed · to the jackpot 🎰</div>
      ) : (
        <div className="text-[11px] text-zinc-600">
          {winners} {winnersLabel} · {fmt(rewardEach)} each
        </div>
      )}
    </div>
  );
}
