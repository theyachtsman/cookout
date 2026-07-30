"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ACHIEVEMENTS,
  COSMETICS,
  xpForLevel,
  type EquippedCosmetics,
  type JackpotWin,
  type Round,
  type RoundHistoryEntry,
  type RoundSummary,
  type RugBan,
  type TokenConcept,
} from "@cookout/shared";
import { api } from "../lib/api";
import { useUnit } from "../lib/chainOnly";
import { FeesEarned } from "./FeesEarned";
import { ReputationPanel } from "./Reputation";
import { RunItBackButton } from "./RunItBack";
import {
  AchievementCard,
  Avatar,
  ExpandableRows,
  MatchHistory,
  ProfileHero,
  SectionTitle,
  StatCard,
  StatGrid,
  TabBar,
} from "./ProfileUI";

interface PlayerProfile {
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

interface CreatorView {
  address: string;
  creatorReputation: number;
  banned?: boolean;
  rugBans?: RugBan[];
  feesEarned: number;
  concepts: TokenConcept[];
  rounds: Array<{ round: Round; summary: RoundSummary | null }>;
  aggregates: {
    submissions: number;
    roundsLaunched: number;
    graduations: number;
    rugs: number;
    totalVotes: number;
    totalVolume: number;
  };
}

const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-zinc-800 text-zinc-300",
  shortlisted: "bg-sky-500/20 text-sky-300",
  scheduled: "bg-lime-400/20 text-lime-300",
  launched: "bg-emerald-500/20 text-emerald-300",
  rejected: "bg-red-500/15 text-red-300/80",
};

type Tab = "overview" | "creator";

/**
 * The public profile — player identity and creator record on one page, split
 * into Overview / Creator tabs so a prolific creator's page doesn't become a
 * wall. Both /profile/[address] and /creator/[address] render this; the creator
 * route just deep-links the Creator tab, so every existing link keeps working.
 */
export function PublicProfile({
  address,
  initialTab = "overview",
}: {
  address: string;
  initialTab?: Tab;
}) {
  const unit = useUnit();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [history, setHistory] = useState<RoundHistoryEntry[]>([]);
  const [creator, setCreator] = useState<CreatorView | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    api<PlayerProfile>(`/api/profile/${address}`)
      .then(setProfile)
      .catch(() => setMissing(true));
    api<RoundHistoryEntry[]>(`/api/profile/${address}/history`)
      .then(setHistory)
      .catch(() => {});
    api<CreatorView>(`/api/creator/${address}`)
      .then(setCreator)
      .catch(() => setCreator(null));
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
      (a, b) =>
        ["common", "rare", "epic", "legendary"].indexOf(b.rarity) -
        ["common", "rare", "epic", "legendary"].indexOf(a.rarity),
    );
  const pnl = Number(s.totalPnl);

  const isCreator =
    !!creator &&
    (creator.aggregates.submissions > 0 ||
      creator.aggregates.roundsLaunched > 0 ||
      creator.creatorReputation !== 0 ||
      (creator.rugBans?.length ?? 0) > 0);
  // If we were deep-linked to the creator tab but this address isn't a creator
  // (or the record hasn't loaded yet), fall back to Overview.
  const activeTab: Tab = tab === "creator" && isCreator ? "creator" : "overview";
  const a = creator?.aggregates;
  const gradRate =
    a && a.roundsLaunched > 0 ? Math.round((a.graduations / a.roundsLaunched) * 100) : 0;

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
      />

      {isCreator && (
        <TabBar
          tabs={
            [
              ["overview", "Overview"],
              ["creator", "Creator"],
            ] as const
          }
          value={activeTab}
          onChange={setTab}
        />
      )}

      {activeTab === "overview" && (
        <div className="space-y-6">
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

          {unlocked.length > 0 && (
            <section>
              <SectionTitle
                title="Achievements"
                action={
                  <span className="font-mono text-xs text-zinc-500">{unlocked.length} earned</span>
                }
              />
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {unlocked.map((ach) => (
                  <AchievementCard key={ach.id} achievement={ach} unlocked />
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionTitle title="Trading History" />
            <MatchHistory entries={history} cap={5} />
          </section>
        </div>
      )}

      {activeTab === "creator" && creator && a && (
        <div className="space-y-6">
          <section>
            <SectionTitle title="Creator Reputation" />
            <ReputationPanel
              reputation={creator.creatorReputation}
              bans={creator.rugBans ?? []}
              banned={!!creator.banned}
            />
          </section>

          {creator.feesEarned > 0 && <FeesEarned eth={creator.feesEarned} unit={unit} />}

          <section>
            <SectionTitle title="Track Record" />
            <StatGrid>
              <StatCard icon="🪙" label="Submissions" value={a.submissions} />
              <StatCard icon="🚀" label="Launched" value={a.roundsLaunched} />
              <StatCard icon="🍽️" label="Served Up" value={a.graduations} tone="text-lime-300" />
              <StatCard
                icon="🔥"
                label="Rugs"
                value={a.rugs}
                tone={a.rugs > 0 ? "text-red-300" : "text-zinc-100"}
              />
              <StatCard icon="📊" label="Graduation Rate" value={`${gradRate}%`} tone="text-emerald-300" />
              <StatCard icon="🗳️" label="Community Votes" value={a.totalVotes} />
              <StatCard icon="💧" label="Volume Launched" value={a.totalVolume.toFixed(1)} hint={unit} />
              <StatCard icon="💰" label="Fees Earned" value={creator.feesEarned.toFixed(3)} hint={unit} />
            </StatGrid>
          </section>

          <section>
            <SectionTitle title="Rounds Launched" />
            {creator.rounds.length === 0 ? (
              <div className="rounded-2xl bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
                No rounds launched yet.
              </div>
            ) : (
              <ExpandableRows
                items={creator.rounds}
                cap={5}
                gap="space-y-2"
                render={({ round, summary }) => {
                  const rug =
                    round.endReason === "rug_detected" || round.endReason === "liquidity_removed";
                  return (
                    <div
                      key={round.id}
                      className={`flex flex-wrap items-center gap-3 rounded-2xl p-3.5 text-sm transition ${
                        round.graduated
                          ? "bg-lime-400/[0.07]"
                          : rug
                            ? "bg-red-500/[0.07]"
                            : "bg-zinc-900/40"
                      }`}
                    >
                      <Link href={`/round/${round.id}`} className="flex items-center gap-2 hover:underline">
                        {round.token.artworkUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={round.token.artworkUrl}
                            alt=""
                            className="h-9 w-9 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800">
                            🪙
                          </div>
                        )}
                        <span className="font-bold">
                          {round.token.name}{" "}
                          <span className="font-mono text-zinc-500">${round.token.symbol}</span>
                        </span>
                      </Link>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-300">
                        {round.tier}
                      </span>
                      <span
                        className={`text-xs font-bold ${
                          round.state === "live"
                            ? "text-emerald-300"
                            : round.graduated
                              ? "text-lime-300"
                              : rug
                                ? "text-red-300"
                                : "text-zinc-400"
                        }`}
                      >
                        {round.state === "live"
                          ? "● LIVE"
                          : round.graduated
                            ? "🍽️ served up"
                            : rug
                              ? "🔥 burnt"
                              : (round.endReason ?? "").replace(/_/g, " ")}
                      </span>
                      {summary && (
                        <span className="ml-auto font-mono text-[11px] text-zinc-500">
                          vol {summary.totalVolume.toFixed(1)} · peak {summary.peakMcap.toFixed(0)} ·{" "}
                          {summary.holderCount} holders
                        </span>
                      )}
                      {round.state === "results" && !round.graduated && (
                        <RunItBackButton round={round} className={summary ? "" : "ml-auto"} />
                      )}
                    </div>
                  );
                }}
              />
            )}
          </section>

          <section>
            <SectionTitle title="Submission History" />
            {creator.concepts.length === 0 ? (
              <div className="rounded-2xl bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
                Nothing submitted yet.
              </div>
            ) : (
              <ExpandableRows
                items={creator.concepts}
                cap={10}
                gap="grid gap-2.5 sm:grid-cols-2"
                render={(c) => (
                  <div key={c.id} className="rounded-2xl bg-zinc-900/40 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-bold">
                        {c.name} <span className="font-mono text-zinc-500">${c.symbol}</span>
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          STATUS_STYLE[c.status] ?? "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs text-zinc-400">{c.theme}</div>
                    <div className="mt-1.5 font-mono text-[11px] text-zinc-600">{c.votes} votes</div>
                  </div>
                )}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
