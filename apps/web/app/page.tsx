"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useBrandAsset } from "../lib/useBrandAsset";
import { ArenaDemo } from "../components/ArenaDemo";

/**
 * The front door. Reads as a game, not a launchpad: curiosity, then the
 * crowd, then why people come back, then gameplay, then the pot, then how
 * the open stays fair, then a seat.
 *
 * Whitelist is earned on X (@hoodcookout): follow, like, repost, comment
 * your wallet. Eligible wallets are imported by CSV in the admin.
 */

const X_URL = "https://x.com/hoodcookout";
const X_HANDLE = "@hoodcookout";

export default function Landing() {
  return (
    <div className="-mx-4 -my-6">
      <Hero />
      <LiveNow />
      <TheCrowd />
      <WhyComeBack />
      <ArenaDemo />
      <RoundFlow />
      <Jackpot />
      <FairOpen />
      <Pillars />
      <FoundingPlayers />
      <Access />
      <footer className="border-t border-zinc-800 px-6 py-8 text-center text-xs text-zinc-600">
        The Cookout · paper-money beta, so nothing here is real money yet · we only ever make money
        on fees · <Link href="/docs" className="underline hover:text-zinc-400">the menu</Link>
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
          Every chart is a multiplayer match.
        </p>
        <p className="mx-auto mt-3 max-w-xl text-base text-zinc-400 md:text-lg">
          A room full of people piles into the same coin at the same second. You get a few
          minutes to out-trade all of them. Then we run it back.
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
            Claim Your Seat
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
            <span className="font-black text-lime-300">It&apos;s all paper money right now.</span>{" "}
            Nothing to deposit, nothing to lose. The competition is the real part.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------------- the room, right now ---------------- */

const TICKER_LINES = [
  "🐋 someone walked in with 0.8 and moved the whole chart",
  "🏆 DiamondDan took the PnL lead with 40 seconds left",
  "💀 RUGRAT went to zero. eight people got out first.",
  "🔥 queue filled in under a minute",
  "🍽️ WAGYU served up. holders kept their bags.",
  "📈 fomo_fred doubled his position at the top. bold.",
  "🎰 the pot went up again",
];

/**
 * A pulse under the hero. Player count, pot, and matches are real when the
 * API answers; the ticker is flavor from actual round events. Nothing here
 * is load-bearing, so a cold API just shows fewer numbers.
 */
function LiveNow() {
  const [online, setOnline] = useState<number | null>(null);
  const [pot, setPot] = useState<number | null>(null);
  const [matches, setMatches] = useState<number | null>(null);
  const [line, setLine] = useState(0);

  useEffect(() => {
    const load = () => {
      api<{ online: unknown[] }>("/api/social/online")
        .then((d) => setOnline(d.online?.length ?? 0))
        .catch(() => {});
      api<{ poolUsd?: number; poolEth?: number }>("/api/jackpot")
        .then((d) => setPot(d.poolUsd ?? null))
        .catch(() => {});
      api<Array<{ state: string }>>("/api/calendar")
        .then((r) => setMatches(r.length))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setLine((n) => (n + 1) % TICKER_LINES.length), 3400);
    return () => clearInterval(t);
  }, []);

  const stats: Array<[string, string]> = [
    ["in the room", online === null ? "—" : String(online)],
    ["this week's pot", pot === null ? "—" : `$${Math.round(pot).toLocaleString()}`],
    ["matches run", matches === null ? "—" : String(matches)],
    ["a match takes", "~10 min"],
  ];

  return (
    <section className="border-y border-zinc-800 bg-zinc-900/30">
      <div className="mx-auto max-w-5xl px-6 py-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map(([k, v]) => (
            <div key={k} className="text-center">
              <div className="font-mono text-2xl font-black text-lime-300">{v}</div>
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 border-t border-zinc-800 pt-3">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-lime-400" />
          </span>
          <span key={line} className="animate-[fadein_.4s_ease] truncate text-sm text-zinc-400">
            {TICKER_LINES[line]}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ---------------- the crowd ---------------- */

function TheCrowd() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <Reveal className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">The crowd</div>
        <h2 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">
          The chart is just the scoreboard.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-300">
          The actual game is forty people watching the same candles and losing their minds about
          it. You&apos;ll know the regulars by your third match.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          ["💬", "Chat runs the whole match", "Before the open, during the dump, after somebody gets rugged. It doesn't stop."],
          ["👀", "People watch you trade", "Spectators see the entries. Big buys get your name on the chart."],
          ["🔮", "Call it before it happens", "Moon or rug. Say it out loud in front of everyone and find out."],
          ["🏆", "Names start meaning something", "You'll learn who holds, who panics, and who always shows up late."],
          ["⚔️", "Grudges are a feature", "Somebody dumped on you. They're in the next lobby too."],
          ["🔁", "Nobody leaves after one", "Rounds run minutes. There's always another one starting."],
        ].map(([icon, title, body], i) => (
          <Reveal key={title} delay={i * 70}>
            <div className="h-full rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
              <div className="text-2xl">{icon}</div>
              <h3 className="mt-2 font-black">{title}</h3>
              <p className="mt-1.5 text-sm text-zinc-400">{body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- why people come back ---------------- */

function WhyComeBack() {
  return (
    <section className="border-y border-zinc-800 bg-gradient-to-b from-lime-400/[0.05] to-transparent py-20">
      <div className="mx-auto max-w-4xl px-6">
        <Reveal className="text-center">
          <h2 className="text-4xl font-black tracking-tight md:text-5xl">
            Nobody comes back because a new coin launched.
          </h2>
        </Reveal>
        <Reveal delay={90} className="mt-10">
          <ul className="mx-auto max-w-2xl space-y-4 text-lg text-zinc-300">
            {[
              "They come back because they finished 4th and it's been eating at them all day.",
              "Because the guy who dumped on them yesterday is in the next lobby.",
              "Because they know half the names in chat now.",
              "The pot's still sitting there, and Monday's coming.",
              "And a match only takes ten minutes. It's never just one.",
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-lime-400" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- founding players ---------------- */

function FoundingPlayers() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20">
      <Reveal className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-amber-400">
          Before everyone else
        </div>
        <h2 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
          Become a founding player.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-zinc-300">
          Right now the whole thing fits in one room. The people here are deciding what this turns
          into, and most of that has nothing to do with us.
        </p>
      </Reveal>
      <Reveal delay={90} className="mt-10">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            "The first rivalries",
            "The first champion nobody can catch",
            "The inside jokes that stop making sense to outsiders",
            "The rounds people still bring up months later",
            "The names that end up meaning something",
            "The way the room talks",
          ].map((x) => (
            <div
              key={x}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-300"
            >
              {x}
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-zinc-500">
          Later on there&apos;ll be a leaderboard full of names. Some of them get to say they were
          here for match #4.
        </p>
      </Reveal>
    </section>
  );
}

/* ---------------- how a round works ---------------- */

const STEPS = [
  {
    icon: "🚪",
    title: "Pull Up",
    body: "Somebody's coin comes up on the calendar. You walk into the lobby, see who else is here, and call it: moon or rug.",
  },
  {
    icon: "⚖️",
    title: "Fair Open",
    body: "Everyone puts in their buy before the bell. Nobody gets filled early. When it closes, the whole room gets the exact same price.",
  },
  {
    icon: "📈",
    title: "Trade Live",
    body: "Now it's a real market and everyone can see what you're doing. Scalp it, ride it, or panic. Chat will have opinions either way.",
  },
  {
    icon: "🎓",
    title: "Graduate or Burn",
    body: "Hit the targets and the coin lives on. Fall short and everybody cashes out at the same price. Get rugged and, well, that happened.",
  },
];

function RoundFlow() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <Reveal>
        <h2 className="text-center text-4xl font-black tracking-tight md:text-5xl">
          How a match works
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-zinc-400">
          Ten minutes, start to finish. Then the next one.
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
      <div className="mx-auto max-w-3xl px-6">
        <Reveal className="text-center">
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">
            The one rule
          </div>
          <h2 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">
            Nobody gets in first.
          </h2>
          <Slogan className="mt-6 text-2xl md:text-4xl" />
          <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-300">
            Buys don&apos;t fill as they come in. They pile up until the bell, then the whole room
            gets one price. Being fast doesn&apos;t help. Neither does a bot.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-500">
            If more money shows up than the round can take, everyone gets cut back by the same
            percentage. You can rebuild the math yourself from the public bids.{" "}
            <Link href="/docs#auction" className="text-emerald-400 underline hover:text-emerald-300">
              It&apos;s all in the menu.
            </Link>
          </p>
        </Reveal>
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
            Every match feeds the same pot.
          </h2>
          <div className="mt-9">
            <GrowingPot />
          </div>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-300">
            A slice of every trade goes in and stays in. Monday it pays out to the ten players who
            earned the most XP that week, in <b className="text-amber-300">real ETH</b>. Then it
            starts over and everybody&apos;s chasing it again.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-500">
            It&apos;s the thing that turns a good night into a good week. You&apos;re not grinding
            for points, you&apos;re grinding for a spot on Monday.
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
            ["No cap on it", "Busy week, bigger pot. Nothing is minted for it and the house doesn't top it up. It's just fees."],
            ["XP is how you climb", "Quests, streaks, podium finishes, milestones. Playing well moves you up; showing up daily keeps you there."],
            ["Spam gets you nowhere", "Wash trading decays to nothing on purpose. You can't grind your way past somebody who plays better."],
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
            The full XP and payout breakdown →
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- trust pillars ---------------- */

const PILLARS = [
  ["🏦", "We only make money on fees", "If you lose, another player took it. We never touch the pot in the middle. Fees are published per round."],
  ["🔍", "Check our work", "Every settlement ships with a hash. Rebuild it from the public bids and our math and see for yourself."],
  ["🚫", "Nothing's for sale", "XP, levels, cosmetics, all of it is earned. There's no version of this where money makes you better."],
  ["🧱", "Coins can't be rigged", "Creators pick a name, art, and supply. That's it. No mint button, no pause, no blacklist. Those functions don't exist."],
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
  ["Follow " + X_HANDLE, "One account, and it's the only one. Waves get announced there before anywhere else."],
  ["Like and repost", "This is how you end up on our radar when we cut the next wave."],
  ["Comment your wallet", "Drop your Robinhood address (0x…) in the replies. That's the one we add, so paste it carefully."],
  ["Wait for the word", "When your wave goes live we say so. Connect that wallet and pull up to a lobby."],
];

function Access() {
  return (
    <section id="access" className="relative mx-auto max-w-4xl scroll-mt-20 px-6 py-24">
      <Reveal className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">Getting in</div>
        <h2 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
          Seats go out in waves.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-zinc-400">
          There&apos;s no form and nothing to sign. We hand out seats to people who show up on X,
          and we add the wallets by hand. Everything is paper money for now, so the only thing
          you&apos;re risking is your ego.
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
            You need all three: <b className="text-lime-300">like, repost, comment your wallet</b>.
            We add them by hand, so give it a minute. The people getting in now are the ones who
            get to say they were here first.
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
