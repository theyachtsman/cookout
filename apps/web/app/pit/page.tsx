"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  PIT_AI_NAME,
  PIT_DURATION_MAP,
  PIT_DURATIONS,
  PIT_ROOM,
  marketCap,
  type PitDurationKey,
} from "@cookout/shared";
import type { GoonOverlayEvent } from "@cookout/shared";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useSocial } from "../../lib/social";
import { useRoundSocket } from "../../lib/useRoundSocket";
import type { PitCard, PitFeed } from "../../lib/pit";
import { fmtVal } from "../../lib/pit";
import { Countdown } from "../../components/Countdown";
import { ImagePicker } from "../../components/ImagePicker";
import { RunItBack } from "../../components/PitResults";
import { GoonOverlayLayer, useGoonOverlays } from "../../components/GoonOverlay";

type Fmt = (eth: number) => string;

function DurationChip({ k }: { k: string }) {
  const d = PIT_DURATION_MAP[k as PitDurationKey];
  if (!d) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold text-zinc-300">
      {d.icon} {d.name} · {d.minutes}m
    </span>
  );
}

/** Open X's composer to promote a Pit match while it fills. */
function shillPit(c: PitCard) {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${base}/coin/${c.round.conceptId}`;
  const text =
    `🕳️ $${c.round.token.symbol} just dropped into The Pit.\n` +
    `Predict the outcome or Battle the Flame Goon Squad AI. Beat the Goons and split the pool 🔥`;
  window.open(
    `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

function outcomeLabel(o?: string): { text: string; cls: string } {
  if (o === "graduate") return { text: "Graduated", cls: "text-lime-300" };
  if (o === "rug") return { text: "Rugged", cls: "text-red-400" };
  return { text: "Timer", cls: "text-zinc-300" };
}

function Card({ c, me, fmt }: { c: PitCard; me?: string; fmt: Fmt }) {
  const r = c.round;
  const live = r.state === "live";
  const lobby = r.state === "lobby";
  const done = r.state === "results";
  const mine = !!me && r.creatorAddress.toLowerCase() === me;
  const armed = lobby && !!r.queueOpensAt;
  const waiting = lobby && !r.queueOpensAt;
  const pit = c.summary?.pit;
  const predMode = r.pit?.predictionMode ?? true;
  const tradeMode = r.pit?.tradingMode ?? true;

  return (
    <div className="group/card flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl bg-zinc-900/40 ring-1 ring-white/10 transition hover:ring-white/20">
      <Link href={`/pit/${r.id}`} className="block">
        <div className="relative h-24 w-full overflow-hidden bg-zinc-800/60">
          {r.token.bannerUrl || r.token.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.token.bannerUrl ?? r.token.artworkUrl}
              alt=""
              className="h-full w-full object-cover opacity-90 transition duration-300 group-hover/card:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-3xl">🕳️</div>
          )}
          {live && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-black uppercase text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
            </span>
          )}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/pit/${r.id}`} className="min-w-0">
            <div className="truncate text-sm font-black text-zinc-50">{r.token.name}</div>
            <div className="font-mono text-[11px] text-zinc-500">${r.token.symbol}</div>
          </Link>
          <DurationChip k={r.pit?.duration ?? "standard"} />
        </div>

        {/* Mode chips */}
        <div className="flex flex-wrap gap-1">
          {predMode && (
            <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-300">🔮 Prediction</span>
          )}
          {tradeMode && (
            <span className="rounded-full bg-lime-500/10 px-2 py-0.5 text-[10px] font-bold text-lime-300">⚔️ Goon Squad</span>
          )}
          {r.pit?.trialMode && (
            <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-orange-300">🔥 Flame Trial · Solo</span>
          )}
        </div>

        {done && pit ? (
          <div className="mt-auto space-y-1 text-xs">
            <div className={`font-black ${outcomeLabel(pit.outcome).cls}`}>{outcomeLabel(pit.outcome).text}</div>
            <div className="text-zinc-500">
              {[predMode && `${pit.prediction.winners} prediction`, tradeMode && `${pit.trading.qualified} trading`]
                .filter(Boolean)
                .join(" · ")}{" "}
              winner{pit.prediction.winners + pit.trading.qualified === 1 ? "" : "s"}
            </div>
          </div>
        ) : (
          <div className="mt-auto space-y-1">
            {predMode && <PoolLine label="Prediction pool" pot={c.prediction.pot} fmt={fmt} />}
            {tradeMode && <PoolLine label="Trading pool" pot={c.trading.pot} fmt={fmt} />}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-white/5 pt-2 text-[11px]">
          {live && r.endsAt ? (
            <>
              <span className="font-mono text-zinc-400">mc {r.pool ? marketCap(r.pool).toFixed(2) : "0"}</span>
              <span className="font-mono font-bold text-lime-300">
                <Countdown to={r.endsAt} />
              </span>
            </>
          ) : armed && r.queueOpensAt ? (
            <>
              <span className="text-zinc-500">Goes live in</span>
              <span className="font-mono font-bold text-lime-300">
                <Countdown to={r.queueOpensAt} />
              </span>
            </>
          ) : waiting ? (
            <>
              <span className="text-amber-300">
                {r.pit?.trialMode ? "Waiting for the creator" : "Filling the queue"}
              </span>
              {r.pit?.queueMaxSeconds ? (
                <span className="font-mono font-bold text-amber-300">
                  <Countdown to={r.scheduledAt + r.pit.queueMaxSeconds * 1000} />
                </span>
              ) : null}
            </>
          ) : done ? (
            <span className="text-zinc-500">View results</span>
          ) : (
            <span className="text-zinc-500">Queued for a live slot</span>
          )}
        </div>

        {(lobby || live) && (
          <div className="flex gap-2">
            <Link
              href={`/pit/${r.id}`}
              className="flex-1 rounded-lg bg-lime-400 px-3 py-1.5 text-center text-xs font-black text-zinc-950 transition hover:bg-lime-300"
            >
              {live ? "Trade" : "Enter"}
            </Link>
            <button
              type="button"
              onClick={() => shillPit(c)}
              title="Post to X"
              className="rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-black text-sky-300 transition hover:bg-sky-500/25 active:scale-95"
            >
              𝕏
            </button>
          </div>
        )}
        {done && mine && (
          <div className="flex">
            <RunItBack round={r} compact />
          </div>
        )}
      </div>
    </div>
  );
}

function PoolLine({ label, pot, fmt }: { label: string; pot: number; fmt: Fmt }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="font-mono text-sm font-black text-zinc-100">{fmt(pot)}</span>
    </div>
  );
}

function Shelf({ title, cards, empty, me, fmt }: { title: string; cards: PitCard[]; empty: string; me?: string; fmt: Fmt }) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const updateEdges = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);

  // Vertical mouse-wheel scrolls the rail horizontally; arrows do the same on tap.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateEdges();
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", updateEdges, { passive: true });
    window.addEventListener("resize", updateEdges);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", updateEdges);
      window.removeEventListener("resize", updateEdges);
    };
  }, [cards.length, updateEdges]);

  // Click = a big paged jump; hovering an arrow (below) scrolls continuously.
  const nudge = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  const step = useCallback((dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollLeft += dir * 14;
  }, []);

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-zinc-400">
        {title}
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold text-zinc-400">{cards.length}</span>
      </h2>
      {cards.length === 0 ? (
        <div className="rounded-2xl bg-zinc-900/40 p-5 text-center text-xs text-zinc-600">{empty}</div>
      ) : (
        <div className="relative">
          <Arrow dir="left" hidden={atStart} onNudge={() => nudge(-1)} step={step} />
          <div ref={ref} className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
            {cards.map((c) => (
              <Card key={c.round.id} c={c} me={me} fmt={fmt} />
            ))}
          </div>
          <Arrow dir="right" hidden={atEnd} onNudge={() => nudge(1)} step={step} />
        </div>
      )}
    </section>
  );
}

/**
 * A round scroll button pinned to one edge of a carousel; hides at the end.
 * Click pages a big jump; holding the mouse over it scrolls the rail
 * continuously (auto-repeat) so you can glide to the far end without clicking.
 */
function Arrow({
  dir,
  hidden,
  onNudge,
  step,
}: {
  dir: "left" | "right";
  hidden: boolean;
  onNudge: () => void;
  step: (dir: 1 | -1) => void;
}) {
  const [hovering, setHovering] = useState(false);
  const stepDir: 1 | -1 = dir === "left" ? -1 : 1;
  useEffect(() => {
    if (!hovering || hidden) return;
    const id = window.setInterval(() => step(stepDir), 16);
    return () => window.clearInterval(id);
  }, [hovering, hidden, step, stepDir]);
  return (
    <button
      type="button"
      onClick={onNudge}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      aria-label={dir === "left" ? "Scroll left" : "Scroll right"}
      className={`absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-zinc-950/80 text-lg font-black text-zinc-100 ring-1 ring-white/15 backdrop-blur transition hover:bg-zinc-800 ${
        dir === "left" ? "left-0 -translate-x-1" : "right-0 translate-x-1"
      } ${hidden ? "pointer-events-none opacity-0" : "opacity-90"}`}
    >
      {dir === "left" ? "‹" : "›"}
    </button>
  );
}

function ModePick({ on, onToggle, icon, name, blurb, accent, disabled, disabledNote }: { on: boolean; onToggle: () => void; icon: string; name: string; blurb: string; accent: "sky" | "lime" | "orange"; disabled?: boolean; disabledNote?: string }) {
  const onBg = accent === "sky" ? "bg-sky-500/15 ring-sky-400/50" : accent === "lime" ? "bg-lime-500/15 ring-lime-400/50" : "bg-orange-500/15 ring-orange-400/50";
  const dot = accent === "sky" ? "bg-sky-400" : accent === "lime" ? "bg-lime-400" : "bg-orange-400";
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1 transition ${
        disabled ? "cursor-not-allowed bg-zinc-900/30 opacity-40 ring-white/5" : on ? onBg : "bg-zinc-900/60 ring-white/10 hover:ring-white/25"
      }`}
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${on ? `${dot} text-zinc-950` : "bg-zinc-700 text-zinc-300"}`}>
        {on ? "✓" : "+"}
      </span>
      <span className="flex-1">
        <span className="text-sm font-black text-zinc-100">
          {icon} {name}
        </span>
        <span className="block text-[11px] text-zinc-500">{disabled && disabledNote ? disabledNote : blurb}</span>
      </span>
    </button>
  );
}

function LaunchPitModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", symbol: "", theme: "", bannerUrl: "" });
  const [duration, setDuration] = useState<PitDurationKey>("standard");
  const [modes, setModes] = useState({ prediction: true, trading: true, trial: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!form.name.trim() || !form.symbol.trim() || !form.theme.trim()) {
      setError("Name, ticker, and theme are required.");
      return;
    }
    if (!modes.prediction && !modes.trading && !modes.trial) {
      setError("Pick at least one game mode.");
      return;
    }
    setBusy(true);
    try {
      const { round } = await api<{ round: { id: string } }>("/api/pit/launch", {
        body: {
          name: form.name,
          symbol: form.symbol,
          theme: form.theme,
          bannerUrl: form.bannerUrl || undefined,
          duration,
          modes,
        },
      });
      router.push(`/pit/${round.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div onClick={() => !busy && onClose()} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-zinc-950 p-5 ring-1 ring-white/10 sm:p-6">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-lime-300">Powered by {PIT_AI_NAME}</div>
        <h2 className="mt-1 text-xl font-black text-zinc-50">Launch a Pit match</h2>
        <p className="mt-1 text-xs text-zinc-500">
          No vote. It drops into the queue for deposits and goes live 60s after each pool has two bets.
          If it doesn&apos;t fill within 10 minutes it&apos;s cancelled and deposits refunded.
        </p>

        <div className="mt-4 space-y-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Coin name"
            className="w-full rounded-xl bg-zinc-900/60 px-3 py-2.5 text-sm outline-none ring-1 ring-white/10 focus:ring-lime-400/50"
          />
          <input
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase().slice(0, 8) })}
            placeholder="TICKER"
            className="w-full rounded-xl bg-zinc-900/60 px-3 py-2.5 font-mono text-sm outline-none ring-1 ring-white/10 focus:ring-lime-400/50"
          />
          <textarea
            value={form.theme}
            onChange={(e) => setForm({ ...form, theme: e.target.value.slice(0, 140) })}
            placeholder="Theme (one line)"
            rows={2}
            className="w-full rounded-xl bg-zinc-900/60 px-3 py-2.5 text-sm outline-none ring-1 ring-white/10 focus:ring-lime-400/50"
          />
          <div>
            <div className="mb-1 text-xs text-zinc-500">Match card banner</div>
            <ImagePicker
              label="Banner"
              wide
              size={1024}
              value={form.bannerUrl || undefined}
              onChange={(dataUrl) => setForm({ ...form, bannerUrl: dataUrl })}
            />
          </div>

          {/* Game modes */}
          <div>
            <div className="mb-1.5 text-xs text-zinc-500">Game modes · pick one or more</div>
            <div className="space-y-2">
              <ModePick
                on={modes.prediction}
                onToggle={() => setModes((m) => ({ ...m, prediction: !m.prediction }))}
                icon="🔮"
                name="Prediction"
                blurb="Players bet on the outcome: Graduate, Rug, Timer, or House Special."
                accent="sky"
              />
              <ModePick
                on={modes.trading}
                onToggle={() => setModes((m) => ({ ...m, trading: !m.trading, trial: !m.trading ? false : m.trial }))}
                icon="⚔️"
                name="Battle the Flame Goon Squad AI"
                blurb="Players trade a paper stack against the Goon Squad. Highest PnL wins the pool."
                accent="lime"
                disabled={modes.trial}
                disabledNote="Not available with Flame Trial. Flame Trial is solo."
              />
              <ModePick
                on={modes.trial}
                onToggle={() => setModes((m) => ({ ...m, trial: !m.trial, trading: !m.trial ? false : m.trading }))}
                icon="🔥"
                name="Flame Trial (single-player)"
                blurb="Solo PvE. Only you play: stake the coin and beat a PnL objective vs the Goons. Pass and your stake comes back plus XP, titles and badges; miss it and the stake is gone. A bigger stake means a higher bar. Starts on a short countdown once you stake. Pairs with Prediction only."
                accent="orange"
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs text-zinc-500">Duration</div>
            <div className="grid grid-cols-3 gap-2">
              {PIT_DURATIONS.map((d) => (
                <button
                  key={d.key}
                  onClick={() => setDuration(d.key)}
                  className={`rounded-xl p-2.5 text-center ring-1 transition ${
                    duration === d.key
                      ? "bg-lime-500/15 ring-lime-400/50"
                      : "bg-zinc-900/60 ring-white/10 hover:ring-white/25"
                  }`}
                >
                  <div className="text-lg">{d.icon}</div>
                  <div className="text-xs font-black text-zinc-100">{d.name}</div>
                  <div className="text-[10px] text-zinc-500">{d.minutes}m</div>
                </button>
              ))}
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-xl bg-zinc-800 py-2.5 text-sm font-bold text-zinc-300 hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 rounded-xl bg-lime-400 py-2.5 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-40"
            >
              {busy ? "Launching…" : "Enter The Pit →"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Explains how each Pit mode pays out, so a player knows what to expect from a
 *  bet before they place it. Mechanics are fixed; exact fee/splits are set by the
 *  house (admin), so this describes the shape and works a plain example. */
function PayoutInfoModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div onClick={onClose} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-zinc-950 p-5 ring-1 ring-white/10 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-lime-300">What you can win</div>
            <h2 className="mt-1 text-xl font-black text-zinc-50">Payout expectations</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {/* Prediction Market */}
          <div className="rounded-2xl bg-sky-500/[0.07] p-4 ring-1 ring-sky-400/20">
            <div className="text-sm font-black text-sky-300">🔮 Prediction Market</div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">
              Every bet pools together. When the round ends, the Pit skims a small house fee and the rest is
              split among the <span className="font-bold text-zinc-100">correct callers, pro-rata to their wager</span>{" "}
              — the bigger your bet, the bigger your slice. Two ways to stack more on top:
            </p>
            <ul className="mt-2 space-y-1 text-xs text-zinc-400">
              <li>
                <span className="font-bold text-zinc-200">House Special</span> — a rotating bonus condition. Call it
                right and everyone who did splits that side bucket.
              </li>
              <li>
                <span className="font-bold text-zinc-200">Double Down</span> — nail the main call{" "}
                <span className="italic">and</span> the House Special for a bonus on top.
              </li>
            </ul>
            <div className="mt-2 rounded-lg bg-zinc-900/60 p-2.5 text-[11px] text-zinc-400">
              <span className="font-bold text-sky-300">Example:</span> the pool is $100 and you put up $10 of the $40
              that called Graduate. It graduates → after the fee you take ~25% of the pot (your share of the winning
              side). Nobody calls it right? The pot rolls into the Weekly Jackpot.
            </div>
          </div>

          {/* Battle the Goon Squad */}
          <div className="rounded-2xl bg-lime-500/[0.07] p-4 ring-1 ring-lime-400/20">
            <div className="text-sm font-black text-lime-300">⚔️ Battle the Flame Goon Squad</div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">
              Everyone buys in and gets the <span className="font-bold text-zinc-100">same paper stack</span> to trade
              against the AI market. The <span className="font-bold text-zinc-100">highest PnL at the buzzer takes the
              entire trading pool</span> (ties split it evenly). Read the pump, dodge the rug, exit on top.
            </p>
          </div>

          {/* Flame Trial */}
          <div className="rounded-2xl bg-orange-500/[0.07] p-4 ring-1 ring-orange-400/20">
            <div className="text-sm font-black text-orange-300">🔥 Flame Trial · solo</div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">
              One player, one stake, one target. Stake the coin and finish at or above your tier&apos;s PnL bar.{" "}
              <span className="font-bold text-lime-300">Pass and your stake comes back in full</span>, plus the tier&apos;s
              XP, titles, and badges. <span className="font-bold text-red-400">Miss the bar and the stake is gone.</span>{" "}
              A bigger stake means a higher bar — and rarer rewards. It never pays out cash: the flex is the progression.
            </p>
          </div>

          <p className="text-center text-[11px] text-zinc-600">
            Exact fees, splits, and bonuses are set by the house and shown on each match before you bet.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface JackpotInfo {
  poolEth: number;
  poolUsd: number;
  ethUsd: number;
}

export default function PitPage() {
  const { profile, signIn } = useSession();
  const { setActiveRoom } = useSocial();
  const me = profile?.address?.toLowerCase();
  const [data, setData] = useState<PitFeed | null>(null);
  const [jackpot, setJackpot] = useState<JackpotInfo | null>(null);
  const [usd, setUsd] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  // The Grill dock follows you into The Pit's own channel on this page.
  useEffect(() => {
    setActiveRoom({ id: PIT_ROOM, label: "The Pit" });
    return () => setActiveRoom(null);
  }, [setActiveRoom]);
  useEffect(() => {
    const load = () => {
      api<PitFeed>("/api/pit").then(setData).catch(() => {});
      api<JackpotInfo>("/api/jackpot").then(setJackpot).catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const ethUsd = jackpot?.ethUsd ?? 0;
  const fmt: Fmt = (eth) => fmtVal(eth, usd, ethUsd);

  // Flame Goon Squad cinematic moments in the general Pit room.
  const { overlays, push } = useGoonOverlays();
  useRoundSocket(PIT_ROOM, (ev) => {
    if (ev.type === "goon_overlay") push(ev.overlay as GoonOverlayEvent);
  });

  return (
    <div className="space-y-7">
      <GoonOverlayLayer overlays={overlays} />
      <header className="rounded-3xl bg-gradient-to-br from-lime-500/10 via-zinc-900/40 to-zinc-950 p-6 ring-1 ring-white/10 sm:p-8">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-lime-300">
            Powered by {PIT_AI_NAME}
          </div>
          <h1 className="mt-1 text-3xl font-black text-zinc-50 sm:text-4xl">The Pit</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-300">
            This is where you prove it. Step into the <span className="font-bold text-sky-300">Prediction Market</span>{" "}
            and call it — Graduate, Rug, or Timer — then stack the House Special and Double Down for the big score.
            Think you can out-trade the machine? <span className="font-bold text-lime-300">Battle the Flame Goon Squad</span>{" "}
            head to head and take the whole pool. Or go it alone in the{" "}
            <span className="font-bold text-orange-300">Flame Trial</span>: one player, one stake, one PnL target —
            clear the bar and walk away with your stake plus XP, titles, and badges. Read the market. Beat the Goons.
            Own The Pit.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => (profile ? setLaunching(true) : signIn())}
            className="rounded-xl bg-lime-400 px-4 py-2 text-sm font-black text-zinc-950 transition hover:bg-lime-300"
          >
            Launch a Pit match
          </button>
          <button
            onClick={() => setPayoutOpen(true)}
            className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold text-zinc-200 ring-1 ring-white/10 transition hover:bg-zinc-700"
          >
            💰 Payout expectations
          </button>
        </div>
      </header>

      {/* Denomination toggle lives above the live row, pinned right — out of the
          hero so it doesn't crowd the pitch. */}
      <div className="flex items-center justify-end">
        <div className="flex overflow-hidden rounded-full bg-zinc-900/70 text-[10px] font-bold ring-1 ring-white/10">
          {(["usd", "peth"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setUsd(k === "usd")}
              className={`px-3 py-1.5 ${(usd ? "usd" : "peth") === k ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              {k === "usd" ? "USD" : "pETH"}
            </button>
          ))}
        </div>
      </div>

      <Shelf title="Live Matches" cards={data?.live ?? []} empty="No live Pit matches right now. Launch one." me={me} fmt={fmt} />
      <Shelf
        title="Queue"
        cards={[...(data?.lobby ?? []), ...(data?.queue ?? [])]}
        empty="Nothing in the queue. Launch a match to open one."
        me={me}
        fmt={fmt}
      />
      <Shelf title="Recent Results" cards={data?.results ?? []} empty="No finished Pit matches yet." me={me} fmt={fmt} />

      {mounted && launching && <LaunchPitModal onClose={() => setLaunching(false)} />}
      {mounted && payoutOpen && <PayoutInfoModal onClose={() => setPayoutOpen(false)} />}
    </div>
  );
}
