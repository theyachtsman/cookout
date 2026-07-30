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
    <div className="grid gap-6 md:grid-cols-2">
      {groups.map(([period, label, tagline, bonus]) => {
        const items = missions.filter((m) => m.period === period);
        const done = items.filter((m) => m.completed).length;
        const allDone = items.length > 0 && done === items.length;
        return (
          <div key={period} className="space-y-2.5">
            {/* group header: title, a done/total ring, and the set bonus */}
            <div className="flex items-center gap-3">
              <div>
                <h3 className="text-sm font-black uppercase tracking-wide text-zinc-200">{label}</h3>
                <div className="text-[10px] uppercase tracking-wide text-zinc-600">{tagline}</div>
              </div>
              <div className="ml-auto text-right">
                <div className="font-mono text-sm font-black text-zinc-100">
                  {done}
                  <span className="text-zinc-600">/{items.length}</span>
                </div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-600">done</div>
              </div>
            </div>

            <div
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${
                allDone ? "bg-amber-400/15 text-amber-300" : "bg-zinc-900/60 text-zinc-400"
              }`}
            >
              <span>{allDone ? "🏆" : "🎯"}</span>
              <span>
                {allDone ? "Set cleared — " : "Clear all for "}
                <span className="text-amber-300">+{bonus} XP</span>
                {allDone ? " earned" : " bonus"}
              </span>
            </div>

            <div className="space-y-2">
              {items.map((m) => {
                const pct = Math.min(100, (m.progress / m.target) * 100);
                return (
                  <div
                    key={m.id}
                    className={`rounded-2xl p-3.5 transition ${
                      m.completed ? "bg-emerald-400/[0.08]" : "bg-zinc-900/40"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${
                          m.completed
                            ? "bg-emerald-400/20 text-emerald-300"
                            : "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {m.completed ? "✓" : period === "daily" ? "☀️" : "📅"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={`truncate font-bold ${
                              m.completed ? "text-emerald-300" : "text-zinc-100"
                            }`}
                          >
                            {m.name}
                          </span>
                          <span className="shrink-0 text-xs font-black text-lime-400">
                            +{m.xp} XP
                          </span>
                        </div>
                        <div className="truncate text-xs text-zinc-500">{m.description}</div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-2.5">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className={`h-full rounded-full transition-[width] duration-500 ${
                            m.completed
                              ? "bg-emerald-400"
                              : "bg-gradient-to-r from-lime-400 to-emerald-400"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                        {m.progress}/{m.target}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
