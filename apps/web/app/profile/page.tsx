"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ACHIEVEMENTS, xpForLevel } from "@cookout/shared";
import { api } from "../../lib/api";
import { DEFAULT_CHAIN_ID, arenaBalance, hasArenaWallet } from "../../lib/arenaWallet";
import { useChainOnly, useUnit } from "../../lib/chainOnly";
import { useSession } from "../../lib/session";
import { AudioMixer } from "../../components/AudioSettings";
import { CosmeticsLocker } from "../../components/CosmeticsLocker";
import { ImagePicker } from "../../components/ImagePicker";
import { Missions } from "../../components/Missions";
import { Progress } from "../../components/Progress";
import { ReputationPanel } from "../../components/Reputation";
import {
  Avatar,
  ProfileHero,
  RARITY,
  SectionTitle,
  StatCard,
  StatGrid,
} from "../../components/ProfileUI";

export default function ProfilePage() {
  const { profile, signIn, refresh } = useSession();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const chainOnly = useChainOnly();
  const unit = useUnit();

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
        name={displayName}
        level={profile.level}
        title={profile.title}
        xp={profile.xp}
        currLevelXp={xpForLevel(profile.level)}
        nextLevelXp={xpForLevel(profile.level + 1)}
        chips={
          <>
            <span className="font-mono text-xs text-zinc-500">{profile.xp.toLocaleString()} XP</span>
            <button
              onClick={() => setEditing((v) => !v)}
              className="rounded-full border border-zinc-700 px-2.5 py-0.5 text-[11px] font-bold text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
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
              <div className="text-[11px] text-zinc-500">ETH · arena wallet →</div>
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
        {/* quick links + editor + referral, all inside the hero card */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <Link href={`/creator/${profile.address}`} className="font-bold text-lime-400 hover:underline">
            My coins &amp; launches →
          </Link>
          <Link href={`/profile/${profile.address}`} className="text-zinc-400 hover:text-zinc-200">
            View public profile →
          </Link>
        </div>

        {editing && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
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
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-lime-400/50"
              />
              <button
                onClick={() => void saveName()}
                className="rounded-lg bg-lime-400 px-3 py-1.5 text-sm font-black text-zinc-950 hover:bg-lime-300"
              >
                Save
              </button>
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

      {/* Career stats */}
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

      {/* Jackpot winnings */}
      {(profile.jackpotWinnings ?? 0) > 0 && (
        <section className="rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/10 to-transparent p-5">
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
                  className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-2 py-1 font-mono text-xs text-amber-200"
                >
                  {["🥇", "🥈", "🥉"][w.rank - 1] ?? `#${w.rank}`} {w.week}
                </span>
              ))}
          </div>
        </section>
      )}

      {/* Reputation */}
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

      {/* Quests */}
      <section>
        <SectionTitle title="Quests & Challenges" />
        <Missions />
      </section>

      {/* Progression */}
      <section>
        <SectionTitle title="Progression" />
        <Progress />
      </section>

      {/* Achievements */}
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
            .map((a) => {
              const unlocked = profile.achievements.includes(a.id);
              const r = RARITY[a.rarity] ?? RARITY.common;
              return (
                <div
                  key={a.id}
                  className={`rounded-xl border p-3.5 transition ${
                    unlocked ? `${r.ring} ${r.wash}` : "border-zinc-800/70 opacity-45"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-zinc-100">
                      {unlocked ? "🏅" : "🔒"} {a.name}
                    </span>
                    <span
                      className={`shrink-0 text-[9px] font-black uppercase tracking-wide ${
                        unlocked ? r.text : "text-zinc-600"
                      }`}
                    >
                      {r.label}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-zinc-400">{a.description}</div>
                </div>
              );
            })}
        </div>
      </section>

      {/* Cosmetics + settings carry their own headers */}
      <CosmeticsLocker />

      <AudioMixer />
    </div>
  );
}
