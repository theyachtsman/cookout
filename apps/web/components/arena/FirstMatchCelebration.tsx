"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Round } from "@cookout/shared";
import { api } from "../../lib/api";
import { audio } from "../../lib/audio";
import { useSession } from "../../lib/session";

/**
 * First-match celebration — when a player's very first match settles, don't
 * just dump them back to the lobby: mark the moment. Fires only when the
 * transition to "results" is WITNESSED live (same rule as RoundOverlays, so a
 * later page-load never replays it), only when the freshly-refreshed profile
 * says roundsPlayed === 1, and only once per account (localStorage). Waits a
 * beat so the SERVED UP / RUGGED verdict overlay gets its moment first.
 */

const VERDICT_DELAY_MS = 3200; // let the round verdict land before we speak
const doneKey = (address: string) => `cookout:first-match:${address.toLowerCase()}`;

interface NextMatch {
  id: string;
  /** ms timestamp the countdown targets; null = it's already filling. */
  startsAt: number | null;
}

export function FirstMatchCelebration({ round }: { round: Round }) {
  const { profile } = useSession();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [xpEarned, setXpEarned] = useState<number | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [next, setNext] = useState<NextMatch | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const prevState = useRef<Round["state"] | null>(null);
  const xpAtStart = useRef<number | null>(null);
  const justEnded = useRef(false);

  useEffect(() => setMounted(true), []);

  // Snapshot XP while the match is still running so we can show the delta.
  useEffect(() => {
    if (profile && round.state !== "results" && xpAtStart.current === null) {
      xpAtStart.current = profile.xp;
    }
  }, [profile, round.state]);

  // Witness the live transition into results.
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = round.state;
    if (round.state === "results" && prev && prev !== "results") justEnded.current = true;
  }, [round.state]);

  // Once the post-round profile refresh lands: if this was their FIRST match,
  // celebrate (after the verdict overlay has had its moment). The timer lives
  // in a ref so later profile refreshes can't cancel the pending reveal — it's
  // cleared only if they leave the page before it fires.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!justEnded.current || !profile || pending.current) return;
    if (profile.stats.roundsPlayed !== 1) return;
    if (localStorage.getItem(doneKey(profile.address))) return;
    localStorage.setItem(doneKey(profile.address), String(Date.now()));
    justEnded.current = false;

    if (xpAtStart.current !== null) setXpEarned(Math.max(0, profile.xp - xpAtStart.current));
    pending.current = setTimeout(() => {
      setOpen(true);
      audio.play("notify.achievement");
    }, VERDICT_DELAY_MS);
  }, [profile, round.state]);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  // Fetch rank + the next match once we're actually showing.
  useEffect(() => {
    if (!open || !profile) return;
    api<{ rows: { address: string }[] }>("/api/leaderboard?scope=alltime&metric=xp")
      .then((d) => {
        const idx = d.rows.findIndex(
          (r) => r.address.toLowerCase() === profile.address.toLowerCase(),
        );
        if (idx >= 0) setRank(idx + 1);
      })
      .catch(() => {});
    api<Round[]>("/api/calendar")
      .then((rounds) => {
        const upcoming = rounds.find(
          (r) =>
            r.id !== round.id &&
            (r.state === "scheduled" || r.state === "lobby" || r.state === "queue_open"),
        );
        if (!upcoming) return;
        const startsAt =
          upcoming.state === "scheduled"
            ? upcoming.scheduledAt
            : upcoming.state === "lobby"
              ? (upcoming.queueOpensAt ?? upcoming.scheduledAt)
              : null; // queue already open — it's filling right now
        setNext({ id: upcoming.id, startsAt });
      })
      .catch(() => {});
  }, [open, profile, round.id]);

  // Tick the countdown.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  if (!mounted || !open || !profile) return null;

  const unit = round.chain ? "ETH" : "pETH";
  const pnl = profile.stats.totalPnl ?? 0;
  const bestTrade = profile.stats.bestTradePnl ?? 0;
  const secsToNext =
    next?.startsAt != null ? Math.max(0, Math.ceil((next.startsAt - nowTick) / 1000)) : null;
  const mm = secsToNext !== null ? Math.floor(secsToNext / 60) : 0;
  const ss = secsToNext !== null ? secsToNext % 60 : 0;

  const runItBack = () => {
    setOpen(false);
    router.push(next ? `/round/${next.id}` : "/matches");
  };

  const rows: Array<[string, React.ReactNode]> = [
    ["Rounds Played", <span key="r" className="text-zinc-100">1</span>],
    [
      "Match PnL",
      <span key="p" className={pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
        {pnl >= 0 ? "+" : ""}
        {pnl.toFixed(3)} {unit}
      </span>,
    ],
  ];
  if (bestTrade > 0)
    rows.push([
      "Best Trade",
      <span key="b" className="text-emerald-400">
        +{bestTrade.toFixed(3)} {unit}
      </span>,
    ]);
  if (xpEarned !== null && xpEarned > 0)
    rows.push(["XP Earned", <span key="x" className="text-lime-300">+{xpEarned} XP</span>]);
  if (rank !== null)
    rows.push(["Current Rank", <span key="k" className="text-zinc-100">#{rank}</span>]);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div onClick={() => setOpen(false)} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-lime-400/40 bg-zinc-950 shadow-[0_0_60px_rgba(163,230,53,0.25)]">
        <div className="border-b border-zinc-800 bg-gradient-to-b from-lime-400/[0.12] to-transparent px-6 py-6 text-center">
          <div className="text-4xl">🔥</div>
          <h2 className="mt-2 text-xl font-black tracking-widest text-lime-300">
            FIRST MATCH COMPLETE
          </h2>
          <p className="mt-1 text-sm text-zinc-400">Welcome to The Cookout.</p>
        </div>

        <div className="px-6 py-4">
          <div className="divide-y divide-zinc-800/70">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between py-2 text-sm">
                <span className="text-zinc-500">{label}</span>
                <span className="font-mono font-bold">{value}</span>
              </div>
            ))}
          </div>

          {next && (
            <p className="mt-3 text-center text-xs text-zinc-500">
              {secsToNext !== null ? (
                <>
                  Next match starts in{" "}
                  <span className="font-mono font-bold text-zinc-200">
                    {mm}:{String(ss).padStart(2, "0")}
                  </span>
                </>
              ) : (
                <>The next match is filling right now.</>
              )}
            </p>
          )}

          <button
            onClick={runItBack}
            className="mt-4 w-full rounded-xl bg-lime-400 px-4 py-3 text-lg font-black text-zinc-950 shadow-lg shadow-lime-400/25 transition hover:bg-lime-300"
          >
            Run It Back →
          </button>
        </div>

        <button
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
    </div>,
    document.body,
  );
}
