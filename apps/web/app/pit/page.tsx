"use client";

import { useEffect, useRef, useState } from "react";
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
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useSocial } from "../../lib/social";
import type { PitCard, PitFeed } from "../../lib/pit";
import { fmtVal } from "../../lib/pit";
import { Countdown } from "../../components/Countdown";
import { ImagePicker } from "../../components/ImagePicker";
import { RunItBack } from "../../components/PitResults";

type Fmt = (eth: number) => string;

function DurationChip({ k }: { k: string }) {
  const d = PIT_DURATION_MAP[k as PitDurationKey];
  if (!d) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[11px] font-bold text-fuchsia-300">
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
    <div className="group flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl bg-zinc-900/40 ring-1 ring-white/10 transition hover:ring-white/20">
      <Link href={`/pit/${r.id}`} className="block">
        <div className="relative h-24 w-full overflow-hidden bg-zinc-800/60">
          {r.token.bannerUrl || r.token.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.token.bannerUrl ?? r.token.artworkUrl}
              alt=""
              className="h-full w-full object-cover opacity-90 transition group-hover:scale-105"
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
            <span className="rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-bold text-fuchsia-300">🔮 Prediction</span>
          )}
          {tradeMode && (
            <span className="rounded-full bg-lime-500/10 px-2 py-0.5 text-[10px] font-bold text-lime-300">⚔️ Goon Squad</span>
          )}
          {r.pit?.trialMode && (
            <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-orange-300">🔥 Flame Trial</span>
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
              <span className="font-mono font-bold text-fuchsia-300">
                <Countdown to={r.queueOpensAt} />
              </span>
            </>
          ) : waiting ? (
            <span className="text-amber-300">Filling — needs 2 bets per pool</span>
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
              className="flex-1 rounded-lg bg-fuchsia-500 px-3 py-1.5 text-center text-xs font-black text-zinc-950 transition hover:bg-fuchsia-400"
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
  // Vertical mouse-wheel scrolls the rail horizontally (no arrows needed).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [cards.length]);

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-zinc-400">
        {title}
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold text-zinc-400">{cards.length}</span>
      </h2>
      {cards.length === 0 ? (
        <div className="rounded-2xl bg-zinc-900/40 p-5 text-center text-xs text-zinc-600">{empty}</div>
      ) : (
        <div ref={ref} className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {cards.map((c) => (
            <Card key={c.round.id} c={c} me={me} fmt={fmt} />
          ))}
        </div>
      )}
    </section>
  );
}

function ModePick({ on, onToggle, icon, name, blurb, accent }: { on: boolean; onToggle: () => void; icon: string; name: string; blurb: string; accent: "fuchsia" | "lime" | "orange" }) {
  const onBg = accent === "fuchsia" ? "bg-fuchsia-500/15 ring-fuchsia-400/50" : accent === "lime" ? "bg-lime-500/15 ring-lime-400/50" : "bg-orange-500/15 ring-orange-400/50";
  const dot = accent === "fuchsia" ? "bg-fuchsia-400" : accent === "lime" ? "bg-lime-400" : "bg-orange-400";
  return (
    <button
      onClick={onToggle}
      className={`flex w-full items-start gap-3 rounded-xl p-3 text-left ring-1 transition ${
        on ? onBg : "bg-zinc-900/60 ring-white/10 hover:ring-white/25"
      }`}
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${on ? `${dot} text-zinc-950` : "bg-zinc-700 text-zinc-300"}`}>
        {on ? "✓" : "+"}
      </span>
      <span className="flex-1">
        <span className="text-sm font-black text-zinc-100">
          {icon} {name}
        </span>
        <span className="block text-[11px] text-zinc-500">{blurb}</span>
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
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-fuchsia-300">Powered by {PIT_AI_NAME}</div>
        <h2 className="mt-1 text-xl font-black text-zinc-50">Launch a Pit match</h2>
        <p className="mt-1 text-xs text-zinc-500">
          No vote. It opens a lobby the moment you launch and goes live once each pool has two bets.
        </p>

        <div className="mt-4 space-y-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Coin name"
            className="w-full rounded-xl bg-zinc-900/60 px-3 py-2.5 text-sm outline-none ring-1 ring-white/10 focus:ring-fuchsia-400/50"
          />
          <input
            value={form.symbol}
            onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase().slice(0, 8) })}
            placeholder="TICKER"
            className="w-full rounded-xl bg-zinc-900/60 px-3 py-2.5 font-mono text-sm outline-none ring-1 ring-white/10 focus:ring-fuchsia-400/50"
          />
          <textarea
            value={form.theme}
            onChange={(e) => setForm({ ...form, theme: e.target.value.slice(0, 140) })}
            placeholder="Theme (one line)"
            rows={2}
            className="w-full rounded-xl bg-zinc-900/60 px-3 py-2.5 text-sm outline-none ring-1 ring-white/10 focus:ring-fuchsia-400/50"
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
                accent="fuchsia"
              />
              <ModePick
                on={modes.trading}
                onToggle={() => setModes((m) => ({ ...m, trading: !m.trading }))}
                icon="⚔️"
                name="Battle the Flame Goon Squad AI"
                blurb="Players trade a paper stack against the Goon Squad. Highest PnL wins the pool."
                accent="lime"
              />
              <ModePick
                on={modes.trial}
                onToggle={() => setModes((m) => ({ ...m, trial: !m.trial }))}
                icon="🔥"
                name="Flame Trial"
                blurb="Solo PvE: beat an objective (+20% PnL) vs the Goons for XP, titles, badges. Starts with one player."
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
                      ? "bg-fuchsia-500/15 ring-fuchsia-400/50"
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
              className="flex-1 rounded-xl bg-fuchsia-500 py-2.5 text-sm font-black text-zinc-950 hover:bg-fuchsia-400 disabled:opacity-40"
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

  return (
    <div className="space-y-7">
      <header className="rounded-3xl bg-gradient-to-br from-fuchsia-500/15 via-zinc-900/40 to-zinc-950 p-6 ring-1 ring-white/10 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-fuchsia-300">
              Powered by {PIT_AI_NAME}
            </div>
            <h1 className="mt-1 text-3xl font-black text-zinc-50 sm:text-4xl">The Pit</h1>
            <p className="mt-2 max-w-xl text-sm text-zinc-400">
              You versus The Flame Goon Squad. Call the outcome, or trade a paper stack against an adaptive
              AI market. Beat the Goons and take the pools.
            </p>
          </div>
          {/* Weekly jackpot — right side, full amount. Unclaimed Pit pools feed it. */}
          <div className="shrink-0 rounded-2xl bg-amber-500/10 px-4 py-3 text-right ring-1 ring-amber-500/30 sm:min-w-[190px]">
            <div className="text-[10px] font-black uppercase tracking-wide text-amber-300/80">Weekly Jackpot</div>
            <div className="font-mono text-2xl font-black text-amber-200">
              {jackpot ? `$${jackpot.poolUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "…"}
            </div>
            <div className="font-mono text-[11px] text-amber-300/70">
              {jackpot ? `${jackpot.poolEth.toFixed(4)} pETH` : ""}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => (profile ? setLaunching(true) : signIn())}
            className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-black text-zinc-950 transition hover:bg-fuchsia-400"
          >
            Launch a Pit match
          </button>
          {/* USD / pETH toggle (defaults to USD) */}
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
      </header>

      <Shelf title="Live Matches" cards={data?.live ?? []} empty="No live Pit matches right now. Launch one." me={me} fmt={fmt} />
      <Shelf title="Lobby" cards={data?.lobby ?? []} empty="No open lobbies. A launch opens one instantly." me={me} fmt={fmt} />
      {(data?.queue.length ?? 0) > 0 && <Shelf title="Queue" cards={data?.queue ?? []} empty="" me={me} fmt={fmt} />}
      <Shelf title="Recent Results" cards={data?.results ?? []} empty="No finished Pit matches yet." me={me} fmt={fmt} />

      {mounted && launching && <LaunchPitModal onClose={() => setLaunching(false)} />}
    </div>
  );
}
