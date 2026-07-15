"use client";

import { useEffect, useState } from "react";
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

  const groups: Array<["daily" | "weekly", string]> = [
    ["daily", "Daily Missions"],
    ["weekly", "Weekly Challenges"],
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map(([period, label]) => (
        <div key={period} className="rounded-xl border border-zinc-800 p-4">
          <h3 className="mb-3 text-sm font-bold text-zinc-300">{label}</h3>
          <div className="space-y-2">
            {missions
              .filter((m) => m.period === period)
              .map((m) => (
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
      ))}
    </div>
  );
}
