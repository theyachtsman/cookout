"use client";

import { useState } from "react";
import { ACHIEVEMENTS, xpForLevel } from "@cookout/shared";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { CosmeticsLocker } from "../../components/CosmeticsLocker";
import { ImagePicker } from "../../components/ImagePicker";
import { Missions } from "../../components/Missions";

export default function ProfilePage() {
  const { profile, signIn, refresh } = useSession();
  const [name, setName] = useState("");

  if (!profile)
    return (
      <div className="py-16 text-center">
        <button
          onClick={() => void signIn()}
          className="rounded-lg bg-lime-400 px-6 py-3 font-black text-zinc-950"
        >
          Connect Wallet
        </button>
      </div>
    );

  const nextLevelXp = xpForLevel(profile.level + 1);
  const currLevelXp = xpForLevel(profile.level);
  const progress =
    nextLevelXp > currLevelXp
      ? Math.min(100, ((profile.xp - currLevelXp) / (nextLevelXp - currLevelXp)) * 100)
      : 100;
  const s = profile.stats;

  const saveName = async () => {
    if (!name.trim()) return;
    await api("/api/me", { method: "PATCH", body: { displayName: name.trim() } });
    setName("");
    void refresh();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-800 p-6">
        <div className="flex flex-wrap items-center gap-4">
          <ImagePicker
            label="Profile picture"
            round
            value={(profile as unknown as { avatarUrl?: string }).avatarUrl}
            onChange={(dataUrl) =>
              void api("/api/me", { method: "PATCH", body: { avatarUrl: dataUrl } }).then(refresh)
            }
          />
          <div>
            <h1 className="text-2xl font-black">
              {profile.displayName ?? `${profile.address.slice(0, 8)}…`}
            </h1>
            <div className="text-sm text-zinc-400">
              Level {profile.level} · {profile.title} · {profile.xp} XP
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-2xl font-black text-lime-400">
              {profile.paperBalance.toFixed(3)} pETH
            </div>
            <div className="text-xs text-zinc-500">paper balance</div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded bg-zinc-800">
          <div className="h-full bg-lime-400" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          {profile.xp - currLevelXp}/{nextLevelXp - currLevelXp} XP to level {profile.level + 1}
        </div>
        <div className="mt-4 flex gap-2">
          <input
            placeholder="set display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm"
          />
          <button onClick={() => void saveName()} className="rounded bg-zinc-800 px-3 py-1.5 text-sm">
            Save
          </button>
          <span className="ml-auto self-center text-xs text-zinc-500">
            <a href={`/profile/${profile.address}`} className="hover:text-zinc-300">
              public profile →
            </a>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-zinc-900 px-3 py-2 text-xs">
          <span className="text-zinc-500">Referral link</span>
          <code className="text-zinc-300">
            {typeof window !== "undefined" ? `${window.location.origin}/?ref=${profile.referralCode}` : ""}
          </code>
          <button
            onClick={() =>
              void navigator.clipboard.writeText(`${window.location.origin}/?ref=${profile.referralCode}`)
            }
            className="rounded bg-zinc-800 px-2 py-1 hover:bg-zinc-700"
          >
            copy
          </button>
          <span className="ml-auto text-zinc-500">
            {(profile as unknown as { referralCount?: number }).referralCount ?? 0} referred ·{" "}
            {((profile as unknown as { referralEarnings?: number }).referralEarnings ?? 0).toFixed(3)} pETH earned
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Rounds", s.roundsPlayed],
          ["Trades", s.trades],
          ["Wins", s.wins],
          ["Losses", s.losses],
          ["Total PnL", (s.totalPnl as number).toFixed(3)],
          ["Best trade", (s.bestTradePnl as number).toFixed(3)],
          ["Rugs survived", s.rugsSurvived],
          ["Win streak", s.currentWinStreak],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-zinc-800 p-3">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</div>
            <div className="font-mono text-lg font-bold">{v}</div>
          </div>
        ))}
      </div>

      <Missions />

      <CosmeticsLocker />

      <div>
        <h2 className="mb-3 text-lg font-bold">Achievements</h2>
        <div className="grid gap-2 md:grid-cols-3">
          {ACHIEVEMENTS.map((a) => {
            const unlocked = profile.achievements.includes(a.id);
            return (
              <div
                key={a.id}
                className={`rounded-lg border p-3 ${
                  unlocked ? "border-lime-400/50 bg-lime-400/5" : "border-zinc-800 opacity-50"
                }`}
              >
                <div className="text-sm font-bold">
                  {unlocked ? "🏅" : "🔒"} {a.name}
                  <span className="ml-2 text-[10px] uppercase text-zinc-500">{a.rarity}</span>
                </div>
                <div className="text-xs text-zinc-400">{a.description}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
