"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ACHIEVEMENTS, type JackpotWin, type RoundHistoryEntry } from "@cookout/shared";
import { api } from "../../../lib/api";
import { useUnit } from "../../../lib/chainOnly";

interface PublicProfile {
  address: string;
  displayName?: string;
  avatarUrl?: string;
  xp: number;
  level: number;
  title: string;
  achievements: string[];
  creatorReputation: number;
  stats: Record<string, number>;
  jackpotWinnings?: number;
  jackpotWins?: JackpotWin[];
}

export default function PublicProfilePage() {
  const unit = useUnit();
  const { address } = useParams<{ address: string }>();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [history, setHistory] = useState<RoundHistoryEntry[]>([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<PublicProfile>(`/api/profile/${address}`)
      .then(setProfile)
      .catch(() => setMissing(true));
    api<RoundHistoryEntry[]>(`/api/profile/${address}/history`)
      .then(setHistory)
      .catch(() => {});
  }, [address]);

  if (missing) return <div className="p-10 text-center text-zinc-500">No profile for this address yet.</div>;
  if (!profile) return <div className="p-10 text-center text-zinc-500">Loading…</div>;

  const s = profile.stats;
  const unlocked = ACHIEVEMENTS.filter((a) => profile.achievements.includes(a.id));

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-800 p-6">
        <div className="flex items-center gap-4">
          {profile.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatarUrl}
              alt=""
              className="h-16 w-16 rounded-full border-2 border-zinc-700 object-cover"
            />
          )}
          <h1 className="text-2xl font-black">
            {profile.displayName ?? `${profile.address.slice(0, 8)}…${profile.address.slice(-6)}`}
          </h1>
        </div>
        <div className="mt-1 text-sm text-zinc-400">
          Level {profile.level} · {profile.title} · {profile.xp} XP
          {profile.creatorReputation !== 0 && (
            <>
              {" · "}
              <Link href={`/creator/${profile.address}`} className="text-lime-400 hover:underline">
                creator profile →
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Rounds", s.roundsPlayed],
          ["Wins", s.wins],
          ["Total PnL", Number(s.totalPnl).toFixed(3)],
          ["Best trade", Number(s.bestTradePnl).toFixed(3)],
          ["Trades", s.trades],
          ["Rugs survived", s.rugsSurvived],
          ["Best streak", s.bestWinStreak],
          ["Predictions", `${s.predictionsCorrect}/${s.predictionsMade}`],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-zinc-800 p-3">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</div>
            <div className="font-mono text-lg font-bold">{v}</div>
          </div>
        ))}
      </div>

      {(profile.jackpotWinnings ?? 0) > 0 && (
        <div className="rounded-xl border border-amber-400/40 bg-gradient-to-br from-amber-500/10 to-transparent p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-base font-black text-amber-300">🎰 Jackpot Winnings</h2>
            <span className="font-mono text-lg font-black text-amber-300">
              {(profile.jackpotWinnings ?? 0).toFixed(4)} {unit}
            </span>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {[...(profile.jackpotWins ?? [])]
                .reverse()
                .slice(0, 8)
                .map((w, i) => (
                  <span
                    key={i}
                    title={`${w.week}: +${w.amountEth.toFixed(4)} ${unit} ($${w.amountUsd.toFixed(2)})`}
                    className="rounded border border-amber-400/30 bg-amber-400/5 px-2 py-0.5 text-xs"
                  >
                    {["🥇", "🥈", "🥉"][w.rank - 1] ?? `#${w.rank}`} {w.week}
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}

      {unlocked.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-bold">Achievements ({unlocked.length})</h2>
          <div className="flex flex-wrap gap-2">
            {unlocked.map((a) => (
              <span key={a.id} className="rounded-lg border border-lime-400/50 bg-lime-400/5 px-3 py-1 text-sm" title={a.description}>
                🏅 {a.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-lg font-bold">Trading History</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <div className="-mx-1 overflow-x-auto px-1"><table className="w-full min-w-[30rem] text-sm">
            <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Round</th>
                <th className="px-4 py-2">Tier</th>
                <th className="px-4 py-2">Outcome</th>
                <th className="px-4 py-2 text-right">Invested</th>
                <th className="px-4 py-2 text-right">PnL</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.roundId} className="border-t border-zinc-800/60">
                  <td className="px-4 py-2">
                    <Link href={`/round/${h.roundId}`} className="hover:underline">
                      {h.name} <span className="text-zinc-500">${h.symbol}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-xs uppercase text-zinc-400">{h.tier}</td>
                  <td className="px-4 py-2 text-xs">
                    {h.graduated ? "🍽️ served up" : h.endReason.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{h.invested.toFixed(2)}</td>
                  <td className={`px-4 py-2 text-right font-mono ${h.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {h.pnl >= 0 ? "+" : ""}
                    {h.pnl.toFixed(3)}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                    No rounds played yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table></div>
        </div>
      </div>
    </div>
  );
}
