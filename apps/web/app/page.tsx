"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useBrandAsset } from "../lib/useBrandAsset";
import { ArenaDemo } from "../components/ArenaDemo";

/**
 * Marketing landing + beta funnel. The whitelist is earned on X (@hoodcookout):
 * follow, like, repost, and comment your wallet — the team imports eligible
 * wallets via CSV in the admin. Scroll-reveal sections cover the product as it
 * stands: fair-open PvP arena, XP quests, and the real-ETH Weekly Jackpot.
 */

const X_URL = "https://x.com/hoodcookout";
const X_HANDLE = "@hoodcookout";

export default function Landing() {
  return (
    <div className="-mx-4 -my-6">
      <Hero />
      <ArenaDemo />
      <RoundFlow />
      <FairOpen />
      <Jackpot />
      <Pillars />
      <Access />
      <footer className="border-t border-zinc-800 px-6 py-8 text-center text-xs text-zinc-600">
        The Cookout · paper-money beta — simulated balances, no real funds at risk · the house only
        ever earns fees · <Link href="/docs" className="underline hover:text-zinc-400">read the manual</Link>
      </footer>
    </div>
  );
}

/* ---------------- scroll-reveal wrapper ---------------- */

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ---------------- hero with animated candle-field canvas ---------------- */

function Hero() {
  const ref = useRef<HTMLCanvasElement>(null);
  const mascotSrc = useBrandAsset("/brand/mascot.png", "/brand/mascot.svg");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;

    interface Col {
      x: number;
      candles: Array<{ o: number; c: number; h: number; l: number }>;
      price: number;
      vel: number;
      speed: number;
      next: number;
    }
    let cols: Col[] = [];
    interface Ember {
      x: number;
      y: number;
      r: number;
      vy: number;
      vx: number;
      a: number;
    }
    let embers: Ember[] = [];

    const seed = (w: number, h: number) => {
      cols = [];
      const n = Math.ceil(w / 26);
      for (let i = 0; i < n; i++) {
        const col: Col = {
          x: i * 26,
          candles: [],
          price: h * (0.35 + Math.random() * 0.4),
          vel: 0,
          speed: 500 + Math.random() * 900,
          next: 0,
        };
        for (let k = 0; k < 14; k++) stepCol(col, h);
        cols.push(col);
      }
      embers = Array.from({ length: 40 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.8 + Math.random() * 2,
        vy: 0.15 + Math.random() * 0.5,
        vx: (Math.random() - 0.5) * 0.15,
        a: 0.15 + Math.random() * 0.5,
      }));
    };

    const stepCol = (col: Col, h: number) => {
      const o = col.price;
      col.vel = col.vel * 0.85 + (Math.random() - 0.485) * h * 0.05;
      let c = o + col.vel;
      c = Math.max(h * 0.12, Math.min(h * 0.92, c));
      col.price = c;
      const wick = h * 0.012;
      col.candles.push({
        o,
        c,
        h: Math.min(o, c) - Math.random() * wick * 2,
        l: Math.max(o, c) + Math.random() * wick * 2,
      });
      if (col.candles.length > 14) col.candles.shift();
    };

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        seed(w, h);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      for (const col of cols) {
        if (t > col.next) {
          stepCol(col, h);
          col.next = t + col.speed;
        }
        col.candles.forEach((cd, i) => {
          const up = cd.c <= cd.o; // canvas y is inverted
          const age = i / col.candles.length;
          ctx.globalAlpha = 0.05 + age * 0.16;
          ctx.strokeStyle = up ? "#22c55e" : "#ef4444";
          ctx.fillStyle = up ? "#22c55e" : "#ef4444";
          const cx = col.x + 10;
          ctx.beginPath();
          ctx.moveTo(cx, cd.h);
          ctx.lineTo(cx, cd.l);
          ctx.stroke();
          ctx.fillRect(cx - 4, Math.min(cd.o, cd.c), 8, Math.max(2, Math.abs(cd.c - cd.o)));
        });
      }
      ctx.globalAlpha = 1;

      for (const e of embers) {
        e.y -= e.vy;
        e.x += e.vx + Math.sin((t + e.y) / 900) * 0.1;
        if (e.y < -4) {
          e.y = h + 4;
          e.x = Math.random() * w;
        }
        ctx.globalAlpha = e.a * (0.6 + 0.4 * Math.sin(t / 400 + e.x));
        ctx.fillStyle = "#a3e635";
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="relative overflow-hidden">
      <canvas ref={ref} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/70 via-zinc-950/40 to-zinc-950" />
      <div className="relative mx-auto max-w-4xl px-6 pb-24 pt-20 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mascotSrc}
          alt=""
          className="mx-auto mb-4 h-36 w-36 object-contain drop-shadow-[0_0_35px_rgba(163,230,53,0.45)] md:h-44 md:w-44"
        />
        <a
          href="#access"
          className="mb-5 inline-flex items-center gap-2 rounded-full border border-lime-400/40 bg-lime-400/10 px-4 py-1 text-xs font-bold tracking-widest text-lime-300 transition hover:bg-lime-400/20"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-lime-400" />
          </span>
          PRIVATE BETA · WHITELIST OPEN ON X
        </a>
        <h1 className="text-5xl font-black tracking-tight md:text-8xl">
          <span className="text-lime-400">THE</span>{" "}
          <span className="text-zinc-50 [text-shadow:0_0_2px_#a3e635,0_0_18px_rgba(163,230,53,0.5)]">
            COOKOUT
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-300 md:text-xl">
          The live multiplayer trading arena. Every match is a brand-new token — a{" "}
          <span className="font-bold text-zinc-100">provably fair open</span>, a few violent minutes
          of real PvP trading in front of a crowd, then it graduates or it burns.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-base text-zinc-400">
          Paper-money beta: real markets, real competition, <span className="text-lime-300">zero risk</span>.
          Climb the XP ladder and take a cut of the weekly jackpot.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#access"
            className="rounded-xl bg-lime-400 px-8 py-4 text-lg font-black text-zinc-950 shadow-lg shadow-lime-400/30 transition hover:scale-105 hover:bg-lime-300"
          >
            Get Beta Access
          </a>
          <Link
            href="/docs"
            className="rounded-xl border border-zinc-700 px-8 py-4 text-lg font-bold text-zinc-200 transition hover:border-zinc-500"
          >
            Read the Manual
          </Link>
        </div>
        <p className="mt-6 text-xs text-zinc-500">
          No deposits. No downloads. Your wallet address is your whole identity.
        </p>
      </div>
    </section>
  );
}

/* ---------------- how a round works ---------------- */

const STEPS = [
  {
    icon: "🚪",
    title: "Pull Up",
    body: "A fresh community-made token drops on the match calendar every few minutes. Hit the lobby, size up the crowd, and make your Moon-or-Rug call.",
  },
  {
    icon: "⚖️",
    title: "Fair Open",
    body: "No sniping, no gas wars. Buy intents queue until a fixed close, then everyone settles at ONE clearing price — oversubscribed rounds fill pro-rata. Every settlement is auditable.",
  },
  {
    icon: "📈",
    title: "Trade Live",
    body: "A real market: your buys push price up, sells push it down. One-second candles, a kill feed, whales, and a chat losing its mind. Scalp it or diamond-hand to the bell.",
  },
  {
    icon: "🎓",
    title: "Graduate or Burn",
    body: "Hit the bonding targets and it graduates into an Arena Alumni that trades forever. Fall short and everyone exits at one fair redemption price. Get rugged and… that's the game.",
  },
];

function RoundFlow() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <Reveal>
        <h2 className="text-center text-3xl font-black md:text-4xl">A full launch. Every few minutes.</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-zinc-400">
          Rounds run minutes, not weeks. Bounded exposure, guaranteed exits, and an open no bot can
          snipe.
        </p>
      </Reveal>
      <div className="mt-12 grid gap-6 md:grid-cols-4">
        {STEPS.map((s, i) => (
          <Reveal key={s.title} delay={i * 90}>
            <div className="group relative h-full rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition hover:-translate-y-1 hover:border-lime-400/50">
              <div className="absolute -top-3 left-6 rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-400">
                {i + 1}
              </div>
              <div className="text-4xl transition group-hover:scale-110">{s.icon}</div>
              <h3 className="mt-3 text-lg font-black">{s.title}</h3>
              <p className="mt-2 text-sm text-zinc-400">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- the fair open (differentiator band) ---------------- */

function FairOpen() {
  return (
    <section className="border-y border-zinc-800 bg-gradient-to-b from-emerald-500/[0.06] to-transparent py-20">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal className="text-center">
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">The Fair Open</div>
          <h2 className="mt-3 text-3xl font-black md:text-5xl">
            Speed buys you <span className="text-emerald-400">nothing.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-zinc-300">
            On every other launchpad, the open goes to whoever has the fastest bot. Here it&apos;s a
            uniform-price batch auction: the first bid and the last bid pay the exact same price.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            ["⏱️", "One clearing price", "Bids queue until a fixed close, then settle in a single shot at one price for everyone. Arrival order is irrelevant."],
            ["🪢", "Pro-rata fills", "Oversubscribed? Every bid is filled proportionally — never first-come, never by who paid more gas."],
            ["🔍", "Recompute it yourself", "Each settlement ships with an audit hash you can rebuild from the public bids and our open-source math."],
          ].map(([icon, title, body], i) => (
            <Reveal key={title} delay={i * 90}>
              <div className="h-full rounded-2xl border border-zinc-800 bg-zinc-950/40 p-6">
                <div className="text-3xl">{icon}</div>
                <h3 className="mt-3 font-black">{title}</h3>
                <p className="mt-2 text-sm text-zinc-400">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- XP + weekly jackpot (the hook) ---------------- */

function Jackpot() {
  return (
    <section className="relative overflow-hidden py-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_0%,rgba(251,191,36,0.12),transparent)]" />
      <div className="relative mx-auto max-w-5xl px-6">
        <Reveal className="text-center">
          <div className="text-6xl">🎰</div>
          <h2 className="mt-3 text-3xl font-black md:text-5xl">
            Play for the <span className="text-amber-400">pot.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-300">
            Every trade on the site feeds one shared <b className="text-amber-300">Weekly Jackpot</b>.
            At the end of each week it pays out to the top players — <b>real ETH</b> in production —
            and the more the whole site trades, the bigger it grows.
          </p>
        </Reveal>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            ["Real ETH, every week", "A slice of all trading fees builds the pot. The top 10 by weekly XP split it — no cap, paid out automatically."],
            ["XP from playing", "Rotating daily quests, weekly challenges, play streaks, lifetime milestones, and a monthly season pass. Everything you do earns."],
            ["Farm-proof by design", "Wash-trading and bot spam earn almost nothing. The pot rewards skill, timing, and consistency — never the busiest bot."],
          ].map(([title, body], i) => (
            <Reveal key={title} delay={i * 90}>
              <div className="h-full rounded-2xl border border-amber-400/30 bg-gradient-to-b from-amber-500/[0.08] to-transparent p-6">
                <h3 className="font-black text-amber-300">{title}</h3>
                <p className="mt-2 text-sm text-zinc-300">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-10 text-center">
          <Link href="/docs#quests" className="text-sm font-bold text-amber-400 underline hover:text-amber-300">
            See exactly how XP &amp; the jackpot work →
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- trust pillars ---------------- */

const PILLARS = [
  ["🏦", "The house only earns fees", "Every pETH a player loses, another player won. We never touch principal — the fee schedule is published per round."],
  ["🔍", "Auditable by anyone", "Every auction settlement ships with a hash you can recompute from public bids using our open-source math."],
  ["🚫", "No pay-to-win. Ever.", "XP, levels, quests, cosmetics — all earned by playing. Nothing that affects gameplay is for sale."],
  ["🧱", "Template-only launches", "Creators supply a name, art, and supply. No creator mint, pause, or blacklist functions exist."],
];

function Pillars() {
  return (
    <section className="border-y border-zinc-800 bg-zinc-900/30 py-16">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 md:grid-cols-4">
        {PILLARS.map(([icon, title, body], i) => (
          <Reveal key={title} delay={i * 80} className="text-center">
            <div className="text-3xl">{icon}</div>
            <h3 className="mt-2 font-black">{title}</h3>
            <p className="mt-1 text-xs text-zinc-400">{body}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- beta access via X ---------------- */

const ACCESS_STEPS = [
  ["Follow " + X_HANDLE, "It's the one and only official account. Everything — waves, announcements, drops — happens there first."],
  ["Like & Repost the posts", "Boost the signal. Engagement is how you get on our radar for the next wave."],
  ["Comment your wallet address", "Drop your Robinhood wallet (0x…) in the replies. That exact address is the one we whitelist."],
  ["Watch for the beta announcement", "When the official beta-test tweet goes out, your wave is live — connect that wallet and pull up."],
];

function Access() {
  return (
    <section id="access" className="relative mx-auto max-w-4xl scroll-mt-20 px-6 py-24">
      <Reveal className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">Getting In</div>
        <h2 className="mt-3 text-4xl font-black md:text-5xl">
          The whitelist is earned on <span className="text-lime-400">X.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-zinc-400">
          The Cookout opens in private waves — no form, no gas, nothing to sign. You claim a seat by
          showing up for {X_HANDLE} and dropping your wallet.
        </p>
      </Reveal>

      <div className="mt-12 space-y-3">
        {ACCESS_STEPS.map(([title, body], i) => (
          <Reveal key={i} delay={i * 80}>
            <div className="flex items-start gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 transition hover:border-lime-400/40">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-400 font-black text-zinc-950">
                {i + 1}
              </div>
              <div>
                <h3 className="font-black">{title}</h3>
                <p className="mt-1 text-sm text-zinc-400">{body}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-8 text-center">
        <div className="rounded-2xl border border-lime-400/40 bg-lime-400/[0.06] p-6">
          <p className="text-sm text-zinc-300">
            You must <b className="text-lime-300">like, repost, and comment your wallet</b> to be
            eligible. Eligible wallets are added to the whitelist by hand — watch for the official
            beta-test tweet to know when your wave goes live.
          </p>
          <a
            href={X_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-lime-400 px-8 py-4 text-lg font-black text-zinc-950 shadow-lg shadow-lime-400/30 transition hover:scale-105 hover:bg-lime-300"
          >
            Follow {X_HANDLE} on X →
          </a>
          <p className="mt-4 text-xs text-zinc-600">
            Safety: {X_HANDLE} is the only official account. We will never DM you first, never ask
            for a seed phrase, and never charge you to join.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
