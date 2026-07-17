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
      <Positioning />
      <FairOpen />
      <ArenaDemo />
      <RoundFlow />
      <Jackpot />
      <Pillars />
      <Access />
      <footer className="border-t border-zinc-800 px-6 py-8 text-center text-xs text-zinc-600">
        The Cookout · paper-money beta — simulated balances, no real funds at risk · the house only
        ever earns fees · <Link href="/docs" className="underline hover:text-zinc-400">menu</Link>
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

/* ---------------- recurring slogan ---------------- */

/** The product in six words. Reused verbatim across the page as a brand mark. */
function Slogan({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 font-black tracking-tight ${className}`}
    >
      <span className="text-zinc-100">Same price.</span>
      <span className="text-emerald-400">Same second.</span>
      <span className="text-lime-400">Everyone.</span>
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
          OPEN BETA · 100% PAPER MONEY
        </a>
        <h1 className="text-5xl font-black tracking-tight md:text-8xl">
          <span className="text-lime-400">THE</span>{" "}
          <span className="text-zinc-50 [text-shadow:0_0_2px_#a3e635,0_0_18px_rgba(163,230,53,0.5)]">
            COOKOUT
          </span>
        </h1>
        <p className="mx-auto mt-4 text-2xl font-black tracking-tight text-zinc-50 md:text-4xl">
          The Multiplayer Trading Arena.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-base text-zinc-400 md:text-lg">
          Every launch is a battle. Everyone enters together — the best trader wins.
        </p>

        {/* the promise, readable in one glance */}
        <div className="mx-auto mt-7 flex max-w-2xl flex-wrap items-center justify-center gap-2.5">
          {["Same price", "Same second", "No bots", "No snipers"].map((p) => (
            <span
              key={p}
              className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-sm font-black text-emerald-300 md:text-base"
            >
              {p}
            </span>
          ))}
        </div>
        <Slogan className="mt-6 text-xl md:text-3xl" />

        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
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
            Menu
          </Link>
        </div>
        <div className="mx-auto mt-7 inline-flex max-w-xl items-center gap-3 rounded-xl border border-lime-400/30 bg-lime-400/[0.06] px-5 py-2.5">
          <span className="text-xl">🎮</span>
          <p className="text-left text-sm text-zinc-200">
            <span className="font-black text-lime-300">100% paper money.</span> Trade simulated pETH —
            <b> no deposits, zero risk.</b>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------------- positioning: why Cookout exists ---------------- */

function Positioning() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <Reveal className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">Why we exist</div>
        <h2 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">
          Not another{" "}
          <span className="text-zinc-600 line-through decoration-red-500/70 decoration-4">
            launchpad.
          </span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-zinc-300">
          Launchpads reward whoever shows up fastest. We reward whoever trades best.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-2">
        <Reveal>
          <div className="h-full rounded-2xl border border-zinc-800 bg-zinc-900/40 p-7">
            <div className="text-sm font-black uppercase tracking-wide text-zinc-500">
              Every other launch rewards
            </div>
            <ul className="mt-5 space-y-3">
              {["Bots", "Snipers", "The fastest transaction"].map((x) => (
                <li key={x} className="flex items-center gap-3 text-lg font-bold text-zinc-500">
                  <span className="text-red-500/80">✕</span>
                  <span className="line-through decoration-zinc-700">{x}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="h-full rounded-2xl border border-lime-400/40 bg-gradient-to-b from-lime-400/[0.08] to-transparent p-7">
            <div className="text-sm font-black uppercase tracking-wide text-lime-300">
              The Cookout rewards
            </div>
            <ul className="mt-5 space-y-3">
              {["Better trading", "Better timing", "Better decisions"].map((x) => (
                <li key={x} className="flex items-center gap-3 text-lg font-black text-zinc-100">
                  <span className="text-lime-400">✓</span>
                  {x}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
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
          <h2 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">
            Speed buys you <span className="text-emerald-400">nothing.</span>
          </h2>
          <Slogan className="mt-6 text-2xl md:text-4xl" />
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-300">
            Every launch opens as one uniform-price batch auction. The first bid and the last bid pay
            the exact same price. There is no line to cut.
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

/**
 * A jackpot counter that ticks up on scroll-in, then keeps drifting upward so
 * the pot feels alive. Illustrative — the real pot is exactly what the week
 * trades (0.3% of all volume); this is a representative figure, not a balance.
 */
function GrowingPot() {
  const ref = useRef<HTMLDivElement>(null);
  const [val, setVal] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const BASE = 2384;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false;
    let raf = 0;
    let timer = 0;

    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        if (reduce) {
          setVal(BASE);
          return;
        }
        const t0 = performance.now();
        let cur = BASE;
        const rise = (t: number) => {
          if (cancelled) return;
          const p = Math.min(1, (t - t0) / 1800);
          setVal(Math.round(BASE * (1 - Math.pow(1 - p, 3))));
          if (p < 1) raf = requestAnimationFrame(rise);
          else drift();
        };
        const drift = () => {
          if (cancelled) return;
          cur += 3 + Math.floor(Math.random() * 12); // a few pETH of fees per beat
          setVal(cur);
          timer = window.setTimeout(drift, 1300);
        };
        raf = requestAnimationFrame(rise);
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={ref}>
      <div className="font-mono text-6xl font-black tabular-nums text-amber-300 [text-shadow:0_0_34px_rgba(251,191,36,0.4)] md:text-8xl">
        ${val.toLocaleString()}
      </div>
      <div className="mt-2 flex items-center justify-center gap-1.5 font-mono text-sm text-zinc-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
        </span>
        growing with every trade · paid every Monday
      </div>
    </div>
  );
}

function Jackpot() {
  return (
    <section className="relative overflow-hidden py-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(65%_65%_at_50%_0%,rgba(251,191,36,0.16),transparent)]" />
      <div className="relative mx-auto max-w-5xl px-6">
        <Reveal className="text-center">
          <div className="text-6xl md:text-7xl">🎰</div>
          <div className="mt-2 text-xs font-bold uppercase tracking-[0.3em] text-amber-400/80">
            The Weekly Jackpot
          </div>
          <h2 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">
            Funded by the crowd. <span className="text-amber-400">Won by the best.</span>
          </h2>
          <div className="mt-9">
            <GrowingPot />
          </div>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-300">
            Every trade feeds one shared pot — no cap, no house money. The top 10 by weekly XP split
            it in <b className="text-amber-300">real ETH</b>.
          </p>
        </Reveal>

        {/* community-funded: where every 1% trading fee goes */}
        <Reveal delay={80} className="mx-auto mt-10 max-w-2xl">
          <div className="text-center text-xs font-bold uppercase tracking-wide text-zinc-500">
            Every 1% trading fee → 70% back to the community
          </div>
          <div className="mt-2 flex h-7 overflow-hidden rounded-full text-[10px] font-black text-zinc-950">
            <div className="flex items-center justify-center bg-amber-400" style={{ width: "30%" }}>
              30% JACKPOT
            </div>
            <div className="flex items-center justify-center bg-lime-400" style={{ width: "30%" }}>
              30% creator
            </div>
            <div className="flex items-center justify-center bg-sky-400" style={{ width: "10%" }}>
              10% ref
            </div>
            <div className="flex items-center justify-center bg-zinc-600 text-zinc-300" style={{ width: "30%" }}>
              house
            </div>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            ["Real ETH, every week", "A slice of every trading fee builds the pot. The top 10 split it, paid out automatically. No cap."],
            ["Earned by playing", "Daily quests, weekly challenges, streaks, milestones, a season pass. Everything you do earns XP."],
            ["Bots earn nothing", "Wash-trading and spam decay to almost zero. The pot rewards skill, timing, and consistency."],
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
          The Cookout opens in rolling waves — no form, no gas, nothing to sign. It&apos;s a
          <b className="text-zinc-200"> paper-money beta</b> (simulated pETH, zero risk); you claim a
          seat by showing up for {X_HANDLE} and dropping your wallet.
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
