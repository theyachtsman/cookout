"use client";

import { useEffect, useRef, useState } from "react";
import type { Round } from "@cookout/shared";
import { audio } from "../../lib/audio";

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
  nowOffset = 0,
  digitsOnly = false,
}: {
  round: Round;
  /** Fires on "COOK!" so the page can shake the arena and wake the chart. */
  onCook?: () => void;
  muted?: boolean;
  /** Server-clock offset (ms) so the 5-4-3-2-1 fires on the server's clock, not
   *  the browser's (a skewed local clock skipped the pull-up countdown). */
  nowOffset?: number;
  /**
   * Numbers only — no phase words and no verdict.
   *
   * The Pit runs its own announcer ("LIVE — beat the Goons", "RUG PULL",
   * "GRADUATED") but never counted anyone in or out. Rendering the whole
   * Cook Out announcer there would stack two banners on the same beat and
   * put Cook Out words over a Pit match, so it takes the digits and keeps
   * its own voice.
   */
  digitsOnly?: boolean;
}) {
  const [banner, setBanner] = useState<Banner | null>(null);
  const idRef = useRef(0);
  // Read the latest offset from inside the interval without re-arming it.
  const offsetRef = useRef(nowOffset);
  offsetRef.current = nowOffset;
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
      const now = Date.now() + offsetRef.current;
      const s = showRef.current;

      // A 5..1 ladder into a phase boundary, reused for every gate: doors, the
      // pull-up, and the open all count in the same escalating impacts.
      const ladder = (prefix: string, until?: number) => {
        if (!until) return;
        const left = Math.ceil((until - now) / 1000);
        if (left >= 1 && left <= 5)
          once(`${prefix}-${left}`, () => {
            s(String(left), left <= 2 ? "warn" : "go", 850, true);
            if (!muted) audio.play(`countdown.${left}`);
          });
      };

      // ---- doors: 5..1 into the lobby reveal (while the round is still teased)
      if (round.state === "scheduled") ladder("doors", round.scheduledAt);
      // ---- pull up: 5..1 into the queue opening (while the lobby is up)
      if (round.state === "lobby") ladder("pull", round.queueOpensAt);

      // ---- the open: 5..1 then COOK! over the last five seconds of the queue
      if (round.state === "queue_open" || round.state === "settling")
        ladder("cd", round.queueClosesAt);

      const witnessed = round.state !== arrivedOn.current && !digitsOnly;

      // ---- phase reveals: doors open into the lobby, PULL UP into the queue.
      // These only fire on a transition we actually watched (witnessed), so
      // opening a round mid-phase never blasts a stale banner.
      if (witnessed && round.state === "lobby")
        once("lobby-open", () => {
          s("LOBBY OPEN", "go", 1100);
          if (!muted) audio.play("round.launch");
        });
      if (witnessed && round.state === "queue_open")
        once("pull-up", () => {
          s("PULL UP", "go", 1100);
          if (!muted) audio.play("round.launch");
        });

      if (round.state === "live") {
        if (witnessed) once("cook", () => {
          s("COOK!", "go", 1000);
          if (!muted) audio.play("countdown.cook");
          onCook?.();
        });
        // MARKET OPEN lands right behind COOK! so the two read as one beat.
        if (witnessed && round.liveAt && now - round.liveAt > 900)
          once("open", () => s("MARKET OPEN", "go", 900));

        const endsAt = round.endsAt;
        if (endsAt) {
          const left = Math.ceil((endsAt - now) / 1000);
          if (!digitsOnly && left <= 60 && left > 55) once("final-minute", () => {
            s("FINAL MINUTE", "warn", 1000);
            if (!muted) audio.play("round.over");
          });
          if (!digitsOnly && left <= 30 && left > 27)
            once("final-30", () => s("30 SECONDS", "warn", 900));
          if (left >= 1 && left <= 10)
            once(`end-${left}`, () => {
              s(String(left), left <= 3 ? "bad" : "warn", 750, true);
              // The last five reuse the escalating countdown impacts; 10–6 tick lighter.
              if (!muted) audio.play(left <= 5 ? `countdown.${left}` : "ui.click");
            });
        }
      }

      // ---- the verdict
      if (witnessed && (round.state === "results" || round.state === "ended")) {
        if (round.graduated) once("verdict", () => {
          s("SERVED UP", "win", 1400);
          if (!muted) audio.play("round.graduated");
        });
        else if (round.endReason === "rug_detected" || round.endReason === "liquidity_removed")
          once("verdict", () => {
            s("RUGGED", "bad", 1400);
            if (!muted) audio.play("round.rug");
          });
        else once("verdict", () => {
          s("ROUND OVER", "warn", 1200);
          if (!muted) audio.play("round.over");
        });
      }
    };

    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [round.state, round.scheduledAt, round.queueOpensAt, round.queueClosesAt, round.liveAt, round.endsAt, round.graduated, round.endReason, onCook, muted, digitsOnly]);

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
export function UrgencyPulse({
  endsAt,
  active,
  nowOffset = 0,
}: {
  endsAt?: number;
  active: boolean;
  nowOffset?: number;
}) {
  const [left, setLeft] = useState(Infinity);
  useEffect(() => {
    if (!active || !endsAt) return;
    const t = setInterval(() => setLeft((endsAt - (Date.now() + nowOffset)) / 1000), 200);
    return () => clearInterval(t);
  }, [active, endsAt, nowOffset]);

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
