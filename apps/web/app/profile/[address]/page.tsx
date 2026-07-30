"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ACHIEVEMENTS,
  COSMETICS,
  xpForLevel,
  type EquippedCosmetics,
  type JackpotWin,
  type RoundHistoryEntry,
  type RugBan,
} from "@cookout/shared";
import { api } from "../../../lib/api";
import { useUnit } from "../../../lib/chainOnly";
import { ReputationPanel } from "../../../components/Reputation";
import {
  AchievementCard,
  Avatar,
  MatchHistory,
  ProfileHero,
  SectionTitle,
  StatCard,
  StatGrid,
} from "../../../components/ProfileUI";

interface PublicProfile {
  address: string;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  xp: number;
  level: number;
  title: string;
  achievements: string[];
  creatorReputation: number;
  banned?: boolean;
  rugBans?: RugBan[];
  equipped?: EquippedCosmetics;
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
  const equippedTitle = COSMETICS.find((c) => c.id === profile.equipped?.title)?.value;
  const equippedBadge = COSMETICS.find((c) => c.id === profile.equipped?.badge)?.value;
  const unlocked = [...ACHIEVEMENTS]
    .filter((a) => profile.achievements.includes(a.id))
    .sort(
      (a, b) => ["common", "rare", "epic", "legendary"].indexOf(b.rarity) - ["common", "rare", "epic", "legendary"].indexOf(a.rarity),
    );
  const isCreator = profile.creatorReputation !== 0 || (profile.rugBans?.length ?? 0) > 0;
  const pnl = Number(s.totalPnl);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ProfileHero
        avatar={<Avatar url={profile.avatarUrl} name={name} level={profile.level} />}
        bannerUrl={profile.bannerUrl}
        name={name}
        level={profile.level}
        title={equippedTitle ?? profile.title}
        badge={equippedBadge}
        xp={profile.xp}
        currLevelXp={xpForLevel(profile.level)}
        nextLevelXp={xpForLevel(profile.level + 1)}
        rep={isCreator ? profile.creatorReputation : undefined}
        accent={!!profile.banned}
        chips={
          <>
            <span className="font-mono text-xs text-zinc-500">{profile.xp.toLocaleString()} XP</span>
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
        <section className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-transparent p-5">
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
                  className="rounded-lg bg-amber-400/[0.08] px-2 py-1 font-mono text-xs text-amber-200"
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
            {unlocked.map((a) => (
              <AchievementCard key={a.id} achievement={a} unlocked />
            ))}
          </div>
        </section>
      )}

      {/* Trading history */}
      <section>
        <SectionTitle title="Trading History" />
        <MatchHistory entries={history} />
      </section>
    </div>
  );
}
