"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PIT_DURATION_MAP, marketCap } from "@cookout/shared";
import { api } from "../../lib/api";
import type { PitCard, PitFeed } from "../../lib/pit";
import { pdotEth } from "../../lib/pit";
import { Countdown } from "../../components/Countdown";

function DurationChip({ k }: { k: string }) {
  const d = PIT_DURATION_MAP[k as keyof typeof PIT_DURATION_MAP];
  if (!d) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[11px] font-bold text-fuchsia-300">
      {d.icon} {d.name} · {d.minutes}m
    </span>
  );
}

function PoolLine({ label, pot, carry }: { label: string; pot: number; carry: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="font-mono text-sm font-black text-zinc-100">
        {pdotEth(pot)}
        {carry > 0 && <span className="ml-1 text-[10px] font-bold text-amber-300">+carry</span>}
      </span>
    </div>
  );
}

function outcomeLabel(o?: string): { text: string; cls: string } {
  if (o === "graduate") return { text: "Graduated", cls: "text-lime-300" };
  if (o === "rug") return { text: "Rugged", cls: "text-red-400" };
  return { text: "Timer", cls: "text-zinc-300" };
}

function Card({ c }: { c: PitCard }) {
  const r = c.round;
  const live = r.state === "live";
  const lobby = r.state === "lobby";
  const done = r.state === "results";
  const pit = c.summary?.pit;
  return (
    <Link
      href={`/pit/${r.id}`}
      className="group flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl bg-zinc-900/50 ring-1 ring-white/10 transition hover:ring-white/25"
    >
      <div className="relative h-24 w-full overflow-hidden bg-zinc-800">
        {r.token.bannerUrl || r.token.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.token.bannerUrl ?? r.token.artworkUrl}
            alt=""
            className="h-full w-full object-cover opacity-90 transition group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl">🔥</div>
        )}
        {live && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-black uppercase text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-zinc-50">{r.token.name}</div>
            <div className="font-mono text-[11px] text-zinc-500">${r.token.symbol}</div>
          </div>
          <DurationChip k={r.pit?.duration ?? "standard"} />
        </div>

        {done && pit ? (
          <div className="mt-auto space-y-1 text-xs">
            <div className={`font-black ${outcomeLabel(pit.outcome).cls}`}>
              {outcomeLabel(pit.outcome).text}
            </div>
            <div className="text-zinc-500">
              {pit.prediction.winners} prediction · {pit.trading.qualified} trading winners
            </div>
          </div>
        ) : (
          <div className="mt-auto space-y-1">
            <PoolLine label="Prediction pool" pot={c.prediction.pot} carry={c.prediction.carryIn} />
            <PoolLine label="Trading pool" pot={c.trading.pot} carry={c.trading.carryIn} />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-white/5 pt-2 text-[11px]">
          {live && r.endsAt ? (
            <>
              <span className="font-mono text-zinc-400">
                mc {marketCap(r.pool!).toFixed(2)}
              </span>
              <span className="font-mono font-bold text-lime-300">
                <Countdown to={r.endsAt} />
              </span>
            </>
          ) : lobby && r.queueOpensAt ? (
            <>
              <span className="text-zinc-500">Lobby closes</span>
              <span className="font-mono font-bold text-amber-300">
                <Countdown to={r.queueOpensAt} />
              </span>
            </>
          ) : done ? (
            <span className="text-zinc-500">View results</span>
          ) : (
            <span className="text-zinc-500">Queued for a live slot</span>
          )}
          <span className="font-bold text-fuchsia-300 opacity-0 transition group-hover:opacity-100">
            {live ? "Trade →" : lobby ? "Enter →" : "Open →"}
          </span>
        </div>
      </div>
    </Link>
  );
}

function Shelf({ title, cards, empty }: { title: string; cards: PitCard[]; empty: string }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-zinc-400">
        {title}
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-bold text-zinc-400">
          {cards.length}
        </span>
      </h2>
      {cards.length === 0 ? (
        <div className="rounded-2xl bg-zinc-900/40 p-5 text-center text-xs text-zinc-600">{empty}</div>
      ) : (
        <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
          {cards.map((c) => (
            <Card key={c.round.id} c={c} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function PitPage() {
  const [data, setData] = useState<PitFeed | null>(null);

  useEffect(() => {
    const load = () => api<PitFeed>("/api/pit").then(setData).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const carry = data?.carry;
  const hasCarry = carry && (carry.prediction > 1e-9 || carry.trading > 1e-9);

  return (
    <div className="space-y-7">
      <header className="rounded-3xl bg-gradient-to-br from-fuchsia-500/15 via-zinc-900/40 to-zinc-950 p-6 ring-1 ring-white/10 sm:p-8">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-fuchsia-300">
          Powered by Swarm AI
        </div>
        <h1 className="mt-1 text-3xl font-black text-zinc-50 sm:text-4xl">The Pit</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          You versus The Swarm. Call the outcome, or trade a paper stack against an adaptive AI market.
          Beat the Swarm and split the pools.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/submissions?type=pit"
            className="rounded-xl bg-fuchsia-500 px-4 py-2 text-sm font-black text-zinc-950 transition hover:bg-fuchsia-400"
          >
            Launch a Pit match
          </Link>
          {hasCarry && (
            <span className="inline-flex items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-2 text-sm font-bold text-amber-200 ring-1 ring-amber-500/30">
              🏆 Carryover jackpot
              {carry!.prediction > 1e-9 && <span className="font-mono">pred {pdotEth(carry!.prediction)}</span>}
              {carry!.trading > 1e-9 && <span className="font-mono">trade {pdotEth(carry!.trading)}</span>}
            </span>
          )}
        </div>
      </header>

      <Shelf title="Live Matches" cards={data?.live ?? []} empty="No live Pit matches right now. Launch one." />
      <Shelf title="Lobby" cards={data?.lobby ?? []} empty="No open lobbies. A launch opens one instantly." />
      {(data?.queue.length ?? 0) > 0 && (
        <Shelf title="Queue" cards={data?.queue ?? []} empty="" />
      )}
      <Shelf title="Recent Results" cards={data?.results ?? []} empty="No finished Pit matches yet." />
    </div>
  );
}
