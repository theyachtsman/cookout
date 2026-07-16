"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

interface Tier {
  at: number;
  xp: number;
  reward?: string;
  done: boolean;
}
interface ProgressData {
  streak: { current: number; best: number; freezes: number; playedToday: boolean };
  weekStreak: { current: number; best: number };
  milestones: Array<{ id: string; name: string; unit: string; value: number; tiers: Tier[] }>;
  seasonPass: { xp: number; tiers: Tier[] };
}

export function Progress() {
  const { profile } = useSession();
  const [p, setP] = useState<ProgressData | null>(null);

  useEffect(() => {
    if (!profile) return;
    api<ProgressData>("/api/progress").then(setP).catch(() => {});
  }, [profile]);

  if (!profile || !p) return null;

  const pass = p.seasonPass;
  const passMax = pass.tiers[pass.tiers.length - 1]?.at ?? 1;
  const nextPass = pass.tiers.find((t) => !t.done);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">Progression</h2>

      {/* Streaks */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-orange-500/40 bg-gradient-to-br from-orange-500/10 to-transparent p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-orange-300">🔥 Play Streak</span>
            <span className="font-mono text-xs text-zinc-500">
              {p.streak.freezes > 0 ? `❄️ ${p.streak.freezes} freeze${p.streak.freezes > 1 ? "s" : ""}` : ""}
            </span>
          </div>
          <div className="mt-1 font-mono text-3xl font-black text-orange-300">
            {p.streak.current}
            <span className="ml-1 text-sm font-bold text-zinc-500">day{p.streak.current === 1 ? "" : "s"}</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            best {p.streak.best} ·{" "}
            {p.streak.playedToday ? "counted today ✓" : "play a round today to keep it alive"}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 p-4">
          <span className="text-sm font-bold text-zinc-300">📅 Weekly Consistency</span>
          <div className="mt-1 font-mono text-3xl font-black">
            {p.weekStreak.current}
            <span className="ml-1 text-sm font-bold text-zinc-500">wk{p.weekStreak.current === 1 ? "" : "s"}</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            best {p.weekStreak.best} · clear every weekly challenge to extend
          </div>
        </div>
      </div>

      {/* Season pass */}
      <div className="rounded-xl border border-amber-400/40 bg-gradient-to-br from-amber-500/10 to-transparent p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-bold text-amber-300">🎟️ Season Pass</span>
          <span className="font-mono text-xs text-zinc-400">
            {pass.xp} XP this month{nextPass ? ` · next tier ${nextPass.at}` : " · maxed"}
          </span>
        </div>
        <div className="relative mt-3 h-2 overflow-hidden rounded bg-zinc-800">
          <div
            className="h-full bg-amber-400"
            style={{ width: `${Math.min(100, (pass.xp / passMax) * 100)}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {pass.tiers.map((t) => (
            <div
              key={t.at}
              title={t.reward ?? `+${t.xp} XP`}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                t.done
                  ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                  : "border-zinc-800 text-zinc-500"
              }`}
            >
              <span className="font-mono">{t.at}</span>
              <span className="ml-1.5 text-[10px]">
                {t.done ? "✓" : ""}
                {t.reward ? " 🎁" : ` +${t.xp}`}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Lifetime milestones */}
      <div className="rounded-xl border border-zinc-800 p-4">
        <span className="text-sm font-bold text-zinc-300">🏅 Lifetime Milestones</span>
        <div className="mt-3 space-y-3">
          {p.milestones.map((l) => {
            const next = l.tiers.find((t) => !t.done);
            const goal = next?.at ?? l.tiers[l.tiers.length - 1]!.at;
            return (
              <div key={l.id}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="font-bold text-zinc-300">{l.name}</span>
                  <span className="font-mono text-zinc-500">
                    {Math.floor(l.value).toLocaleString()} / {goal.toLocaleString()} {l.unit}
                  </span>
                </div>
                <div className="mt-1 flex gap-1">
                  {l.tiers.map((t) => (
                    <div
                      key={t.at}
                      title={`${t.at.toLocaleString()} ${l.unit} · +${t.xp} XP`}
                      className={`h-1.5 flex-1 rounded ${t.done ? "bg-lime-400" : "bg-zinc-800"}`}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
