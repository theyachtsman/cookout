"use client";

import { useEffect, useState } from "react";
import type { Round } from "@cookout/shared";

/** Big always-visible banner: what phase the round is in, what happens next,
 *  and a live countdown + progress bar to the next transition. */
export function PhaseBanner({ round }: { round: Round }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  interface Phase {
    label: string;
    detail: string;
    until?: number;
    from?: number;
    tone: string;
  }

  const phase: Phase = (() => {
    switch (round.state) {
      case "scheduled":
        return {
          label: "STARTING SOON",
          detail: "Token reveals when the lobby opens",
          from: round.scheduledAt - 15 * 60_000,
          until: round.scheduledAt,
          tone: "border-zinc-700 bg-zinc-900",
        };
      case "lobby":
        return {
          label: "LOBBY OPEN",
          detail: "Position queue opens next — get your entry ready",
          from: round.scheduledAt,
          until: round.queueOpensAt,
          tone: "border-sky-500/50 bg-sky-500/10",
        };
      case "queue_open":
        return {
          label: "QUEUE OPEN — PULL UP",
          detail:
            "Submit buy intents now. Everyone settles at ONE clearing price — order and speed don't matter",
          from: round.queueOpensAt,
          until: round.queueClosesAt,
          tone: "border-lime-400/60 bg-lime-400/10",
        };
      case "settling":
        return {
          label: "SETTLING",
          detail: "Queue closed — computing the uniform clearing price…",
          tone: "border-purple-500/50 bg-purple-500/10",
        };
      case "live":
        return {
          label: "● LIVE TRADING",
          detail: "Round ends on the timer, a rug, low volume, or the mcap target",
          from: round.liveAt,
          until: round.endsAt,
          tone: "border-emerald-500/60 bg-emerald-500/10",
        };
      case "ended":
        return {
          label: "RESOLVING",
          detail: "Round ended — computing results…",
          tone: "border-zinc-600 bg-zinc-900",
        };
      default:
        return {
          label: round.graduated ? "🍽️ SERVED UP — OUT IN THE WILD" : "ROUND OVER",
          detail: round.graduated
            ? "Bonding targets hit — the battle is over and this market now trades in the wild (paper-simulated). Position caps are off."
            : `Ended: ${(round.endReason ?? "").replace(/_/g, " ")} — positions resolved at one uniform redemption price`,
          tone: round.graduated
            ? "border-emerald-500/60 bg-emerald-500/10"
            : "border-zinc-600 bg-zinc-900",
        };
    }
  })();

  const remaining = phase.until ? Math.max(0, phase.until - now) : null;
  const mm = remaining !== null ? Math.floor(remaining / 60000) : 0;
  const ss = remaining !== null ? Math.floor((remaining % 60000) / 1000) : 0;
  const progress =
    phase.until && phase.from
      ? Math.min(100, Math.max(0, ((now - phase.from) / (phase.until - phase.from)) * 100))
      : null;

  return (
    <div className={`rounded-xl border px-5 py-3 ${phase.tone}`}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <span className={`text-lg font-black tracking-wide ${round.state === "live" ? "animate-pulse text-emerald-300" : ""}`}>
          {phase.label}
        </span>
        <span className="text-sm text-zinc-400">{phase.detail}</span>
        {remaining !== null && (
          <span className="ml-auto font-mono text-2xl font-black tabular-nums">
            {mm}:{String(ss).padStart(2, "0")}
          </span>
        )}
        {round.state === "settling" && (
          <span className="ml-auto inline-block h-5 w-5 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
        )}
      </div>
      {progress !== null && (
        <div className="mt-2 h-1 overflow-hidden rounded bg-zinc-800">
          <div className="h-full bg-current opacity-70 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
