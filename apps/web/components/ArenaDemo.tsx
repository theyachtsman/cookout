"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Candle, Trade } from "@cookout/shared";
import { ChartCanvas } from "./ChartCanvas";

/**
 * ArenaDemo — an auto-cycling, self-contained mockup of the live arena that
 * runs right on the landing page. It walks a visitor through the product with
 * fake-but-realistic data, reusing the exact look & feel of the real app —
 * chronologically, from creating a coin to splitting the jackpot:
 *
 *   1. Launchpad    — submit a token concept (metadata only)
 *   2. Upvote       — the community votes it onto the calendar
 *   3. Calendar     — queued lobbies + one live match
 *   4. Pre-Launch   — the batch-auction queue + the trenches chat
 *   5. Launch→Live  — settle, then the real chart rips on two-way action
 *   6. Leaderboard  — the weekly ranked board across every lobby
 *   7. Quests       — XP sources, levels, streaks, milestones, season pass
 *   8. Jackpot      — top weekly-XP earners split the pot
 *
 * Everything is simulated in the browser — no wallet, no server, no risk.
 */

const SCENES = [
  { key: "launchpad", label: "Make a Coin", blurb: "Name it, draw it, send it", dur: 7600 },
  { key: "upvote", label: "Community Upvote", blurb: "Vote coins into the Arena", dur: 7000 },
  { key: "calendar", label: "The Arena", blurb: "Queued lobbies + a live match", dur: 5200 },
  { key: "queue", label: "Pre-Launch Queue", blurb: "Place your buy before the open", dur: 8200 },
  { key: "launch", label: "Launch → Live", blurb: "Settle, then the chart rips", dur: 9800 },
  { key: "leaderboard", label: "The Leaderboard", blurb: "Where you rank this week", dur: 7600 },
  { key: "quests", label: "Quests · XP · Levels", blurb: "Earn XP, climb, unlock", dur: 9200 },
  { key: "jackpot", label: "The Weekly Jackpot", blurb: "Top XP earners split real ETH", dur: 7200 },
] as const;

/** Look up a scene duration by key (robust to reordering). */
const durOf = (k: string) => SCENES.find((s) => s.key === k)!.dur;

/** The visitor's wallet in the playable Launch→Live scene. */
const YOU_ADDR = "0xc0ffee00000000000000000000000000000000c0";
const SUPPLY = 2_000_000;
const ETH_USD = 1920;
const START_CASH = 10; // pETH to play with

/**
 * Satisfying click blips, synthesized with Web Audio — no audio assets, and it
 * only ever fires from a real button press (never autoplay).
 */
function useSfx(muted: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  return useCallback(
    (kind: "buy" | "sell" | "deny") => {
      if (muted) return;
      try {
        const AC =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ctxRef.current ??= new AC();
        const ctx = ctxRef.current;
        void ctx.resume();
        const t0 = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = kind === "deny" ? "square" : "triangle";
        const [f0, f1] =
          kind === "buy" ? [523, 940] : kind === "sell" ? [440, 196] : [150, 120];
        osc.frequency.setValueAtTime(f0, t0);
        osc.frequency.exponentialRampToValueAtTime(f1, t0 + 0.085);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(kind === "deny" ? 0.05 : 0.14, t0 + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.2);
      } catch {
        /* audio unavailable — stay silent */
      }
    },
    [muted],
  );
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

export function ArenaDemo() {
  const [scene, setScene] = useState(0);
  const [progress, setProgress] = useState(0);
  const reduce = useReducedMotion();

  const pausedRef = useRef(false);
  const progressRef = useRef(0);
  const startRef = useRef(0);

  // deep-link: #1..#4 jumps straight to a chapter (nice for sharing a demo)
  useEffect(() => {
    const n = Number(window.location.hash.slice(1));
    if (n >= 1 && n <= SCENES.length) setScene(n - 1);
  }, []);

  // reset the clock whenever the active scene changes
  useEffect(() => {
    progressRef.current = 0;
    setProgress(0);
    startRef.current = performance.now();
  }, [scene]);

  // auto-advance loop (skipped entirely under reduced-motion)
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (pausedRef.current) {
        startRef.current = t - progressRef.current * SCENES[scene].dur;
        return;
      }
      const p = Math.min(1, (t - startRef.current) / SCENES[scene].dur);
      progressRef.current = p;
      setProgress(p);
      if (p >= 1) setScene((s) => (s + 1) % SCENES.length);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [scene, reduce]);

  const key = SCENES[scene].key;

  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
      <div className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">
          Play one full match
        </div>
        <h2 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
          Here&apos;s the whole thing.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-zinc-300">
          Somebody&apos;s coin gets voted in, the room queues up, the chart goes live, and one
          person walks away with it. Click through the tabs. The buy and sell buttons in the live
          match actually work.
        </p>
      </div>

      {/* scene tabs */}
      <div className="mt-8 flex flex-wrap items-stretch justify-center gap-2">
        {SCENES.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setScene(i)}
            className={`group relative overflow-hidden rounded-xl border px-3 py-1.5 text-left transition sm:px-4 sm:py-2 ${
              i === scene
                ? "border-lime-400/70 bg-lime-400/10"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`font-mono text-xs ${i === scene ? "text-lime-300" : "text-zinc-500"}`}
              >
                0{i + 1}
              </span>
              <span className={`text-xs font-black sm:text-sm ${i === scene ? "text-zinc-50" : "text-zinc-300"}`}>
                {s.label}
              </span>
            </div>
            <div className="mt-0.5 hidden text-[11px] text-zinc-500 sm:block">{s.blurb}</div>
            {i === scene && !reduce && (
              <div
                className="absolute inset-x-0 bottom-0 h-0.5 bg-lime-400"
                style={{ width: `${progress * 100}%` }}
              />
            )}
          </button>
        ))}
      </div>

      {/* device frame */}
      <div
        onMouseEnter={() => (pausedRef.current = true)}
        onMouseLeave={() => (pausedRef.current = false)}
        className="mt-6 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60"
      >
        {/* app chrome */}
        <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/90 px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-black">
              <span className="text-lime-400">THE</span>{" "}
              <span className="text-zinc-100">COOKOUT</span>
            </span>
            <span className="hidden rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 sm:inline">
              open beta
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
            <span className="hidden sm:inline">Arena</span>
            <span className="hidden sm:inline">Board</span>
            <span className="hidden text-amber-400/80 sm:inline">Jackpot</span>
            <span className="rounded-lg bg-lime-400 px-2.5 py-1 text-[11px] font-black text-zinc-950">
              0xC0…ok
            </span>
          </div>
        </div>

        {/* scene body — taller on phones since side-columns stack vertically */}
        <div className="relative h-[40rem] overflow-hidden bg-zinc-950 p-3 sm:h-[42rem] sm:p-4">
          {key === "launchpad" && <LaunchpadScene />}
          {key === "upvote" && <UpvoteScene />}
          {key === "calendar" && <CalendarScene />}
          {key === "queue" && <QueueScene />}
          {key === "launch" && <LaunchScene />}
          {key === "leaderboard" && <LeaderboardScene />}
          {key === "quests" && <QuestScene />}
          {key === "jackpot" && <JackpotScene />}
          {/* sample-data watermark */}
          <div className="pointer-events-none absolute bottom-2 right-3 font-mono text-[10px] uppercase tracking-widest text-zinc-700">
            simulated · sample data
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-zinc-600">
        Hover to pause · click a chapter to jump · everything above is paper-money, zero risk.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 *  small shared bits
 * ------------------------------------------------------------------ */

const TRADERS = [
  ["degenharu", "#f59e0b"],
  ["serialtop", "#a3e635"],
  ["ovenmitt", "#38bdf8"],
  ["paperKing", "#f472b6"],
  ["rugpull_rick", "#ef4444"],
  ["moonboy42", "#22c55e"],
  ["basedchad", "#c084fc"],
  ["exitliquidity", "#fb923c"],
  ["gwei_guy", "#2dd4bf"],
  ["sniperSue", "#e879f9"],
] as const;

function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-zinc-950"
      style={{ background: color }}
    >
      {name.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase()}
    </span>
  );
}

/** count-up display that eases toward a target as `t` (0..1) advances */
function lerp(from: number, to: number, t: number) {
  return from + (to - from) * Math.min(1, Math.max(0, t));
}

/** shared scene progress: returns 0..1 over `ms`, plus a tick counter */
function useSceneClock(ms: number) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      setT(Math.min(1, (now - start) / ms));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ms]);
  return t;
}

/* ------------------------------------------------------------------ *
 *  SCENE 1 — Match Calendar
 * ------------------------------------------------------------------ */

function CalendarScene() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const fmt = (s: number) => {
    const v = Math.max(0, s - tick);
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
  };

  return (
    <div className="flex h-full animate-[fadein_.4s_ease] flex-col">
      <div className="mb-3">
        <h3 className="text-lg font-black">The Arena</h3>
        <p className="text-xs text-zinc-500">
          A fresh community-made token every few minutes: fair open, pro-rata fills, auditable
          settlement.
        </p>
      </div>
      <div className="grid flex-1 gap-3 sm:grid-cols-2">
        <CalCard
          emoji="🐷"
          grad="from-pink-500/30 to-orange-500/20"
          name="PORK BELLY"
          symbol="PORK"
          theme="BBQ szn is upon us"
          badge="LIVE"
          badgeCls="animate-pulse bg-emerald-500/25 text-emerald-300"
          sub={<span className="text-emerald-400">Trading now · +214%</span>}
          tier="degen"
          highlight
        />
        <CalCard
          emoji="🔥"
          grad="from-lime-500/25 to-emerald-500/20"
          name="???"
          symbol=""
          theme="Theme: flame-grilled"
          badge="Queue open · get in"
          badgeCls="bg-lime-400/15 text-lime-300"
          sub={<>Queue closes in <b className="font-mono text-zinc-200">{fmt(38)}</b></>}
          tier="prime"
        />
        <CalCard
          emoji="🧊"
          grad="from-sky-500/25 to-indigo-500/20"
          name="???"
          symbol=""
          theme="Theme: cold storage"
          badge="Lobby open"
          badgeCls="bg-zinc-800 text-zinc-300"
          sub={<>Queue opens in <b className="font-mono text-zinc-200">{fmt(74)}</b></>}
          tier="mid"
        />
        <CalCard
          emoji="❓"
          grad="from-zinc-700/30 to-zinc-800/20"
          name="???"
          symbol=""
          theme="Theme: mystery drop"
          badge="Starting soon"
          badgeCls="bg-zinc-800 text-zinc-400"
          sub={<>Lobby opens in <b className="font-mono text-zinc-200">{fmt(126)}</b></>}
          tier="degen"
        />
      </div>
      <div className="mt-3">
        <div className="mb-1.5 text-[11px] font-bold text-zinc-500">Recent results</div>
        <div className="flex flex-wrap gap-2">
          <ResultChip emoji="🍽️" name="WAGYU" cls="border-lime-400/40 text-lime-300" tag="served up" />
          <ResultChip emoji="🔥" name="RUGRAT" cls="border-red-900/60 text-red-300" tag="burnt" />
          <ResultChip emoji="🍽️" name="BRISKET" cls="border-lime-400/40 text-lime-300" tag="served up" />
          <ResultChip emoji="🪙" name="CHUCK" cls="border-zinc-700 text-zinc-400" tag="closed" />
        </div>
      </div>
    </div>
  );
}

function CalCard({
  emoji,
  grad,
  name,
  symbol,
  theme,
  badge,
  badgeCls,
  sub,
  tier,
  highlight,
}: {
  emoji: string;
  grad: string;
  name: string;
  symbol: string;
  theme: string;
  badge: string;
  badgeCls: string;
  sub: React.ReactNode;
  tier: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border ${
        highlight ? "border-lime-400/60" : "border-zinc-800"
      }`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${grad} opacity-60`} />
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/80 via-zinc-950/60 to-zinc-950/90" />
      <div className="relative p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900/70 text-2xl">
              {emoji}
            </div>
            <div>
              <div className="text-lg font-black">
                {name} {symbol && <span className="text-zinc-400">${symbol}</span>}
              </div>
              <div className="text-xs text-zinc-400">{theme}</div>
            </div>
          </div>
          <span className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold ${badgeCls}`}>{badge}</span>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-zinc-400">
            {sub}
            <span className="ml-2 rounded bg-zinc-800/90 px-1.5 py-0.5 text-[10px] uppercase">{tier}</span>
          </div>
          <span className="rounded-lg bg-lime-400 px-3 py-1.5 text-xs font-black text-zinc-950">
            Pull Up
          </span>
        </div>
      </div>
    </div>
  );
}

function ResultChip({ emoji, name, cls, tag }: { emoji: string; name: string; cls: string; tag: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border bg-zinc-950/50 px-2.5 py-1.5 ${cls}`}>
      <span className="text-base">{emoji}</span>
      <span className="text-xs font-bold text-zinc-200">${name}</span>
      <span className="text-[10px]">{tag}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  SCENE 2 — Pre-Launch Queue (batch auction)
 * ------------------------------------------------------------------ */

interface Bid {
  name: string;
  color: string;
  eth: number;
  you?: boolean;
}

const CHAT_LINES = [
  "aping in, lfg 🚀", "who's the dev?", "this one bonds ez", "liquidity thin ser 👀",
  "paper hands ngmi", "i'm all in", "wen moon", "🌕🌕🌕", "chart about to rip",
  "comfy hold", "zoom out", "2x from here easy", "don't fumble this", "full send",
  "who selling? i'm buying", "this is the one", "top blast incoming", "dev based",
  "first 🥇", "let it cook 🔥", "diamond hands only 💎", "send it higher",
];

function QueueScene() {
  const t = useSceneClock(durOf("queue"));
  const [bids, setBids] = useState<Bid[]>([
    { name: TRADERS[2][0], color: TRADERS[2][1], eth: 0.25 },
    { name: TRADERS[0][0], color: TRADERS[0][1], eth: 0.5 },
  ]);
  const [moon, setMoon] = useState(31);
  const [rug, setRug] = useState(12);
  const [youBid, setYouBid] = useState(false);

  // stream new pre-positions in
  useEffect(() => {
    let i = 0;
    const iv = setInterval(() => {
      const [name, color] = TRADERS[(i * 3 + 4) % TRADERS.length];
      const eth = [0.1, 0.25, 0.5, 0.05, 0.8, 0.15][i % 6];
      setBids((b) => [...b.slice(-7), { name, color, eth }]);
      if (i % 2 === 0) setMoon((m) => m + 1);
      else setRug((r) => r + (i % 3 === 0 ? 1 : 0));
      i++;
    }, 720);
    return () => clearInterval(iv);
  }, []);

  // "you" place a market buy partway through
  useEffect(() => {
    const to = setTimeout(() => {
      setYouBid(true);
      setBids((b) => [...b.slice(-7), { name: "you", color: "#a3e635", eth: 0.1, you: true }]);
      setMoon((m) => m + 1);
    }, 2600);
    return () => clearTimeout(to);
  }, []);

  const players = 18 + bids.length;
  const committed = 4.2 + bids.reduce((s, b) => s + b.eth, 0);
  const closeIn = Math.max(0, 42 - Math.floor(t * 42));

  return (
    <div className="flex h-full animate-[fadein_.4s_ease] flex-col gap-3">
      {/* phase banner */}
      <div className="rounded-xl border border-lime-400/60 bg-lime-400/10 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-base font-black tracking-wide text-lime-300">QUEUE OPEN · PULL UP</span>
          <span className="hidden text-xs text-zinc-400 sm:inline">
            Everyone settles at ONE clearing price, and order and speed don&apos;t matter
          </span>
          <span className="ml-auto font-mono text-xl font-black tabular-nums text-zinc-100">
            0:{String(closeIn).padStart(2, "0")}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded bg-zinc-800">
          <div className="h-full bg-lime-400/70" style={{ width: `${t * 100}%` }} />
        </div>
      </div>

      <div className="grid flex-1 gap-3 md:grid-cols-3">
        {/* queue + live pre-positions */}
        <div className="flex min-h-0 flex-col rounded-xl border border-zinc-800 p-4 md:col-span-2">
          <h4 className="text-sm font-black">Position Queue · open</h4>
          <p className="mb-3 text-[11px] text-zinc-500">
            Buy intents queue until close, then settle at one uniform price. Oversubscribed? Pro-rata
            fills, and speed buys nothing.
          </p>
          {/* the buy row */}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <div className="mb-1 text-[10px] text-zinc-500">Amount (pETH)</div>
              <div className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm">
                0.10
              </div>
            </div>
            <div>
              <div className="mb-1 text-[10px] text-zinc-500">Max price</div>
              <div className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-sm text-zinc-500">
                market
              </div>
            </div>
            <button
              className={`rounded-lg px-5 py-2 text-sm font-black text-zinc-950 transition ${
                youBid ? "bg-lime-400/40" : "bg-lime-400 shadow-lg shadow-lime-400/30"
              } ${!youBid ? "animate-pulse" : ""}`}
            >
              {youBid ? "✓ In queue" : "Pull Up"}
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-2 text-[11px]">
            <span className="font-bold text-zinc-300">Live pre-positions</span>
            <span className="font-mono text-zinc-500">
              {bids.length} bids · {committed.toFixed(2)} pETH
            </span>
          </div>
          <div className="mt-1 flex min-h-0 flex-1 flex-col-reverse gap-1 overflow-hidden">
            {bids
              .slice()
              .reverse()
              .map((b, i) => (
                <div
                  key={`${b.name}-${bids.length}-${i}`}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
                    b.you ? "flash bg-lime-400/10 ring-1 ring-lime-400/40" : "bg-zinc-900"
                  } ${i === 0 ? "killfeed-item" : ""}`}
                >
                  <Avatar name={b.name} color={b.color} />
                  <span className="truncate text-zinc-200">
                    {b.you ? "you" : b.name}
                  </span>
                  <span className="ml-auto font-mono text-lime-300">{b.eth.toFixed(2)} pETH</span>
                </div>
              ))}
          </div>
        </div>

        {/* lobby + moon/rug + tokenomics — secondary, hidden on phones */}
        <div className="hidden flex-col gap-3 md:flex">
          <div className="rounded-xl border border-zinc-800 p-3">
            <h4 className="mb-2 text-xs font-bold text-zinc-300">Lobby</h4>
            <dl className="space-y-1 text-xs">
              <Row k="Players in queue" v={String(players)} />
              <Row k="Committed" v={`${committed.toFixed(2)} pETH`} />
              <Row k="Auction cap" v="25 pETH" />
            </dl>
          </div>
          <div className="rounded-xl border border-zinc-800 p-3">
            <h4 className="mb-1.5 text-xs font-bold text-zinc-300">Moon or Rug?</h4>
            <p className="mb-2 text-[10px] text-zinc-500">Call it before the open. Correct calls earn XP.</p>
            <div className="flex gap-2">
              <div
                className={`flex-1 rounded px-2 py-1.5 text-center text-xs font-bold text-emerald-300 ${
                  youBid ? "bg-emerald-600/50 ring-1 ring-emerald-400" : "bg-emerald-600/20"
                }`}
              >
                🌕 Moon ({moon})
              </div>
              <div className="flex-1 rounded bg-red-600/20 px-2 py-1.5 text-center text-xs font-bold text-red-300">
                🧨 Rug ({rug})
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 p-3">
            <h4 className="mb-2 text-xs font-bold text-zinc-300">Tokenomics</h4>
            <dl className="space-y-1 text-xs">
              <Row k="Total supply" v="1,000,000,000" />
              <Row k="Trade fee" v="1%" />
              <Row k="Serves up at" v="$40k mcap" />
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="font-mono text-zinc-200">{v}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  SCENE 3 — Launch → Live (the chart rips)
 * ------------------------------------------------------------------ */

interface FeedItem {
  id: number;
  name: string;
  color: string;
  side: "buy" | "sell" | "whale";
  eth: number;
}

function LaunchScene() {
  const t = useSceneClock(durOf("launch"));
  const settling = t < 0.13;
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const market = useDemoMarket();

  // your play-money wallet — the demo is fully tradeable
  const [cash, setCash] = useState(START_CASH);
  const [tokens, setTokens] = useState(0);
  const [basis, setBasis] = useState(0);
  const [realized, setRealized] = useState(0);
  const [amount, setAmount] = useState(0.1);
  const [muted, setMuted] = useState(false);
  const sfx = useSfx(muted);
  const feedId = useRef(10_000);

  useEffect(() => {
    let id = 0;
    const iv = setInterval(() => {
      const [name, color] = TRADERS[id % TRADERS.length];
      const roll = Math.random();
      const side = roll > 0.82 ? "whale" : roll > 0.28 ? "buy" : "sell";
      const eth = side === "whale" ? 0.6 + Math.random() : 0.03 + Math.random() * 0.25;
      setFeed((f) => [...f.slice(-7), { id: id++, name, color, side, eth }]);
    }, 620);
    return () => clearInterval(iv);
  }, []);

  // the trenches — live chat under the trade buttons
  const [chat, setChat] = useState<Array<{ id: number; name: string; color: string; text: string }>>([
    { id: -2, name: TRADERS[1][0], color: TRADERS[1][1], text: "sent it, we cooking now 🔥" },
    { id: -1, name: TRADERS[4][0], color: TRADERS[4][1], text: "diamond hands only 💎" },
  ]);
  useEffect(() => {
    let i = 0;
    const iv = setInterval(() => {
      const [name, color] = TRADERS[(i * 5 + 1) % TRADERS.length];
      setChat((c) => [...c.slice(-9), { id: i, name, color, text: CHAT_LINES[(i * 7 + 3) % CHAT_LINES.length]! }]);
      i++;
    }, 1150);
    return () => clearInterval(iv);
  }, []);

  const addFeed = (side: FeedItem["side"], eth: number) =>
    setFeed((f) => [
      ...f.slice(-7),
      { id: feedId.current++, name: "you", color: "#a3e635", side, eth },
    ]);

  const buy = (eth: number) => {
    if (settling || eth > cash + 1e-9) {
      sfx("deny");
      return;
    }
    const px = market.price.current;
    setCash((c) => c - eth);
    setTokens((tk) => tk + eth / px);
    setBasis((b) => b + eth);
    market.push("buy", eth);
    sfx("buy");
    addFeed("buy", eth);
  };

  const sell = (pct: number) => {
    if (settling || tokens <= 1e-9) {
      sfx("deny");
      return;
    }
    const px = market.price.current;
    const tokensIn = tokens * pct;
    const out = tokensIn * px;
    setCash((c) => c + out);
    setTokens((tk) => tk - tokensIn);
    setRealized((r) => r + (out - basis * pct));
    setBasis((b) => b - b * pct);
    market.push("sell", out);
    sfx("sell");
    addFeed("sell", out);
  };

  // live counters, driven by the real demo market
  const px = market.price.current || 1.6e-6;
  const mcap = (px * SUPPLY * ETH_USD) / 1000; // $k
  const vol = market.volume.current;
  const holders = Math.round(lerp(41, 188, t)) + (tokens > 0 ? 1 : 0);
  const bagEth = tokens * px;
  const pnl = realized + (bagEth - basis); // pETH
  const age = Math.round(lerp(3, 96, t));
  const gradPct = Math.min(100, (mcap / 40) * 100);

  return (
    <div className="flex h-full animate-[fadein_.4s_ease] flex-col gap-3">
      {/* phase banner: settling then live */}
      {settling ? (
        <div className="flex items-center gap-3 rounded-xl border border-purple-500/50 bg-purple-500/10 px-4 py-2.5">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
          <span className="text-base font-black tracking-wide text-purple-200">SETTLING</span>
          <span className="text-xs text-zinc-400">Computing the uniform clearing price…</span>
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-500/60 bg-emerald-500/10 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="animate-pulse text-base font-black tracking-wide text-emerald-300">
              ● LIVE TRADING
            </span>
            <span className="hidden text-xs text-zinc-400 sm:inline">
              👉 It&apos;s playable. You have {START_CASH} pETH. Hit Buy or Sell and watch the chart answer.
            </span>
            <span className="ml-auto font-mono text-lg font-black tabular-nums text-zinc-100">
              1:{String(Math.max(0, 40 - age)).padStart(2, "0")}
            </span>
          </div>
        </div>
      )}

      {/* ticker stat bar */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-lg">
            🐷
          </div>
          <span className="font-black">PORK BELLY</span>
          <span className="text-xs text-zinc-500">$PORK</span>
        </div>
        {!settling && (
          <span className="animate-pulse rounded bg-orange-500/20 px-2 py-0.5 text-[10px] font-black text-orange-300">
            🔥 Cooking
          </span>
        )}
        <Stat label="Market Cap" value={`$${mcap.toFixed(1)}k`} />
        <Stat label="Volume" value={`${vol.toFixed(1)} pETH`} />
        <Stat label="Holders" value={String(holders)} />
        <Stat label="Age" value={`${age}s`} />
        <Stat
          label="Your PnL"
          value={`${pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(3)} pETH`}
          tone={pnl >= 0 ? "up" : "down"}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_240px]">
        <div className="flex min-h-0 flex-col gap-3">
          {/* bonding progress */}
          <div className="rounded-xl border border-zinc-800 px-3 py-2">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="font-bold text-zinc-300">🍽️ Bonding progress</span>
              <span className="font-mono text-zinc-400">
                ${mcap.toFixed(1)}k / $40k · {gradPct.toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
              <div className="h-full bg-lime-400" style={{ width: `${gradPct}%` }} />
            </div>
          </div>
          {/* the chart — the exact product renderer, on the live demo market */}
          <div className="min-h-[11rem] flex-1">
            <ChartCanvas
              candles={market.candles.current}
              trades={market.trades.current}
              livePrice={market.price.current}
              openPrice={market.open.current}
              supply={SUPPLY}
              bigTradeEth={0.5}
              cooking
              windowSec={40}
              fill
              highlightAddress={YOU_ADDR}
              resolveTag={demoResolveTag}
              className="h-full w-full rounded-xl border border-zinc-800 bg-zinc-950"
            />
          </div>
          {/* trade panel — fully playable: your presses move the chart */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 p-2.5">
            <button
              title="Click to change your buy size"
              onClick={() => setAmount((a) => ({ 0.1: 0.25, 0.25: 0.5, 0.5: 1, 1: 0.05, 0.05: 0.1 })[a] ?? 0.1)}
              className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-center font-mono text-xs hover:border-lime-400/60"
            >
              {amount.toFixed(2)}
            </button>
            <button
              onClick={() => buy(amount)}
              disabled={settling}
              className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-black text-white transition hover:bg-emerald-500 active:scale-95 disabled:opacity-40"
            >
              Buy
            </button>
            {[0.02, 0.05, 0.1].map((v) => (
              <button
                key={v}
                onClick={() => buy(v)}
                disabled={settling}
                className="rounded bg-emerald-600/20 px-2 py-1.5 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-600/40 active:scale-95 disabled:opacity-40"
              >
                +{v}
              </button>
            ))}
            <div className="mx-1 h-6 w-px bg-zinc-800" />
            <button
              onClick={() => sell(0.5)}
              disabled={settling || tokens <= 0}
              className="rounded bg-red-600/20 px-2 py-1.5 text-[11px] font-bold text-red-300 transition hover:bg-red-600/40 active:scale-95 disabled:opacity-40"
            >
              Sell 50%
            </button>
            <button
              onClick={() => sell(1)}
              disabled={settling || tokens <= 0}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-black text-white transition hover:bg-red-500 active:scale-95 disabled:opacity-40"
            >
              Sell All
            </button>
            <button
              onClick={() => setMuted((m) => !m)}
              title={muted ? "Unmute" : "Mute"}
              className="ml-auto rounded px-1.5 py-1 text-xs text-zinc-500 hover:text-zinc-200"
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
          {/* the trenches — live chat under the buy/sell buttons */}
          <div className="flex h-24 shrink-0 flex-col rounded-xl border border-zinc-800 p-2.5">
            <div className="mb-1 flex items-center gap-2 text-[11px]">
              <span className="font-bold text-zinc-300">💬 Trenches</span>
              <span className="text-zinc-600">live chat</span>
              <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {holders} online
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col-reverse gap-0.5 overflow-hidden">
              {chat
                .slice()
                .reverse()
                .map((m, i) => (
                  <div
                    key={m.id}
                    className={`flex items-baseline gap-1.5 rounded px-1.5 py-0.5 text-[11px] ${
                      i === 0 ? "killfeed-item" : ""
                    }`}
                  >
                    <span className="shrink-0 font-bold" style={{ color: m.color }}>
                      {m.name}
                    </span>
                    <span className="truncate text-zinc-300">{m.text}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* side: your bag + kill feed — hidden on phones, chart+trades carry it */}
        <div className="hidden min-h-0 flex-col gap-3 lg:flex">
          <div className="neon rounded-xl border border-lime-400/40 bg-zinc-900/60 p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h4 className="text-xs font-black tracking-wide text-lime-300">💰 YOUR BAG</h4>
              <span className="text-[9px] uppercase tracking-wide text-zinc-600">play money</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-[9px] uppercase text-zinc-500">$PORK held</div>
                <div className="font-mono font-bold">{fmtTokens(tokens)}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-zinc-500">Bag value</div>
                <div className="font-mono font-bold">${(bagEth * ETH_USD).toFixed(0)}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-zinc-500">Round PnL</div>
                <div className={`font-mono font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {pnl >= 0 ? "+" : "−"}${Math.abs(pnl * ETH_USD).toFixed(0)}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-zinc-500">Cash left</div>
                <div className="font-mono font-bold">{cash.toFixed(2)}</div>
              </div>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-800 p-3">
            <h4 className="mb-2 text-xs font-bold text-zinc-300">Kill feed</h4>
            <div className="flex min-h-0 flex-1 flex-col-reverse gap-1 overflow-hidden">
              {feed
                .slice()
                .reverse()
                .map((f, i) => (
                  <div
                    key={f.id}
                    className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px] ${
                      i === 0 ? "killfeed-item" : ""
                    } ${f.side === "whale" ? "bg-amber-500/10" : "bg-zinc-900"}`}
                  >
                    <Avatar name={f.name} color={f.color} />
                    <span className="truncate text-zinc-300">
                      {f.side === "whale" ? "🐳" : f.side === "buy" ? "🟢" : "🔴"} {f.name}
                    </span>
                    <span
                      className={`ml-auto font-mono ${
                        f.side === "sell" ? "text-red-400" : "text-emerald-400"
                      }`}
                    >
                      {f.side === "sell" ? "-" : "+"}
                      {f.eth.toFixed(2)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={`font-mono text-sm font-bold ${
          tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-zinc-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** Compact token count: 1.9M / 12.4K / 340 */
function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

const DEMO_TRADERS = [
  "Grillmaster", "DiamondDan", "ape_ceo", "PaperHandz", "MoonBoi", "SaltBae",
  "0xWhale", "ByteBurner", "TapeReader", "degen_kate", "chefsluck", "rug_doc",
];
function demoResolveTag(address: string, tag: { name: string }) {
  if (address === YOU_ADDR) {
    tag.name = "you";
    return;
  }
  let h = 0;
  for (let i = 0; i < address.length; i++) h = (h * 31 + address.charCodeAt(i)) >>> 0;
  tag.name = DEMO_TRADERS[h % DEMO_TRADERS.length]!;
}
function randAddr() {
  let s = "0x";
  for (let i = 0; i < 40; i++) s += "0123456789abcdef"[(Math.random() * 16) | 0];
  return s;
}

/**
 * The exact product chart (ChartCanvas), driven by a simulated round with
 * realistic two-way buy/sell action — pre-seeds a full window of history, then
 * streams new 1-second candles and pops big-trade bubbles, just like the app.
 */
/**
 * The playable demo market. Owns the candles/trades/price simulation and
 * exposes push() so the visitor's own Buy/Sell presses move the same chart the
 * bots are trading — buys lift the price, sells drop it.
 */
function useDemoMarket() {
  const [, force] = useState(0);
  const candles = useRef<Candle[]>([]);
  const trades = useRef<Array<Trade & { seenAt?: number }>>([]);
  const price = useRef(0);
  const open = useRef(0);
  const tSec = useRef(0);
  const id = useRef(0);
  const popTarget = useRef(0);
  const mountMs = useRef(0);
  const lastBubble = useRef(0);
  const volume = useRef(0);

  // Sit flat at the clearing price (the coin waiting at the open) filling the
  // window, then blast off live the instant the scene loads — the rightmost
  // candle rips up to the settlement price and continuous trading takes over.
  useEffect(() => {
    const N = 33; // flat base candles — fills the window so it's well-spaced
    const nowSec = Math.floor(Date.now() / 1000);
    const start = nowSec - N;
    const clearing = 1.6e-6; // ≈ $6k opening market cap at 2M supply
    const seed: Candle[] = [];
    for (let i = 0; i <= N; i++) {
      const o = clearing * (1 + (Math.random() - 0.5) * 0.012);
      const c = clearing * (1 + (Math.random() - 0.5) * 0.012);
      seed.push({ t: start + i, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 0 });
    }
    candles.current = seed;
    open.current = clearing; // dashed "open" reference at the clearing price
    price.current = clearing;
    tSec.current = nowSec;
    popTarget.current = clearing * (2.3 + Math.random() * 0.5); // where the blast peaks
    mountMs.current = performance.now();
    lastBubble.current = 0;
    volume.current = 0;
    force((x) => x + 1);
  }, []);

  // Close a candle every second at the current live price.
  useEffect(() => {
    const iv = setInterval(() => {
      const arr = candles.current;
      if (!arr.length) return;
      const o = arr[arr.length - 1]!.c;
      const c = price.current;
      const wick = Math.abs(c - o) * 0.5 + o * 0.004;
      tSec.current += 1;
      arr.push({ t: tSec.current, o, h: Math.max(o, c) + Math.random() * wick, l: Math.min(o, c) - Math.random() * wick, c, v: 0 });
      if (arr.length > 120) arr.shift();
      force((x) => x + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Blast off for the first ~1.4s, then a trade-driven market: buys push the
  // price up, sells push it down (so candles and bubbles always agree), and
  // big-trade bubbles are rate-limited so they never pile up.
  useEffect(() => {
    const iv = setInterval(() => {
      const arr = candles.current;
      if (!arr.length) return;
      const now = Date.now();
      const blasting = performance.now() - mountMs.current < 1400;
      let px = price.current;
      if (blasting) px += (popTarget.current - px) * 0.16; // the launch rip
      else px *= 1 + (Math.random() - 0.5) * 0.003;

      const n = Math.random() < 0.5 ? 1 : Math.random() < 0.85 ? 2 : 0;
      for (let k = 0; k < n; k++) {
        const buy = blasting ? Math.random() > 0.12 : Math.random() > 0.47;
        const eth = Math.random() > 0.9 ? 0.5 + Math.random() * 1.1 : 0.02 + Math.random() * 0.22;
        if (!blasting) px = Math.max(px * 0.7, px * (1 + (buy ? 1 : -1) * eth * 0.014));
        // rate-limit bubbles: a big trade pops one only if none has for ~2.2s
        const bubble = eth >= 0.5 && now - lastBubble.current > 2200;
        if (bubble) lastBubble.current = now;
        const isCreator = bubble && Math.random() > 0.8;
        const t: Trade & { seenAt?: number } = {
          id: String(id.current++),
          roundId: "demo",
          userAddress: randAddr(),
          side: buy ? "buy" : "sell",
          ethAmount: eth,
          tokenAmount: 0,
          price: px,
          fee: 0,
          at: now,
          isCreator,
        };
        if (bubble) t.seenAt = now;
        trades.current.push(t);
        volume.current += eth;
      }
      price.current = px;
      trades.current = trades.current.filter((t) => t.at > now - 6000);
      force((x) => x + 1);
    }, 150);
    return () => clearInterval(iv);
  }, []);

  /** The visitor's own trade — hits harder than the bots so the chart visibly
   *  answers every press, and always lands a tagged bubble on the tape. */
  const push = useCallback((side: "buy" | "sell", eth: number) => {
    const now = Date.now();
    const px = Math.max(
      price.current * 0.4,
      price.current * (1 + (side === "buy" ? 1 : -1) * eth * 0.09),
    );
    price.current = px;
    volume.current += eth;
    lastBubble.current = now;
    trades.current.push({
      id: String(id.current++),
      roundId: "demo",
      userAddress: YOU_ADDR,
      side,
      ethAmount: eth,
      tokenAmount: 0,
      price: px,
      fee: 0,
      at: now,
      isCreator: false,
      seenAt: now,
    } as Trade & { seenAt?: number });
    force((x) => x + 1);
    return px;
  }, []);

  return { candles, trades, price, open, volume, push };
}

/* ------------------------------------------------------------------ *
 *  SCENE 6 — The Leaderboard  (mirrors /leaderboard)
 * ------------------------------------------------------------------ */

function LeaderboardScene() {
  const t = useSceneClock(durOf("leaderboard"));
  // Your live PnL ticks up as rounds settle, nudging you up a rank mid-scene.
  const youPnl = lerp(19.2, 24.6, Math.min(1, t * 1.25));
  const climbed = t > 0.62;
  const podium = [
    ["🥈", "DiamondDan", "+42.1"],
    ["🥇", "Grillmaster", "+61.8"],
    ["🥉", "0xWhale", "+33.5"],
  ] as const;
  // rank, trader, weekly PnL (pETH), rounds, win%
  const rows = [
    ["4", "ape_ceo", "+28.0", "31", "58%"],
    ["5", "TapeReader", "+21.4", "44", "61%"],
    ["6", "degen_kate", "+18.9", "27", "52%"],
    ["7", "solsurfer", "+15.2", "38", "49%"],
    ["8", "notfinancial", "+12.7", "22", "55%"],
  ] as const;

  return (
    <div className="flex h-full animate-[fadein_.4s_ease] flex-col gap-3">
      {/* header + board tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-black text-zinc-200">🏆 Leaderboard</div>
        <div className="flex gap-1 text-[10px] font-bold">
          <span className="rounded-full bg-lime-400 px-2.5 py-1 text-zinc-950">This Week · PnL</span>
          <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-zinc-400">Season · XP</span>
          <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-zinc-400">All-Time</span>
        </div>
      </div>

      {/* podium */}
      <div className="grid grid-cols-3 items-end gap-2">
        {podium.map(([m, name, v], i) => {
          const rank = i === 1 ? 0 : i === 0 ? 1 : 2;
          const style = [
            "border-amber-400/70 from-amber-500/20 pt-6",
            "border-zinc-400/50 from-zinc-400/15 pt-4",
            "border-orange-700/60 from-orange-700/15 pt-4",
          ][rank];
          return (
            <div key={name} className={`rounded-2xl border bg-gradient-to-b to-transparent p-3 text-center ${style}`}>
              <div className="text-3xl">{m}</div>
              <div className="mt-1 truncate text-xs font-black">{name}</div>
              <div
                className={`font-mono text-sm font-black ${
                  rank === 0 ? "text-amber-300" : rank === 1 ? "text-zinc-300" : "text-orange-400"
                }`}
              >
                {v}
              </div>
              <div className="text-[9px] text-zinc-500">pETH · this week</div>
            </div>
          );
        })}
      </div>

      {/* ranked table */}
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[9px] uppercase tracking-wide text-zinc-500">
              <th className="px-3 py-2 text-left font-semibold">#</th>
              <th className="px-3 py-2 text-left font-semibold">Trader</th>
              <th className="px-3 py-2 text-right font-semibold">Weekly PnL</th>
              <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Rounds</th>
              <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Win %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([r, name, v, rounds, win]) => (
              <tr key={name} className="border-t border-zinc-800/60">
                <td className="px-3 py-2 font-mono text-zinc-500">{r}</td>
                <td className="px-3 py-2">{name}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-400">{v}</td>
                <td className="hidden px-3 py-2 text-right font-mono text-zinc-400 sm:table-cell">{rounds}</td>
                <td className="hidden px-3 py-2 text-right font-mono text-zinc-400 sm:table-cell">{win}</td>
              </tr>
            ))}
            {/* your highlighted row, climbing a rank mid-scene */}
            <tr className="border-t border-lime-400/30 bg-lime-400/10">
              <td className="px-3 py-2 font-mono font-bold text-lime-300">
                {climbed ? "9" : "10"}
                <span className="ml-1 text-emerald-400">{climbed ? "▲" : ""}</span>
              </td>
              <td className="px-3 py-2 font-bold text-lime-300">you</td>
              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">
                +{youPnl.toFixed(1)}
              </td>
              <td className="hidden px-3 py-2 text-right font-mono text-zinc-300 sm:table-cell">19</td>
              <td className="hidden px-3 py-2 text-right font-mono text-zinc-300 sm:table-cell">63%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="text-[10px] leading-snug text-zinc-500">
        Live across <span className="text-zinc-300">every lobby</span>, updating as rounds settle. Sort by weekly
        PnL, season XP, or all-time. The <span className="text-amber-300">top 10 by weekly XP</span> split the Jackpot →
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  SCENE 7 — Quests · XP · Levels  (mirrors profile progression panels)
 * ------------------------------------------------------------------ */

function QuestRow({ name, sub, xp, p }: { name: string; sub?: string; xp: number; p: number }) {
  const done = p >= 1;
  return (
    <div className="rounded-lg bg-zinc-900 p-2">
      <div className="flex items-center justify-between text-xs">
        <span className={`font-bold ${done ? "text-emerald-400" : ""}`}>
          {done ? "✓ " : ""}
          {name}
        </span>
        <span className={`text-[10px] ${done ? "text-emerald-400" : "text-lime-400"}`}>+{xp} XP</span>
      </div>
      {sub && <div className="mt-0.5 text-[9px] text-zinc-500">{sub}</div>}
      <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-zinc-800">
        <div
          className={`h-full ${done ? "bg-emerald-500" : "bg-lime-400"}`}
          style={{ width: `${Math.min(100, p * 100)}%` }}
        />
      </div>
    </div>
  );
}

function QuestScene() {
  const t = useSceneClock(durOf("quests"));
  // Level 24 (Sniper). Next level costs the delta between L24 and L25 of the curve.
  const xpFloor = 12924; // xpForLevel(25) reference point in the real curve
  const xpNow = Math.round(lerp(11300, 12300, Math.min(1, t * 1.3)));
  const span = xpFloor - 11000;
  const showBadge = t > 0.5 && t < 0.94;

  return (
    <div className="relative grid h-full animate-[fadein_.4s_ease] gap-3 sm:grid-cols-2">
      {/* achievement-unlock toast — proves badges are a thing */}
      {showBadge && (
        <div className="absolute right-0 top-0 z-20 flex max-w-[85%] items-center gap-2 rounded-lg border border-violet-400/50 bg-zinc-900/95 px-3 py-2 shadow-lg animate-[fadein_.3s_ease]">
          <span className="text-lg">🎯</span>
          <div className="leading-tight">
            <div className="text-[11px] font-black text-violet-300">Badge unlocked · Perfect Exit</div>
            <div className="text-[9px] text-zinc-400">Epic · sold within 5% of the peak · +120 XP</div>
          </div>
        </div>
      )}

      {/* left: identity, level, streaks, milestones */}
      <div className="flex min-h-0 flex-col gap-3">
        <div className="rounded-xl border border-zinc-800 p-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-black text-lime-300">Lv 24 · Sniper</span>
            <span className="font-mono text-zinc-500">
              {xpNow.toLocaleString()} / {xpFloor.toLocaleString()} XP
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-zinc-800">
            <div
              className="h-full bg-lime-400"
              style={{ width: `${Math.min(100, ((xpNow - 11000) / span) * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 text-[10px] text-zinc-500">
            Next: <span className="text-zinc-300">Lv 35 · Degen</span> unlocks the{" "}
            <span className="text-red-300">Degen Arena</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-orange-500/40 bg-gradient-to-br from-orange-500/10 to-transparent p-3">
            <div className="text-[11px] font-bold text-orange-300">🔥 Play Streak</div>
            <div className="font-mono text-2xl font-black text-orange-300">
              12<span className="ml-1 text-xs font-bold text-zinc-500">days</span>
            </div>
            <div className="text-[10px] text-zinc-500">best 18 · ❄️ 2 freezes held</div>
          </div>
          <div className="rounded-xl border border-amber-400/40 bg-gradient-to-br from-amber-500/10 to-transparent p-3">
            <div className="text-[11px] font-bold text-amber-300">🎟️ Season Pass</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
              <div className="h-full bg-amber-400" style={{ width: "64%" }} />
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">tier 3 · next at 3,500 XP</div>
          </div>
        </div>

        <div className="hidden rounded-xl border border-zinc-800 p-3 sm:block">
          <div className="mb-2 text-[11px] font-bold text-zinc-300">🏅 Lifetime Milestones</div>
          <div className="space-y-2">
            <MilestoneBar name="Trader" now={78} target={100} unit="trades" xp={90} />
            <MilestoneBar name="Veteran" now={41} target={50} unit="rounds" xp={120} />
          </div>
        </div>
      </div>

      {/* right: the quest boards */}
      <div className="flex min-h-0 flex-col gap-3">
        <div className="rounded-xl border border-zinc-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-300">Daily Quests</span>
            <span className="text-[10px] text-amber-300">clear all 4 → +50 XP</span>
          </div>
          <div className="space-y-2">
            <QuestRow name="Pull Up Twice" sub="Play 2 rounds today" xp={30} p={Math.min(1, t * 1.7)} />
            <QuestRow name="Catch the Dip" sub="Buy near a round's bottom" xp={35} p={Math.min(1, t * 1.1)} />
            <QuestRow name="Order Flow" sub="Make 10 trades today" xp={25} p={Math.min(1, t * 0.85)} />
            <QuestRow name="On the Box" sub="Finish top 3 by PnL" xp={40} p={Math.min(1, t * 0.55)} />
          </div>
        </div>

        <div className="min-h-0 flex-1 rounded-xl border border-zinc-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-300">Weekly Challenges</span>
            <span className="text-[10px] text-amber-300">clear all 6 → +400 XP</span>
          </div>
          <div className="space-y-2">
            <QuestRow name="Regular" sub="Play 20 rounds this week" xp={200} p={Math.min(1, t * 0.9)} />
            <QuestRow name="On the Box ×3" sub="Reach a podium 3 times" xp={250} p={Math.min(1, t * 0.5)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MilestoneBar({
  name,
  now,
  target,
  unit,
  xp,
}: {
  name: string;
  now: number;
  target: number;
  unit: string;
  xp: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-bold">{name}</span>
        <span className="font-mono text-zinc-500">
          {now}/{target} {unit} · <span className="text-lime-400">+{xp}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-800">
        <div className="h-full bg-lime-500" style={{ width: `${(now / target) * 100}%` }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  SCENE 6 — The Weekly Jackpot  (mirrors /jackpot)
 * ------------------------------------------------------------------ */

function JackpotScene() {
  const t = useSceneClock(durOf("jackpot"));
  const pot = lerp(0, 2384, Math.min(1, t * 1.5)); // USD, counts up
  const eth = pot / 1920;
  const winners = [
    ["🥇", "Grillmaster", 4820, 0.25],
    ["🥈", "DiamondDan", 3910, 0.18],
    ["🥉", "0xWhale", 3140, 0.14],
    ["4", "ape_ceo", 2600, 0.1],
    ["5", "TapeReader", 2210, 0.08],
  ] as const;
  return (
    <div className="flex h-full animate-[fadein_.4s_ease] flex-col gap-3">
      <div className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-500/15 to-transparent p-5 text-center">
        <div className="pointer-events-none absolute -right-6 -top-6 text-8xl opacity-10">🎰</div>
        <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-amber-400/80">The Weekly Jackpot</div>
        <div className="mt-1 font-mono text-5xl font-black text-amber-300">
          ${Math.round(pot).toLocaleString()}
        </div>
        <div className="mt-1 font-mono text-xs text-zinc-400">
          {eth.toFixed(3)} ETH · pays out in 2d 14h · top 10 by weekly XP
        </div>
      </div>
      <div className="rounded-xl border border-zinc-800 p-3">
        <div className="mb-2 text-[11px] font-bold text-zinc-300">
          Fed by every trading fee · no cap, paid in real ETH
        </div>
        <div className="flex h-6 overflow-hidden rounded-full text-[10px] font-black text-zinc-950">
          <div className="flex items-center justify-center bg-amber-400" style={{ width: "30%" }}>30% JACKPOT</div>
          <div className="flex items-center justify-center bg-lime-400" style={{ width: "30%" }}>30% creator</div>
          <div className="flex items-center justify-center bg-sky-400" style={{ width: "10%" }}>10%</div>
          <div className="flex items-center justify-center bg-zinc-600 text-zinc-300" style={{ width: "30%" }}>house</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-left text-[10px] uppercase text-zinc-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2 text-right">Weekly XP</th>
              <th className="px-3 py-2 text-right">Projected cut</th>
            </tr>
          </thead>
          <tbody>
            {winners.map(([m, name, xp, wgt], i) => (
              <tr key={name} className={`border-t border-zinc-800/60 ${i < 3 ? "bg-amber-500/[0.04]" : ""}`}>
                <td className="px-3 py-2 font-mono">{m}</td>
                <td className="px-3 py-2 font-bold">{name}</td>
                <td className="px-3 py-2 text-right font-mono text-zinc-300">{xp.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-amber-300">
                  ${(pot * wgt).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Launchpad (submit a coin) + Community Upvote (vote it onto the calendar)
 * ------------------------------------------------------------------ */

function typed(s: string, t: number, start: number, end: number) {
  const p = Math.max(0, Math.min(1, (t - start) / (end - start)));
  return s.slice(0, Math.round(s.length * p));
}

function Field({
  label,
  children,
  mono,
  full,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`min-h-[2.4rem] rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm ${mono ? "font-mono" : ""}`}>
        {children}
      </div>
    </div>
  );
}

/** Accurate recreation of the launchpad's "Submit a Token Concept" flow. */
function LaunchpadScene() {
  const t = useSceneClock(durOf("launchpad"));
  const submitted = t > 0.86;
  const name = typed("Pork Belly", t, 0.05, 0.22);
  const sym = typed("PORK", t, 0.22, 0.32);
  const theme = typed("the ultimate breakfast meme", t, 0.32, 0.55);
  const supply = typed("2000000", t, 0.55, 0.66);
  const showImg = t > 0.66;
  const armed = t > 0.74;
  const caret = <span className="ml-0.5 inline-block h-3.5 w-px animate-pulse bg-lime-400 align-middle" />;

  return (
    <div className="flex h-full animate-[fadein_.4s_ease] flex-col gap-3">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">Make a coin</div>
        <h3 className="mt-1 text-lg font-black">Put a coin up for a vote</h3>
        <p className="text-xs text-zinc-500">
          You pick the name, the art, and the supply. That&apos;s all you get to pick. Every coin
          comes off the same audited template, so there&apos;s no mint button to abuse.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Token name">
          {name}
          {!submitted && name.length > 0 && name.length < 10 && caret}
        </Field>
        <Field label="Symbol" mono>
          {sym ? `$${sym}` : ""}
          {!submitted && sym.length > 0 && sym.length < 4 && caret}
        </Field>
        <Field label="Theme (one line)" full>
          {theme}
          {!submitted && theme.length > 0 && theme.length < 27 && caret}
        </Field>
        <div className="flex items-end gap-5 sm:col-span-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Coin image</div>
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-lg border text-3xl transition ${
                showImg
                  ? "border-lime-400/50 bg-gradient-to-br from-pink-500/30 to-orange-500/20"
                  : "border-dashed border-zinc-700 text-zinc-700"
              }`}
            >
              {showImg ? "🐷" : "+"}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Total supply (100K – 1B)
            </div>
            <div className="w-44 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm">
              {supply ? Number(supply).toLocaleString() : ""}
              {!submitted && supply.length > 0 && supply.length < 7 && caret}
            </div>
          </div>
        </div>
      </div>

      <div
        className={`w-fit rounded-lg px-5 py-2 text-sm font-black transition ${
          submitted
            ? "bg-emerald-500 text-white"
            : armed
              ? "bg-lime-400 text-zinc-950 shadow-lg shadow-lime-400/30"
              : "bg-zinc-800 text-zinc-500"
        }`}
      >
        {submitted ? "✓ Submitted · now up for community vote" : "Submit Concept"}
      </div>

      <div className="mt-auto grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["50%", "supply in pool at open"],
          ["1.5 pETH", "seed liquidity"],
          ["1% fee", "creator gets 30%"],
          ["$40k mcap", "serves up / graduates"],
        ].map(([v, k]) => (
          <div key={k} className="rounded-lg bg-zinc-900 p-2.5">
            <div className="font-mono text-xs font-bold text-zinc-200">{v}</div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Real community-vote flow: upvote fresh concepts toward the shortlist. */
function UpvoteScene() {
  const t = useSceneClock(durOf("upvote"));
  const CONCEPTS = [
    { emoji: "🐷", name: "Pork Belly", sym: "PORK", theme: "the ultimate breakfast meme", by: "0x9f…c3", base: 6.5, gain: 6 },
    { emoji: "🛸", name: "Abduction", sym: "BEAM", theme: "they're taking us to the moon", by: "0x2a…7e", base: 3, gain: 5 },
    { emoji: "🥔", name: "Couch Potato", sym: "SPUD", theme: "do nothing, earn nothing, vibe", by: "0x84…1b", base: 2, gain: 4 },
  ];
  return (
    <div className="flex h-full animate-[fadein_.4s_ease] flex-col gap-3">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">Community Upvote</div>
        <h3 className="mt-1 text-lg font-black">Voting Now</h3>
        <p className="text-xs text-zinc-500">
          10 upvotes sends a fresh coin to the committee shortlist and into the Arena.
        </p>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 sm:grid-cols-3">
        {CONCEPTS.map((c, i) => {
          const votes = Math.min(12, Math.round(c.base + c.gain * Math.min(1, t * 1.5)));
          const shortlisted = votes >= 10;
          const pct = Math.min(100, (votes / 10) * 100);
          return (
            <div
              key={c.sym}
              className={`flex flex-col rounded-xl border p-3 ${
                shortlisted ? "border-sky-500/50 bg-sky-500/[0.05]" : "border-zinc-800"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex gap-2">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-2xl">
                    {c.emoji}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-black leading-tight">
                      {c.name} <span className="text-zinc-500">${c.sym}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400">{c.theme}</div>
                    <div className="mt-0.5 text-[10px] text-zinc-600">by {c.by}</div>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    shortlisted ? "bg-sky-500/20 text-sky-300" : "bg-zinc-800 text-zinc-300"
                  }`}
                >
                  {shortlisted ? "shortlisted" : "submitted"}
                </span>
              </div>
              <div className="mt-auto pt-3">
                {shortlisted ? (
                  <div className="text-[11px] font-bold text-sky-300">
                    ✓ Vote passed · awaiting a match slot
                  </div>
                ) : (
                  <>
                    <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
                      <div
                        className="h-full bg-lime-400 transition-[width] duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
                      <span>{votes}/10 to shortlist</span>
                      <span>{18 - i * 3}h left</span>
                    </div>
                  </>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <span
                    className={`rounded px-2.5 py-1 text-xs font-bold ${
                      shortlisted ? "bg-zinc-800 text-zinc-500" : "bg-lime-400 text-zinc-950"
                    }`}
                  >
                    ▲ Upvote
                  </span>
                  <span className="font-mono text-xs text-zinc-400">{votes} votes</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-center text-[11px] text-zinc-600">
        Winners get a match slot · creators earn a cut of trading fees · every launch uses the same template.
      </p>
    </div>
  );
}
