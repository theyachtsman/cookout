"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useCopy } from "../lib/copy";
import { useBrandAsset } from "../lib/useBrandAsset";
import { useSession } from "../lib/session";

/**
 * The front door — a splash landing, deliberately short. It reads the product
 * in one glance: what it is, how a match works, the one rule that makes it fair,
 * and a way in. No demo mockups, no long narrative — players told us the old
 * home page had far too much on it.
 *
 * Open Beta: no whitelist, no deposit. "Play Now" opens Privy auth (email /
 * social / wallet) and drops you into a paper match (see session.tsx).
 */

const X_HANDLE = "@hoodcookout";

/** Primary call-to-action — opens the one-step Play Now onboarding. */
function PlayNowButton({ className = "", children }: { className?: string; children: React.ReactNode }) {
  const { promptPlayNow } = useSession();
  return (
    <button onClick={promptPlayNow} className={className}>
      {children}
    </button>
  );
}

export default function Landing() {
  return (
    <div className="-mx-4 -my-6">
      <Hero />
      <LiveNow />
      <RoundFlow />
      <FairOpen />
      <Access />
      {/* The shared SiteFooter (Telegram + house links) is rendered site-wide
          from the root layout, so the landing page doesn't need its own. */}
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

/** The product in six words. */
function Slogan({ className = "" }: { className?: string }) {
  const { t } = useCopy();
  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 font-black tracking-tight ${className}`}
    >
      <span className="text-zinc-100">{t("landing.slogan.a")}</span>
      <span className="text-emerald-400">{t("landing.slogan.b")}</span>
      <span className="text-lime-400">{t("landing.slogan.c")}</span>
    </div>
  );
}

/* ---------------- hero with animated candle-field canvas ---------------- */

function Hero() {
  const { t } = useCopy();
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
      <div className="relative mx-auto max-w-4xl px-6 pb-20 pt-20 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mascotSrc}
          alt=""
          className="mx-auto mb-4 h-36 w-36 object-contain drop-shadow-[0_0_35px_rgba(163,230,53,0.45)] md:h-44 md:w-44"
        />
        <span className="mb-5 inline-flex items-center gap-2 rounded-full bg-lime-400/10 px-4 py-1 text-xs font-bold tracking-widest text-lime-300 ring-1 ring-lime-400/30">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-lime-400" />
          </span>
          {t("landing.badge")}
        </span>
        <h1 className="text-5xl font-black tracking-tight md:text-8xl">
          <span className="text-lime-400">{t("landing.hero.titleA")}</span>{" "}
          <span className="text-zinc-50 [text-shadow:0_0_2px_#a3e635,0_0_18px_rgba(163,230,53,0.5)]">
            {t("landing.hero.titleB")}
          </span>
        </h1>
        <p className="mx-auto mt-4 text-2xl font-black tracking-tight text-zinc-50 md:text-4xl">
          {t("landing.hero.headline")}
        </p>
        <p className="mx-auto mt-3 max-w-xl text-base text-zinc-400 md:text-lg">
          {t("landing.hero.sub")}
        </p>

        {/* the promise, readable in one glance */}
        <div className="mx-auto mt-7 flex max-w-2xl flex-wrap items-center justify-center gap-2.5">
          {[1, 2, 3, 4].map((n) => t(`landing.hero.promise${n}`)).map((p) => (
            <span
              key={p}
              className="rounded-full bg-emerald-400/10 px-4 py-1.5 text-sm font-black text-emerald-300 ring-1 ring-emerald-400/30 md:text-base"
            >
              {p}
            </span>
          ))}
        </div>
        <Slogan className="mt-6 text-xl md:text-3xl" />

        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <PlayNowButton className="rounded-xl bg-lime-400 px-8 py-4 text-lg font-black text-zinc-950 shadow-lg shadow-lime-400/30 transition hover:scale-105 hover:bg-lime-300">
            {t("landing.hero.ctaPlay")}
          </PlayNowButton>
          <Link
            href="/matches"
            className="rounded-xl bg-zinc-800/70 px-8 py-4 text-lg font-bold text-zinc-200 transition hover:bg-zinc-800"
          >
            {t("landing.hero.ctaWatch")}
          </Link>
        </div>
        <div className="mx-auto mt-7 inline-flex max-w-xl items-center gap-3 rounded-xl bg-lime-400/[0.06] px-5 py-2.5 ring-1 ring-lime-400/20">
          <span className="text-xl">🎮</span>
          <p className="text-left text-sm text-zinc-200">
            <span className="font-black text-lime-300">{t("landing.hero.noteTitle")}</span>{" "}
            {t("landing.hero.noteBody")}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------------- the room, right now ---------------- */

/**
 * A pulse under the hero. Player count, pot, and matches are real when the
 * API answers; the ticker is flavor from actual round events. Nothing here
 * is load-bearing, so a cold API just shows fewer numbers.
 */
function LiveNow() {
  const { t, lines } = useCopy();
  const tickerLines = lines("landing.ticker");
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
    if (tickerLines.length === 0) return;
    const id = setInterval(() => setLine((n) => (n + 1) % tickerLines.length), 3400);
    return () => clearInterval(id);
  }, [tickerLines.length]);

  const stats: Array<[string, string]> = [
    [t("landing.stats.online"), online === null ? "—" : String(online)],
    [t("landing.stats.pot"), pot === null ? "—" : `$${Math.round(pot).toLocaleString()}`],
    [t("landing.stats.matches"), matches === null ? "—" : String(matches)],
    [t("landing.stats.lengthLabel"), t("landing.stats.lengthValue")],
  ];

  return (
    <section className="bg-zinc-900/30">
      <div className="mx-auto max-w-5xl px-6 py-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map(([k, v]) => (
            <div key={k} className="text-center">
              <div className="font-mono text-2xl font-black text-lime-300">{v}</div>
              <div className="text-[11px] uppercase tracking-wide text-zinc-500">{k}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-center gap-2 pt-3">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lime-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-lime-400" />
          </span>
          <span key={line} className="animate-[fadein_.4s_ease] truncate text-sm text-zinc-400">
            {tickerLines[line % Math.max(1, tickerLines.length)]}
          </span>
        </div>
      </div>
    </section>
  );
}

/* ---------------- how a round works ---------------- */

function RoundFlow() {
  const { t } = useCopy();
  const steps = [
    { icon: "🚪", key: "step1" },
    { icon: "⚖️", key: "step2" },
    { icon: "📈", key: "step3" },
    { icon: "🎓", key: "step4" },
  ];
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <Reveal>
        <h2 className="text-center text-4xl font-black tracking-tight md:text-5xl">
          {t("landing.flow.title")}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-zinc-400">
          {t("landing.flow.sub")}
        </p>
      </Reveal>
      <div className="mt-12 grid gap-6 md:grid-cols-4">
        {steps.map((s, i) => (
          <Reveal key={s.key} delay={i * 90}>
            <div className="group h-full rounded-2xl bg-zinc-900/40 p-6 transition hover:-translate-y-1 hover:bg-zinc-900/70">
              <div className="text-4xl transition group-hover:scale-110">{s.icon}</div>
              <h3 className="mt-3 text-lg font-black">{t(`landing.flow.${s.key}.title`)}</h3>
              <p className="mt-2 text-sm text-zinc-400">{t(`landing.flow.${s.key}.body`)}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ---------------- the fair open (differentiator band) ---------------- */

function FairOpen() {
  const { t } = useCopy();
  return (
    <section className="bg-gradient-to-b from-emerald-500/[0.06] to-transparent py-20">
      <div className="mx-auto max-w-3xl px-6">
        <Reveal className="text-center">
          <div className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-400">
            {t("landing.fair.eyebrow")}
          </div>
          <h2 className="mt-3 text-4xl font-black tracking-tight md:text-6xl">
            {t("landing.fair.title")}
          </h2>
          <Slogan className="mt-6 text-2xl md:text-4xl" />
          <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-300">
            {t("landing.fair.body")}
          </p>
          <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-500">
            <Link href="/docs#auction" className="text-emerald-400 underline hover:text-emerald-300">
              {t("landing.fair.link")}
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- open beta: just play ---------------- */

function Access() {
  const { t, fmt } = useCopy();
  const steps = [
    { icon: "🎮", key: "step1" },
    { icon: "⚡", key: "step2" },
    { icon: "🔥", key: "step3" },
  ];
  return (
    <section id="access" className="relative mx-auto max-w-4xl scroll-mt-20 px-6 py-24">
      <Reveal className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">{t("landing.access.eyebrow")}</div>
        <h2 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
          {t("landing.access.title")}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-zinc-400">
          {t("landing.access.body")}
        </p>
      </Reveal>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <Reveal key={s.key} delay={i * 80}>
            <div className="h-full rounded-2xl bg-zinc-900/40 p-5 transition hover:bg-zinc-900/70">
              <div className="text-3xl">{s.icon}</div>
              <h3 className="mt-2 font-black">{t(`landing.access.${s.key}.title`)}</h3>
              <p className="mt-1 text-sm text-zinc-400">{t(`landing.access.${s.key}.body`)}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-10 text-center">
        <div className="rounded-2xl bg-lime-400/[0.06] p-8">
          <PlayNowButton className="inline-flex items-center gap-2 rounded-xl bg-lime-400 px-10 py-4 text-xl font-black text-zinc-950 shadow-lg shadow-lime-400/30 transition hover:scale-105 hover:bg-lime-300">
            {t("landing.access.cta")}
          </PlayNowButton>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
            {[1, 2, 3, 4].map((n) => t(`landing.access.chip${n}`)).map((p) => (
              <span
                key={p}
                className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-300"
              >
                {p}
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs text-zinc-600">
            {fmt("landing.access.safety", { handle: X_HANDLE })}
          </p>
        </div>
      </Reveal>
    </section>
  );
}
