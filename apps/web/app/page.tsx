"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useBrandAsset } from "../lib/useBrandAsset";

/**
 * Pre-launch landing funnel: animated arena hero → what it is → how a round
 * works → trust pillars → beta signup (wallet whitelist for the paper beta).
 */

export default function Landing() {
  return (
    <div className="-mx-4 -my-6">
      <Hero />
      <HowItWorks />
      <Pillars />
      <Signup />
      <footer className="border-t border-zinc-800 px-6 py-8 text-center text-xs text-zinc-600">
        The Cookout · paper beta — simulated balances, no real funds at risk · the house only ever
        earns fees · <Link href="/docs" className="underline hover:text-zinc-400">docs</Link>
      </footer>
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
        {/* Mascot (real art: drop file at apps/web/public/brand/mascot.png) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mascotSrc}
          alt=""
          className="mx-auto mb-4 h-36 w-36 object-contain drop-shadow-[0_0_35px_rgba(163,230,53,0.45)] md:h-44 md:w-44"
        />
        <div className="mb-4 inline-block rounded-full border border-lime-400/40 bg-lime-400/10 px-4 py-1 text-xs font-bold tracking-widest text-lime-300">
          PAPER BETA — NOW TAKING SIGNUPS
        </div>
        <h1 className="text-5xl font-black tracking-tight md:text-8xl">
          <span className="text-lime-400">THE</span>{" "}
          <span className="text-zinc-50 [text-shadow:0_0_2px_#a3e635,0_0_18px_rgba(163,230,53,0.5)]">
            COOKOUT
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-300 md:text-xl">
          A live multiplayer trading arena where every match is a real token. Fair batch-auction
          opens. One clearing price for everyone. Rug or graduate in minutes —{" "}
          <span className="font-bold text-zinc-100">Twitch meets a trading terminal.</span>
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#beta"
            className="rounded-xl bg-lime-400 px-8 py-4 text-lg font-black text-zinc-950 shadow-lg shadow-lime-400/30 transition hover:scale-105 hover:bg-lime-300"
          >
            Join the Paper Beta
          </a>
          <Link
            href="/matches"
            className="rounded-xl border border-zinc-700 px-8 py-4 text-lg font-bold text-zinc-200 transition hover:border-zinc-500"
          >
            Watch a Live Round
          </Link>
        </div>
        <p className="mt-6 text-xs text-zinc-500">
          No deposits. No downloads. A wallet address is your whole identity.
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
    body: "A new token drops on the match calendar every few minutes. Hit the lobby, size up the crowd, make your Moon-or-Rug call.",
  },
  {
    icon: "⚖️",
    title: "Fair Open",
    body: "No sniping, no gas wars. Buy intents queue until a fixed close, then everyone settles at ONE clearing price — oversubscribed rounds fill pro-rata. Every settlement is auditable.",
  },
  {
    icon: "📈",
    title: "Trade Live",
    body: "Real trades, 1-second candles, kill feed, whales, and a chat losing its mind. Ride it, scalp it, or diamond-hand to the bell.",
  },
  {
    icon: "🎓",
    title: "Graduate or Burn",
    body: "Hit the bonding targets and the token graduates — an Arena Alumni that keeps trading. Fall short and everyone exits at one fair redemption price. Get rugged and… well, that's the game.",
  },
];

function HowItWorks() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <h2 className="text-center text-3xl font-black">A full launch. Every few minutes.</h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-sm text-zinc-400">
        Rounds run minutes, not weeks. Exposure is bounded, exits are guaranteed, and the open is
        provably fair.
      </p>
      <div className="mt-12 grid gap-6 md:grid-cols-4">
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            className="group relative rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 transition hover:-translate-y-1 hover:border-lime-400/50"
          >
            <div className="absolute -top-3 left-6 rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-400">
              {i + 1}
            </div>
            <div className="text-4xl transition group-hover:scale-110">{s.icon}</div>
            <h3 className="mt-3 text-lg font-black">{s.title}</h3>
            <p className="mt-2 text-sm text-zinc-400">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- trust pillars ---------------- */

const PILLARS = [
  ["🏦", "The house only earns fees", "Every pETH a player loses, another player won. We never touch principal — the fee schedule is published per round."],
  ["🔍", "Auditable by anyone", "Every auction settlement ships with a hash you can recompute from public intents using our open-source math."],
  ["🚫", "No pay-to-win. Ever.", "XP, levels, missions, cosmetics — all earned by playing. Nothing that affects gameplay is for sale."],
  ["🧱", "Template-only launches", "Creators supply a name, art, and supply. No creator mint, pause, or blacklist functions exist."],
];

function Pillars() {
  return (
    <section className="border-y border-zinc-800 bg-zinc-900/30 py-16">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 md:grid-cols-4">
        {PILLARS.map(([icon, title, body]) => (
          <div key={title} className="text-center">
            <div className="text-3xl">{icon}</div>
            <h3 className="mt-2 font-black">{title}</h3>
            <p className="mt-1 text-xs text-zinc-400">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- beta signup ---------------- */

function Signup() {
  const [address, setAddress] = useState("");
  const [handle, setHandle] = useState("");
  const [state, setState] = useState<"idle" | "done" | "already">("idle");
  const [error, setError] = useState("");
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    api<{ count: number }>("/api/beta/count")
      .then((d) => setCount(d.count))
      .catch(() => {});
  }, []);

  const submit = async () => {
    setError("");
    try {
      const res = await api<{ ok: boolean; already?: boolean; count: number }>("/api/beta/signup", {
        body: { address: address.trim(), xHandle: handle.trim() || undefined },
      });
      setState(res.already ? "already" : "done");
      setCount(res.count);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section id="beta" className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h2 className="text-4xl font-black">
        Get on the <span className="text-lime-400">whitelist</span>
      </h2>
      <p className="mt-3 text-zinc-400">
        No wallet connection needed — just paste your address (and optionally your X handle) to
        join the list for the paper beta. Simulated balances, real competition, zero risk. We&apos;ll
        open access at launch; beta windows announced on X.
      </p>
      {count !== null && count > 0 && (
        <p className="mt-2 font-mono text-sm text-lime-300">{count} wallets already in line</p>
      )}
      {state === "idle" ? (
        <div className="mt-8 space-y-3">
          <input
            placeholder="0x… your wallet address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-4 text-center font-mono text-sm outline-none transition focus:border-lime-400"
          />
          <input
            placeholder="@your_x_handle (optional)"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-5 py-4 text-center text-sm outline-none transition focus:border-lime-400"
          />
          <button
            onClick={() => void submit()}
            className="w-full rounded-xl bg-lime-400 px-6 py-4 text-lg font-black text-zinc-950 shadow-lg shadow-lime-400/25 transition hover:scale-[1.01] hover:bg-lime-300"
          >
            Save My Spot
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <p className="text-xs text-zinc-600">
            We store only the address you submit — sign-in later proves you own it.
          </p>
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-emerald-500/50 bg-emerald-500/10 p-8">
          <div className="text-4xl">🔥</div>
          <p className="mt-2 text-xl font-black text-emerald-300">
            {state === "already" ? "You were already in line." : "You're on the list."}
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Watch X for the beta window — then connect this wallet and pull up.
          </p>
          <Link href="/docs" className="mt-4 inline-block text-sm text-lime-400 underline">
            Read how the arena works →
          </Link>
        </div>
      )}
    </section>
  );
}
