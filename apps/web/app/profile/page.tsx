"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ACHIEVEMENTS, COSMETICS, xpForLevel, type RoundHistoryEntry } from "@cookout/shared";
import { api } from "../../lib/api";
import { DEFAULT_CHAIN_ID, arenaBalance, hasArenaWallet } from "../../lib/arenaWallet";
import { useChainOnly, useUnit } from "../../lib/chainOnly";
import { useSession } from "../../lib/session";
import { CosmeticsLocker } from "../../components/CosmeticsLocker";
import { FeesEarned } from "../../components/FeesEarned";
import { ImagePicker } from "../../components/ImagePicker";
import { Missions } from "../../components/Missions";
import { Progress } from "../../components/Progress";
import { ReputationPanel } from "../../components/Reputation";
import {
  AchievementCard,
  Avatar,
  MatchHistory,
  ProfileHero,
  SectionTitle,
  StatCard,
  StatGrid,
  TabBar,
} from "../../components/ProfileUI";

type Tab = "overview" | "earnings" | "progression" | "locker";

const TABS = [
  ["overview", "Overview"],
  ["earnings", "Earnings"],
  ["progression", "Progression"],
  ["locker", "Locker"],
] as const;

export default function ProfilePage() {
  const { profile, signIn, refresh } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<RoundHistoryEntry[]>([]);
  const chainOnly = useChainOnly();
  const unit = useUnit();

  useEffect(() => {
    if (!profile) return;
    api<RoundHistoryEntry[]>(`/api/profile/${profile.address}/history`)
      .then(setHistory)
      .catch(() => {});
  }, [profile?.address]);

  // Chain-only site: the headline balance is the arena wallet, not paper.
  const [arenaBal, setArenaBal] = useState<number | null>(null);
  useEffect(() => {
    if (!chainOnly || !hasArenaWallet()) return;
    const poll = () => arenaBalance(DEFAULT_CHAIN_ID).then(setArenaBal).catch(() => {});
    poll();
    const t = setInterval(poll, 10_000);
    return () => clearInterval(t);
  }, [chainOnly]);

  if (!profile)
    return (
      <div className="py-24 text-center">
        <div className="text-4xl">👤</div>
        <p className="mt-3 text-sm text-zinc-400">Sign in to see your profile.</p>
        <button
          onClick={() => void signIn()}
          className="mt-4 rounded-lg bg-lime-400 px-6 py-3 font-black text-zinc-950 hover:bg-lime-300"
        >
          Play Now
        </button>
      </div>
    );

  const s = profile.stats;
  const displayName = profile.displayName ?? `${profile.address.slice(0, 8)}…`;
  const avatarUrl = (profile as unknown as { avatarUrl?: string }).avatarUrl;
  const bannerUrl = (profile as unknown as { bannerUrl?: string }).bannerUrl;
  const equippedTitle = COSMETICS.find((c) => c.id === profile.equipped?.title)?.value;
  const equippedBadge = COSMETICS.find((c) => c.id === profile.equipped?.badge)?.value;
  const referralCount = (profile as unknown as { referralCount?: number }).referralCount ?? 0;
  const referralEarnings =
    (profile as unknown as { referralEarnings?: number }).referralEarnings ?? 0;
  const refLink =
    typeof window !== "undefined" ? `${window.location.origin}/?ref=${profile.referralCode}` : "";

  const saveName = async () => {
    if (!name.trim()) return;
    await api("/api/me", { method: "PATCH", body: { displayName: name.trim() } });
    setName("");
    setEditing(false);
    void refresh();
  };

  const copyRef = () => {
    void navigator.clipboard.writeText(refLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ProfileHero
        avatar={<Avatar url={avatarUrl} name={displayName} level={profile.level} />}
        bannerUrl={bannerUrl}
        name={displayName}
        level={profile.level}
        title={equippedTitle ?? profile.title}
        badge={equippedBadge}
        xp={profile.xp}
        currLevelXp={xpForLevel(profile.level)}
        nextLevelXp={xpForLevel(profile.level + 1)}
        rep={profile.creatorReputation}
        accent={!!profile.banned}
        chips={
          <>
            <span className="font-mono text-xs text-zinc-500">{profile.xp.toLocaleString()} XP</span>
            <button
              onClick={() => setEditing((v) => !v)}
              className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700"
            >
              ✎ Edit
            </button>
          </>
        }
        right={
          chainOnly ? (
            <Link href="/wallet" className="block hover:opacity-80">
              <div className="font-mono text-2xl font-black text-lime-400">
                ⚡ {arenaBal !== null ? arenaBal.toFixed(4) : "—"}
              </div>
              <div className="text-[11px] text-zinc-500">ETH · Cook Out Balance →</div>
            </Link>
          ) : (
            <Link href="/wallet" className="block hover:opacity-80">
              <div className="font-mono text-2xl font-black text-lime-400">
                ⚡ {(profile.arenaBalance ?? 0).toFixed(3)}
              </div>
              <div className="text-[11px] text-zinc-500">
                pETH · {(profile.paperBalance ?? 0).toFixed(2)} banked →
              </div>
            </Link>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <Link href={`/creator/${profile.address}`} className="font-bold text-lime-400 hover:underline">
            My coins &amp; launches →
          </Link>
          <Link href={`/profile/${profile.address}`} className="text-zinc-400 hover:text-zinc-200">
            View public profile →
          </Link>
          <Link href="/settings" className="text-zinc-400 hover:text-zinc-200">
            Settings →
          </Link>
        </div>

        {editing && (
          <div className="flex flex-col gap-3 rounded-xl bg-zinc-950/50 p-3">
            <div className="flex flex-wrap items-center gap-4">
              <ImagePicker
                label="Profile picture"
                round
                value={avatarUrl}
                onChange={(dataUrl) =>
                  void api("/api/me", { method: "PATCH", body: { avatarUrl: dataUrl } }).then(refresh)
                }
              />
              <div className="flex items-center gap-2">
                <input
                  placeholder={profile.displayName ?? "set a display name"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm outline-none ring-1 ring-zinc-700 focus:ring-lime-400/50"
                />
                <button
                  onClick={() => void saveName()}
                  className="rounded-lg bg-lime-400 px-3 py-1.5 text-sm font-black text-zinc-950 hover:bg-lime-300"
                >
                  Save
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <ImagePicker
                label="Header banner (wide)"
                wide
                aspect={4}
                size={1200}
                value={bannerUrl}
                onChange={(dataUrl) =>
                  void api("/api/me", { method: "PATCH", body: { bannerUrl: dataUrl } }).then(refresh)
                }
              />
              {bannerUrl && (
                <button
                  onClick={() =>
                    void api("/api/me", { method: "PATCH", body: { bannerUrl: "" } }).then(refresh)
                  }
                  className="text-xs font-bold text-zinc-500 hover:text-red-300"
                >
                  Remove banner
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-950/50 px-3 py-2 text-xs">
          <span className="font-bold text-zinc-400">🎁 Invite link</span>
          <code className="truncate text-zinc-500">{refLink}</code>
          <button
            onClick={copyRef}
            className="rounded-md bg-zinc-800 px-2 py-1 font-bold hover:bg-zinc-700"
          >
            {copied ? "✓ copied" : "copy"}
          </button>
          <span className="ml-auto text-zinc-500">
            {referralCount} referred · {referralEarnings.toFixed(3)} {unit} earned
          </span>
        </div>
      </ProfileHero>

      <TabBar tabs={TABS} value={tab} onChange={setTab} />

      {tab === "overview" && (
        <div className="space-y-6">
          <section>
            <SectionTitle title="Career Stats" />
            <StatGrid>
              <StatCard icon="🎮" label="Rounds" value={s.roundsPlayed} />
              <StatCard icon="⚡" label="Trades" value={s.trades} />
              <StatCard icon="🏆" label="Wins" value={s.wins} tone="text-emerald-300" />
              <StatCard icon="💀" label="Losses" value={s.losses} tone="text-red-300" />
              <StatCard
                icon="📈"
                label="Total PnL"
                value={`${(s.totalPnl as number) >= 0 ? "+" : ""}${(s.totalPnl as number).toFixed(2)}`}
                tone={(s.totalPnl as number) >= 0 ? "text-emerald-300" : "text-red-300"}
              />
              <StatCard
                icon="🚀"
                label="Best Trade"
                value={`+${(s.bestTradePnl as number).toFixed(2)}`}
                tone="text-emerald-300"
              />
              <StatCard icon="🧊" label="Rugs Survived" value={s.rugsSurvived} />
              <StatCard icon="🔥" label="Win Streak" value={s.currentWinStreak} tone="text-orange-300" />
            </StatGrid>
          </section>

          <section>
            <SectionTitle
              title="Recent Matches"
              action={
                history.length > 5 ? (
                  <Link
                    href={`/profile/${profile.address}`}
                    className="text-xs font-bold text-lime-400 hover:underline"
                  >
                    View all {history.length} →
                  </Link>
                ) : undefined
              }
            />
            <MatchHistory entries={history.slice(0, 5)} />
          </section>
        </div>
      )}

      {tab === "earnings" && (
        <div className="space-y-6">
          {(profile.feesEarned ?? 0) > 0 && (
            <FeesEarned eth={profile.feesEarned ?? 0} unit={unit} self />
          )}
          {(profile.jackpotWinnings ?? 0) > 0 && <JackpotWinnings profile={profile} unit={unit} />}
          {(profile.feesEarned ?? 0) <= 0 && (profile.jackpotWinnings ?? 0) <= 0 && (
            <div className="rounded-2xl bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
              No earnings yet. Land a weekly Jackpot spot or launch a coin that trades, and your
              winnings and creator fees show up here.
            </div>
          )}
        </div>
      )}

      {tab === "progression" && (
        <div className="space-y-6">
          <section>
            <SectionTitle title="Quests & Challenges" />
            <Missions />
          </section>

          <section>
            <SectionTitle title="Progression" />
            <Progress />
          </section>

          <section>
            <SectionTitle title="Creator Reputation" />
            <ReputationPanel
              reputation={profile.creatorReputation}
              bans={profile.rugBans ?? []}
              banned={!!profile.banned}
              self
              selfServe={!!profile.selfServeUnban}
              onCleared={() => void refresh()}
            />
          </section>

          <section>
            <SectionTitle
              title="Achievements"
              action={
                <span className="font-mono text-xs text-zinc-500">
                  {profile.achievements.length} / {ACHIEVEMENTS.length} unlocked
                </span>
              }
            />
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {[...ACHIEVEMENTS]
                .sort(
                  (a, b) =>
                    Number(profile.achievements.includes(b.id)) -
                    Number(profile.achievements.includes(a.id)),
                )
                .map((a) => (
                  <AchievementCard
                    key={a.id}
                    achievement={a}
                    unlocked={profile.achievements.includes(a.id)}
                  />
                ))}
            </div>
          </section>
        </div>
      )}

      {tab === "locker" && <CosmeticsLocker />}
    </div>
  );
}

/** Jackpot highlight card (Overview) — kept borderless with an amber wash. */
function JackpotWinnings({
  profile,
  unit,
}: {
  profile: import("../../lib/session").Profile;
  unit: string;
}) {
  return (
    <section className="rounded-2xl bg-gradient-to-br from-amber-500/10 to-transparent p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wide text-amber-300">
          🎰 Jackpot Winnings
        </h2>
        <Link href="/jackpot" className="text-xs text-amber-400/80 hover:underline">
          this week&apos;s pot →
        </Link>
      </div>
      <div className="mt-1 font-mono text-4xl font-black text-amber-300">
        {(profile.jackpotWinnings ?? 0).toFixed(4)} {unit}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[...(profile.jackpotWins ?? [])]
          .reverse()
          .slice(0, 10)
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
  );
}
