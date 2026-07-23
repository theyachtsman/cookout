"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ACHIEVEMENTS,
  xpForLevel,
  type JackpotWin,
  type RoundHistoryEntry,
  type RugBan,
} from "@cookout/shared";
import { api } from "../../../lib/api";
import { useUnit } from "../../../lib/chainOnly";
import { ReputationPanel, repStanding } from "../../../components/Reputation";
import {
  Avatar,
  ProfileHero,
  RARITY,
  SectionTitle,
  StatCard,
  StatGrid,
} from "../../../components/ProfileUI";

interface PublicProfile {
  address: string;
  displayName?: string;
  avatarUrl?: string;
  xp: number;
  level: number;
  title: string;
  achievements: string[];
  creatorReputation: number;
  banned?: boolean;
  rugBans?: RugBan[];
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

  if (missing)
    return (
      <div className="py-24 text-center">
        <div className="text-4xl">🕳️</div>
        <p className="mt-3 text-sm text-zinc-500">No profile for this address yet.</p>
      </div>
    );
  if (!profile) return <div className="p-10 text-center text-zinc-500">Loading…</div>;

  const s = profile.stats;
  const name = profile.displayName ?? `${profile.address.slice(0, 8)}…${profile.address.slice(-6)}`;
  const unlocked = [...ACHIEVEMENTS]
    .filter((a) => profile.achievements.includes(a.id))
    .sort(
      (a, b) => ["common", "rare", "epic", "legendary"].indexOf(b.rarity) - ["common", "rare", "epic", "legendary"].indexOf(a.rarity),
    );
  const isCreator = profile.creatorReputation !== 0 || (profile.rugBans?.length ?? 0) > 0;
  const standing = repStanding(profile.creatorReputation);
  const pnl = Number(s.totalPnl);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ProfileHero
        avatar={<Avatar url={profile.avatarUrl} name={name} level={profile.level} />}
        name={name}
        level={profile.level}
        title={profile.title}
        xp={profile.xp}
        currLevelXp={xpForLevel(profile.level)}
        nextLevelXp={xpForLevel(profile.level + 1)}
        accent={!!profile.banned}
        chips={
          <>
            <span className="font-mono text-xs text-zinc-500">{profile.xp.toLocaleString()} XP</span>
            {isCreator && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${standing.accent} bg-zinc-800`}>
                {standing.emoji} {standing.label} creator
              </span>
            )}
            {profile.banned && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-red-300">
                🚫 banned
              </span>
            )}
          </>
        }
        right={
          <div>
            <div
              className={`font-mono text-2xl font-black ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {pnl >= 0 ? "+" : ""}
              {pnl.toFixed(2)}
            </div>
            <div className="text-[11px] text-zinc-500">lifetime PnL</div>
          </div>
        }
      >
        {isCreator && (
          <Link
            href={`/creator/${profile.address}`}
            className="inline-block text-xs font-bold text-lime-400 hover:underline"
          >
            View creator profile →
          </Link>
        )}
      </ProfileHero>

      {/* Career stats */}
      <section>
        <SectionTitle title="Career Stats" />
        <StatGrid>
          <StatCard icon="🎮" label="Rounds" value={s.roundsPlayed} />
          <StatCard icon="🏆" label="Wins" value={s.wins} tone="text-emerald-300" />
          <StatCard icon="⚡" label="Trades" value={s.trades} />
          <StatCard
            icon="📈"
            label="Total PnL"
            value={`${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`}
            tone={pnl >= 0 ? "text-emerald-300" : "text-red-300"}
          />
          <StatCard
            icon="🚀"
            label="Best Trade"
            value={`+${Number(s.bestTradePnl).toFixed(2)}`}
            tone="text-emerald-300"
          />
          <StatCard icon="🧊" label="Rugs Survived" value={s.rugsSurvived} />
          <StatCard icon="🔥" label="Best Streak" value={s.bestWinStreak} tone="text-orange-300" />
          <StatCard
            icon="🔮"
            label="Predictions"
            value={`${s.predictionsCorrect}/${s.predictionsMade}`}
          />
        </StatGrid>
      </section>

      {/* Reputation (creators only) */}
      {isCreator && (
        <section>
          <SectionTitle title="Creator Reputation" />
          <ReputationPanel
            reputation={profile.creatorReputation}
            bans={profile.rugBans ?? []}
            banned={!!profile.banned}
          />
        </section>
      )}

      {/* Jackpot winnings */}
      {(profile.jackpotWinnings ?? 0) > 0 && (
        <section className="rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/10 to-transparent p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-sm font-black uppercase tracking-wide text-amber-300">
              🎰 Jackpot Winnings
            </h2>
            <span className="font-mono text-xl font-black text-amber-300">
              {(profile.jackpotWinnings ?? 0).toFixed(4)} {unit}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[...(profile.jackpotWins ?? [])]
              .reverse()
              .slice(0, 12)
              .map((w, i) => (
                <span
                  key={i}
                  title={`${w.week}: +${w.amountEth.toFixed(4)} ${unit} ($${w.amountUsd.toFixed(2)})`}
                  className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-2 py-1 font-mono text-xs text-amber-200"
                >
                  {["🥇", "🥈", "🥉"][w.rank - 1] ?? `#${w.rank}`} {w.week}
                </span>
              ))}
          </div>
        </section>
      )}

      {/* Achievements */}
      {unlocked.length > 0 && (
        <section>
          <SectionTitle
            title="Achievements"
            action={<span className="font-mono text-xs text-zinc-500">{unlocked.length} earned</span>}
          />
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {unlocked.map((a) => {
              const r = RARITY[a.rarity] ?? RARITY.common;
              return (
                <div key={a.id} className={`rounded-xl border p-3.5 ${r.ring} ${r.wash}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-zinc-100">🏅 {a.name}</span>
                    <span className={`shrink-0 text-[9px] font-black uppercase tracking-wide ${r.text}`}>
                      {r.label}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">{a.description}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Trading history */}
      <section>
        <SectionTitle title="Trading History" />
        <div className="overflow-hidden rounded-2xl border border-zinc-800">
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="bg-zinc-900/60 text-left text-[10px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5">Round</th>
                  <th className="px-4 py-2.5">Tier</th>
                  <th className="px-4 py-2.5">Outcome</th>
                  <th className="px-4 py-2.5 text-right">Invested</th>
                  <th className="px-4 py-2.5 text-right">PnL</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.roundId} className="border-t border-zinc-800/60 hover:bg-zinc-900/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/round/${h.roundId}`} className="font-bold hover:underline">
                        {h.name} <span className="font-mono text-zinc-500">${h.symbol}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs uppercase text-zinc-400">{h.tier}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {h.graduated ? (
                        <span className="text-lime-300">🍽️ served up</span>
                      ) : (
                        <span className="text-zinc-400">{h.endReason.replace(/_/g, " ")}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-zinc-300">
                      {h.invested.toFixed(2)}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right font-mono font-bold ${
                        h.pnl >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {h.pnl >= 0 ? "+" : ""}
                      {h.pnl.toFixed(3)}
                    </td>
                  </tr>
                ))}
                {history.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                      No rounds played yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
