"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ACHIEVEMENTS, COSMETICS, xpForLevel, type Round, type RoundHistoryEntry } from "@cookout/shared";
import { api } from "../../lib/api";
import { DEFAULT_CHAIN_ID, arenaBalance, hasArenaWallet } from "../../lib/arenaWallet";
import { useChainOnly, useUnit } from "../../lib/chainOnly";
import { useSession } from "../../lib/session";
import { CoinCard } from "../../components/CoinCard";
import { CosmeticsLocker } from "../../components/CosmeticsLocker";
import { FeesEarned } from "../../components/FeesEarned";
import { ImagePicker } from "../../components/ImagePicker";
import { Missions } from "../../components/Missions";
import { Progress } from "../../components/Progress";
import { ReputationPanel } from "../../components/Reputation";
import { RunItBackButton } from "../../components/RunItBack";
import { RunItBack as PitRunItBack } from "../../components/PitResults";
import { PitProfile } from "../../components/PitProfile";
import { XpBreakdown } from "../../components/XpBreakdown";
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

type Tab = "overview" | "runitback" | "pit" | "quests" | "progression" | "achievements" | "rewards";

const TABS = [
  ["overview", "Overview"],
  ["runitback", "Run It Back"],
  ["pit", "The Pit"],
  ["quests", "Quests"],
  ["progression", "Progression"],
  ["achievements", "Achievements"],
  ["rewards", "Rewards"],
] as const;

const isRugRound = (r: Round) =>
  r.endReason === "rug_detected" || r.endReason === "liquidity_removed";

/**
 * One coin's Run It Back entry: the most recent attempt, plus how many times
 * it's been run. A dev who has run $SAME five times should see one card, not
 * five identical ones — so rounds are folded by coin identity (ticker + name).
 */
interface RunnableCoin {
  /** The latest non-graduating round for this coin — what the button acts on. */
  latest: Round;
  /** How many of this dev's rounds for this coin are eligible. */
  attempts: number;
}

/** Fold a dev's rounds into one entry per coin, newest attempt first. */
function foldRunnable(rounds: Round[]): RunnableCoin[] {
  const byCoin = new Map<string, RunnableCoin>();
  for (const r of rounds) {
    // Same ticker AND same name = the same coin, however many times it ran.
    const key = `${r.token.symbol.toUpperCase()}|${r.token.name.trim().toLowerCase()}`;
    const seen = byCoin.get(key);
    if (!seen) {
      byCoin.set(key, { latest: r, attempts: 1 });
      continue;
    }
    seen.attempts++;
    const at = (x: Round) => x.endedAt ?? x.scheduledAt;
    if (at(r) > at(seen.latest)) seen.latest = r;
  }
  return [...byCoin.values()].sort(
    (a, b) =>
      (b.latest.endedAt ?? b.latest.scheduledAt) - (a.latest.endedAt ?? a.latest.scheduledAt),
  );
}

export default function ProfilePage() {
  const { profile, signIn, refresh } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<RoundHistoryEntry[]>([]);
  const [myRounds, setMyRounds] = useState<Round[]>([]);
  const chainOnly = useChainOnly();
  const unit = useUnit();

  useEffect(() => {
    if (!profile) return;
    api<RoundHistoryEntry[]>(`/api/profile/${profile.address}/history`)
      .then(setHistory)
      .catch(() => {});
    // Own launches, for the Run It Back tab. `cancelled` covers Pit matches
    // whose queue timed out — those never traded but can still be run back.
    api<{ rounds: Array<{ round: Round }>; cancelled?: Array<{ round: Round }> }>(
      `/api/creator/${profile.address}`,
    )
      .then((d) =>
        setMyRounds([...d.rounds, ...(d.cancelled ?? [])].map((r) => r.round)),
      )
      .catch(() => setMyRounds([]));
  }, [profile?.address]);

  // Run It Back only ever offers coins that DIDN'T graduate — a served-up coin
  // has nothing to run back. Cook Out rounds go back through the vote; Pit
  // matches (including ones cancelled by a queue timeout) relaunch directly.
  const cookoutRunnable = useMemo(
    () =>
      foldRunnable(
        myRounds.filter((r) => r.matchType !== "pit" && r.state === "results" && !r.graduated),
      ),
    [myRounds],
  );
  const pitRunnable = useMemo(
    () =>
      foldRunnable(
        myRounds.filter(
          (r) =>
            r.matchType === "pit" &&
            (r.state === "cancelled" || (r.state === "results" && !r.graduated)),
        ),
      ),
    [myRounds],
  );

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
            <SectionTitle title="Recent Matches" />
            <MatchHistory entries={history} cap={5} />
          </section>
        </div>
      )}

      {tab === "runitback" && (
        <div className="space-y-6">
          <SectionTitle
            title="Run It Back"
            action={
              <span className="font-mono text-xs text-zinc-500">
                {cookoutRunnable.length + pitRunnable.length} eligible
              </span>
            }
          />
          <p className="-mt-3 text-xs text-zinc-500">
            Only coins that didn&apos;t graduate. A coin you&apos;ve run several times shows once,
            with its attempts counted.
          </p>
          <RunItBackSection
            title="🍳 Cook Out"
            blurb="Send it back to the community vote in a fresh mode."
            empty="No Cook Out coins to run back. Any of your matches that finish without graduating land here."
            coins={cookoutRunnable}
          />
          <RunItBackSection
            title="🕳️ The Pit"
            blurb="Relaunch straight into a fresh Pit lobby — no vote needed."
            empty="No Pit coins to run back. Matches that end or time out in the queue land here."
            coins={pitRunnable}
          />
        </div>
      )}

      {tab === "pit" && <PitProfile address={profile.address} />}

      {tab === "quests" && (
        <div className="space-y-6">
          <SectionTitle title="Quests & Challenges" />
          <Missions />
          <XpBreakdown address={profile.address} />
        </div>
      )}

      {tab === "progression" && (
        <div className="space-y-6">
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
        </div>
      )}

      {tab === "achievements" && (
        <div className="space-y-6">
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
        </div>
      )}

      {tab === "rewards" && (
        <div className="space-y-6">
          <CosmeticsLocker />
          {((profile.jackpotWinnings ?? 0) > 0 || (profile.feesEarned ?? 0) > 0) && (
            <section className="space-y-6">
              <SectionTitle title="Earnings" />
              {(profile.jackpotWinnings ?? 0) > 0 && (
                <JackpotWinnings profile={profile} unit={unit} />
              )}
              {(profile.feesEarned ?? 0) > 0 && (
                <FeesEarned eth={profile.feesEarned ?? 0} unit={unit} self />
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One half of the Run It Back tab — Cook Out or The Pit. Each coin appears
 * once, with a badge when it has been run more than once, and the relaunch
 * button that belongs to its game type.
 */
function RunItBackSection({
  title,
  blurb,
  empty,
  coins,
}: {
  title: string;
  blurb: string;
  empty: string;
  coins: RunnableCoin[];
}) {
  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-black uppercase tracking-wide text-zinc-300">{title}</h3>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold text-zinc-400">
          {coins.length}
        </span>
        <span className="text-xs text-zinc-500">{blurb}</span>
      </div>
      {coins.length === 0 ? (
        <div className="rounded-2xl bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          {empty}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coins.map(({ latest: r, attempts }) => {
            const rug = isRugRound(r);
            const cancelled = r.state === "cancelled";
            return (
              <CoinCard
                key={r.id}
                coin={{
                  ...r.token,
                  tier: r.tier,
                  id: r.conceptId,
                  creatorAddress: r.creatorAddress,
                  mode: r.mode,
                  modifiers: r.modifiers,
                }}
                borderClass="border-transparent"
                corner={
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${
                      cancelled
                        ? "bg-amber-500/20 text-amber-300"
                        : rug
                          ? "bg-red-500/20 text-red-300"
                          : "bg-zinc-800/90 text-zinc-400"
                    }`}
                  >
                    {cancelled ? "🚫 cancelled" : rug ? "🔥 burnt" : "closed"}
                  </span>
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] text-zinc-500">
                    {cancelled
                      ? "queue timed out · deposits refunded"
                      : rug
                        ? "rugged"
                        : `ended: ${r.endReason?.replace(/_/g, " ")}`}
                    {attempts > 1 && (
                      <span className="ml-1.5 rounded bg-zinc-800/90 px-1.5 py-0.5 font-bold text-zinc-400">
                        ×{attempts} runs
                      </span>
                    )}
                  </span>
                  {r.matchType === "pit" ? (
                    <PitRunItBack round={r} compact />
                  ) : (
                    <RunItBackButton round={r} />
                  )}
                </div>
              </CoinCard>
            );
          })}
        </div>
      )}
    </section>
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
