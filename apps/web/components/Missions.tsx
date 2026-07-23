"use client";

import { useEffect, useState } from "react";
import { DAILY_SET_BONUS_XP, WEEKLY_SET_BONUS_XP } from "@cookout/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

interface MissionStatus {
  id: string;
  name: string;
  description: string;
  period: "daily" | "weekly";
  target: number;
  xp: number;
  progress: number;
  completed: boolean;
}

export function Missions() {
  const { profile } = useSession();
  const [missions, setMissions] = useState<MissionStatus[]>([]);

  useEffect(() => {
    if (!profile) return;
    api<MissionStatus[]>("/api/missions")
      .then(setMissions)
      .catch(() => {});
  }, [profile]);

  if (!profile || missions.length === 0) return null;

  const groups: Array<["daily" | "weekly", string, string, number]> = [
    ["daily", "Daily Quests", "Rotates every day", DAILY_SET_BONUS_XP],
    ["weekly", "Weekly Challenges", "Resets Monday · feeds the Jackpot", WEEKLY_SET_BONUS_XP],
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map(([period, label, tagline, bonus]) => {
        const items = missions.filter((m) => m.period === period);
        const allDone = items.length > 0 && items.every((m) => m.completed);
        return (
        <div key={period} className="rounded-xl border border-zinc-800 p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-sm font-bold text-zinc-300">{label}</h3>
            <span className="text-[10px] uppercase tracking-wide text-zinc-600">{tagline}</span>
          </div>
          <div
            className={`mb-3 rounded-lg border px-3 py-1.5 text-xs ${
              allDone
                ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                : "border-zinc-800 bg-zinc-900/60 text-zinc-500"
            }`}
          >
            {allDone ? "✓ " : "🎯 "}
            Clear all for <span className="font-bold text-amber-300">+{bonus} XP</span> bonus
            {allDone ? " · earned!" : ""}
          </div>
          <div className="space-y-2">
            {items.map((m) => (
                <div key={m.id} className="rounded-lg bg-zinc-900 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className={`font-bold ${m.completed ? "text-emerald-400" : ""}`}>
                      {m.completed ? "✓ " : ""}
                      {m.name}
                    </span>
                    <span className="text-xs text-lime-400">+{m.xp} XP</span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">{m.description}</div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
                    <div
                      className={`h-full ${m.completed ? "bg-emerald-500" : "bg-lime-400"}`}
                      style={{ width: `${(m.progress / m.target) * 100}%` }}
                    />
                  </div>
                  <div className="mt-1 text-right font-mono text-[10px] text-zinc-500">
                    {m.progress}/{m.target}
                  </div>
                </div>
              ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}
