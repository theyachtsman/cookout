"use client";

import { useEffect, useRef, useState } from "react";
import type { Round } from "@cookout/shared";
import { playFanfare, playHorn, playRug, playThud, playTradeTick } from "../../lib/sfx";

/**
 * The round's announcer. Counter-Strike round banners, not a dashboard: a
 * cinematic 5-4-3-2-1-COOK into the open, urgency markers as the clock runs
 * down, a per-second countdown over the last ten, and a verdict at the end.
 *
 * Everything here is pointer-events-none and short-lived — it narrates the
 * match without ever getting between you and the buy button.
 */

type Tone = "go" | "warn" | "bad" | "win";

interface Banner {
  id: number;
  text: string;
  tone: Tone;
  /** Big single glyph (countdown digits) render larger and tighter. */
  digit?: boolean;
  ms: number;
}

const TONE: Record<Tone, string> = {
  go: "text-lime-300 drop-shadow-[0_0_25px_rgba(163,230,53,0.55)]",
  warn: "text-amber-300 drop-shadow-[0_0_25px_rgba(252,211,77,0.5)]",
  bad: "text-red-400 drop-shadow-[0_0_25px_rgba(248,113,113,0.5)]",
  win: "text-lime-300 drop-shadow-[0_0_30px_rgba(163,230,53,0.7)]",
};

export function RoundOverlays({
  round,
  onCook,
  muted,
}: {
  round: Round;
  /** Fires on "COOK!" so the page can shake the arena and wake the chart. */
  onCook?: () => void;
  muted?: boolean;
}) {
  const [banner, setBanner] = useState<Banner | null>(null);
  const idRef = useRef(0);
  const firedRef = useRef<Set<string>>(new Set());
  /**
   * The phase we arrived on. Transition cues (COOK!, MARKET OPEN, the verdict)
   * only fire if we actually watched them happen — otherwise opening a live or
   * finished round would blast the horn at you on every page load.
   */
  const arrivedOn = useRef<string | null>(null);
  if (arrivedOn.current === null) arrivedOn.current = round.state;

  const show = (text: string, tone: Tone, ms: number, digit = false) => {
    const id = ++idRef.current;
    setBanner({ id, text, tone, digit, ms });
    setTimeout(() => setBanner((b) => (b && b.id === id ? null : b)), ms);
  };
  // `show` is stable enough for our purposes; the effect below re-reads it.
  const showRef = useRef(show);
  showRef.current = show;

  // One 100ms clock drives every cue. Each fires exactly once via firedRef.
  useEffect(() => {
    const fired = firedRef.current;
    const once = (key: string, fn: () => void) => {
      if (fired.has(key)) return;
      fired.add(key);
      fn();
    };

    const tick = () => {
      const now = Date.now();
      const s = showRef.current;

      // ---- the open: 5..1 then COOK! over the last five seconds of the queue
      if (round.state === "queue_open" || round.state === "settling") {
        const until = round.queueClosesAt;
        if (until) {
          const left = Math.ceil((until - now) / 1000);
          if (left >= 1 && left <= 5) {
            once(`cd-${left}`, () => {
              s(String(left), left <= 2 ? "warn" : "go", 850, true);
              if (!muted) playTradeTick("buy", 0.02);
            });
          }
        }
      }

      const witnessed = round.state !== arrivedOn.current;

      if (round.state === "live") {
        if (witnessed) once("cook", () => {
          s("COOK!", "go", 1000);
          if (!muted) playHorn();
          onCook?.();
        });
        // MARKET OPEN lands right behind COOK! so the two read as one beat.
        if (witnessed && round.liveAt && now - round.liveAt > 900)
          once("open", () => s("MARKET OPEN", "go", 900));

        const endsAt = round.endsAt;
        if (endsAt) {
          const left = Math.ceil((endsAt - now) / 1000);
          if (left <= 60 && left > 55) once("final-minute", () => {
            s("FINAL MINUTE", "warn", 1000);
            if (!muted) playThud();
          });
          if (left <= 30 && left > 27) once("final-30", () => s("30 SECONDS", "warn", 900));
          if (left >= 1 && left <= 10)
            once(`end-${left}`, () => {
              s(String(left), left <= 3 ? "bad" : "warn", 750, true);
              if (!muted) playTradeTick(left <= 3 ? "sell" : "buy", 0.02);
            });
        }
      }

      // ---- the verdict
      if (witnessed && (round.state === "results" || round.state === "ended")) {
        if (round.graduated) once("verdict", () => {
          s("SERVED UP", "win", 1400);
          if (!muted) playFanfare();
        });
        else if (round.endReason === "rug_detected" || round.endReason === "liquidity_removed")
          once("verdict", () => {
            s("RUGGED", "bad", 1400);
            if (!muted) playRug();
          });
        else once("verdict", () => s("ROUND OVER", "warn", 1200));
      }
    };

    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [round.state, round.queueClosesAt, round.liveAt, round.endsAt, round.graduated, round.endReason, onCook, muted]);

  if (!banner) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
      <div
        key={banner.id}
        className={`animate-[bannerIn_.35s_cubic-bezier(.2,1.5,.4,1)] text-center font-black tracking-tight ${
          TONE[banner.tone]
        } ${banner.digit ? "text-[10rem] leading-none md:text-[14rem]" : "text-6xl md:text-8xl"}`}
        style={{ animationFillMode: "both" }}
      >
        {banner.text}
      </div>
    </div>
  );
}

/**
 * The final-minute mood shift: a heartbeat vignette over the arena column that
 * tightens as the clock runs out. Separate from the banners because it's a
 * sustained state, not an announcement.
 */
export function UrgencyPulse({ endsAt, active }: { endsAt?: number; active: boolean }) {
  const [left, setLeft] = useState(Infinity);
  useEffect(() => {
    if (!active || !endsAt) return;
    const t = setInterval(() => setLeft((endsAt - Date.now()) / 1000), 200);
    return () => clearInterval(t);
  }, [active, endsAt]);

  if (!active || left > 60) return null;
  const critical = left <= 10;
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-10 rounded-xl ${
        critical ? "animate-[heartbeat_.6s_ease-in-out_infinite]" : "animate-[heartbeat_1.4s_ease-in-out_infinite]"
      }`}
      style={{
        boxShadow: `inset 0 0 ${critical ? 70 : 45}px ${
          critical ? "rgba(248,113,113,0.30)" : "rgba(252,211,77,0.20)"
        }`,
      }}
    />
  );
}
