"use client";

import Link from "next/link";
import { CoinCard } from "../../components/CoinCard";
import { useEffect, useMemo, useState } from "react";
import type { Round } from "@cookout/shared";
import { api } from "../../lib/api";
import { Countdown } from "../../components/Countdown";
import { useSocial } from "../../lib/social";

const LIVEISH = ["lobby", "queue_open", "settling", "live"];

type ResultFilter = "all" | "graduated" | "failed" | "burnt";

const isRug = (r: Round) =>
  r.endReason === "rug_detected" || r.endReason === "liquidity_removed";

export default function Home() {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const { setActiveRoom } = useSocial();
  // The calendar has no chat of its own — you're in the global Cookout chat
  // while browsing it. Clear any match room left over from where you came from.
  useEffect(() => {
    setActiveRoom(null);
  }, [setActiveRoom]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Round[]>("/api/calendar")
        .then((r) => alive && setRounds(r))
        .catch(() => {});
    void load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const live = rounds.filter((r) => LIVEISH.includes(r.state));
  const upcoming = rounds.filter((r) => r.state === "scheduled");
  // Every finished round, newest first — the full archive, not a slice.
  const finished = useMemo(
    () =>
      rounds
        .filter((r) => r.state === "results" || r.state === "ended")
        .sort((a, b) => (b.endedAt ?? b.scheduledAt) - (a.endedAt ?? a.scheduledAt)),
    [rounds],
  );
  const counts = useMemo(
    () => ({
      all: finished.length,
      graduated: finished.filter((r) => r.graduated).length,
      failed: finished.filter((r) => !r.graduated).length,
      burnt: finished.filter((r) => !r.graduated && isRug(r)).length,
    }),
    [finished],
  );
  const done = finished.filter((r) =>
    filter === "all"
      ? true
      : filter === "graduated"
        ? r.graduated
        : filter === "burnt"
          ? !r.graduated && isRug(r)
          : !r.graduated,
  );

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-1 text-2xl font-black">Match Calendar</h1>
        <p className="mb-4 text-sm text-zinc-400">
          Every match is a real token launched through a fair batch auction — one clearing price,
          pro-rata fills, auditable settlement.
        </p>
        {live.length === 0 && upcoming.length === 0 && (
          <div className="rounded-xl border border-lime-400/30 bg-lime-400/[0.04] p-8 text-center">
            <div className="text-3xl">🍳</div>
            <p className="mt-2 text-lg font-black text-zinc-100">
              The grill is empty — someone needs to launch a coin.
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-zinc-400">
              Matches come from the community: make a coin, the crowd votes it through, and it
              lands right here on the calendar at your chosen tier.
            </p>
            <Link
              href="/submissions"
              className="mt-4 inline-block rounded-xl bg-lime-400 px-6 py-2.5 font-black text-zinc-950 shadow-lg shadow-lime-400/25 transition hover:bg-lime-300"
            >
              🔥 Make a Coin →
            </Link>
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {live.map((r) => (
            <RoundCard key={r.id} round={r} highlight />
          ))}
          {upcoming.map((r) => (
            <RoundCard key={r.id} round={r} />
          ))}
        </div>
      </section>

      {finished.length > 0 && (
        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-bold text-zinc-300">Past Results</h2>
            <div className="flex flex-wrap gap-1 text-xs font-bold">
              {(
                [
                  ["all", "All"],
                  ["graduated", "🍽️ Served up"],
                  ["failed", "Didn't graduate"],
                  ["burnt", "🔥 Burnt"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`rounded-full px-3 py-1 transition ${
                    filter === key
                      ? "bg-lime-400 text-zinc-950"
                      : "border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                  }`}
                >
                  {label}
                  <span className={filter === key ? "ml-1.5 text-zinc-800" : "ml-1.5 text-zinc-600"}>
                    {counts[key]}
                  </span>
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-zinc-600">newest first</span>
          </div>
          {done.length === 0 && (
            <div className="rounded-lg border border-zinc-800 p-6 text-sm text-zinc-500">
              No rounds in this filter yet.
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            {done.map((r) => {
              const art = r.token.artworkUrl;
              const rug = r.endReason === "rug_detected" || r.endReason === "liquidity_removed";
              return (
                <Link
                  key={r.id}
                  href={`/round/${r.id}`}
                  className={`group relative overflow-hidden rounded-xl border transition hover:-translate-y-0.5 ${
                    r.graduated
                      ? "border-lime-400/40 hover:border-lime-400/80"
                      : rug
                        ? "border-red-900/60 hover:border-red-700"
                        : "border-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  {art && (
                    <div
                      aria-hidden
                      className="absolute inset-0 scale-110 bg-cover bg-center opacity-20 blur-lg transition-opacity duration-300 group-hover:opacity-35"
                      style={{ backgroundImage: `url(${art})` }}
                    />
                  )}
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-r from-zinc-950/90 via-zinc-950/70 to-zinc-950/90"
                  />
                  <div className="relative flex items-center gap-3 p-3">
                    {art ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={art}
                        alt=""
                        className={`h-11 w-11 rounded-lg border border-zinc-700 object-cover shadow-md shadow-black/50 ${
                          rug ? "grayscale" : ""
                        }`}
                      />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-xl">
                        {r.graduated ? "🍽️" : rug ? "🔥" : "🪙"}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">
                        {r.token.name} <span className="text-zinc-500">${r.token.symbol}</span>
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {r.graduated
                          ? "still trading in the wild"
                          : `ended: ${r.endReason?.replace(/_/g, " ")}`}
                        {r.endedAt && (
                          <span className="ml-1 text-zinc-700">· {ago(r.endedAt)}</span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${
                        r.graduated
                          ? "bg-lime-400/20 text-lime-300"
                          : rug
                            ? "bg-red-500/20 text-red-300"
                            : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {r.graduated ? "🍽️ served up" : rug ? "🔥 burnt" : "closed"}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/** Compact relative time for the results archive. */
function ago(at: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function RoundCard({ round, highlight }: { round: Round; highlight?: boolean }) {
  const teaser = round.state === "scheduled";
  const stateLabel: Record<string, string> = {
    scheduled: "Starting soon",
    lobby: "Lobby open",
    queue_open: "Queue open — get in",
    settling: "Settling auction",
    live: "LIVE",
  };
  return (
    <CoinCard
      coin={{ ...round.token, tier: round.tier }}
      teaser={teaser}
      borderClass={highlight ? "border-lime-400/60" : "border-zinc-800"}
      corner={
        <span
          className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${
            round.state === "live"
              ? "animate-pulse bg-emerald-500/25 text-emerald-300"
              : "bg-zinc-800/90 text-zinc-300"
          }`}
        >
          {stateLabel[round.state] ?? round.state}
        </span>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-400">
          {round.state === "scheduled" && (
            <>
              Lobby opens in <Countdown to={round.scheduledAt} />
            </>
          )}
          {round.state === "lobby" && round.queueOpensAt && (
            <>
              Queue opens in <Countdown to={round.queueOpensAt} />
            </>
          )}
          {round.state === "queue_open" && round.queueClosesAt && (
            <>
              Queue closes in <Countdown to={round.queueClosesAt} />
            </>
          )}
          {round.state === "live" && <span className="text-emerald-400">Trading now</span>}
        </div>
        <Link
          href={`/round/${round.id}`}
          className="rounded-lg bg-lime-400 px-4 py-2 font-black text-zinc-950 shadow-lg shadow-lime-400/20 transition hover:bg-lime-300 hover:shadow-lime-300/40"
        >
          Pull Up
        </Link>
      </div>
    </CoinCard>
  );
}
