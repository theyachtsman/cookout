"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Round } from "@cookout/shared";
import { api } from "../../lib/api";
import { Countdown } from "../../components/Countdown";

const LIVEISH = ["lobby", "queue_open", "settling", "live"];

export default function Home() {
  const [rounds, setRounds] = useState<Round[]>([]);

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
  const done = rounds.filter((r) => r.state === "results" || r.state === "ended").slice(-6);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-1 text-2xl font-black">Match Calendar</h1>
        <p className="mb-4 text-sm text-zinc-400">
          Every match is a real token launched through a fair batch auction — one clearing price,
          pro-rata fills, auditable settlement.
        </p>
        {live.length === 0 && upcoming.length === 0 && (
          <div className="rounded-lg border border-zinc-800 p-6 text-zinc-400">
            No rounds on the calendar yet — the next one is usually seconds away.
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

      {done.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-zinc-300">Recent Results</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {done.map((r) => (
              <Link
                key={r.id}
                href={`/round/${r.id}`}
                className="rounded-lg border border-zinc-800 p-4 hover:border-zinc-600"
              >
                <div className="font-bold">
                  {r.token.name} <span className="text-zinc-500">${r.token.symbol}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  {r.graduated ? "🍽️ Served Up — still trading in the wild" : `Ended: ${r.endReason?.replace(/_/g, " ")}`}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RoundCard({ round, highlight }: { round: Round; highlight?: boolean }) {
  const teaser = round.state === "scheduled";
  const art = round.token.artworkUrl;
  const stateLabel: Record<string, string> = {
    scheduled: "Starting soon",
    lobby: "Lobby open",
    queue_open: "Queue open — get in",
    settling: "Settling auction",
    live: "LIVE",
  };
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border ${
        highlight ? "border-lime-400/60" : "border-zinc-800"
      }`}
    >
      {/* artwork backdrop: blurred, dimmed, teased hard until reveal */}
      {art && (
        <div
          aria-hidden
          className={`absolute inset-0 scale-110 bg-cover bg-center transition-transform duration-700 group-hover:scale-125 ${
            teaser ? "opacity-25 blur-2xl saturate-0" : "opacity-30 blur-lg"
          }`}
          style={{ backgroundImage: `url(${art})` }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-zinc-950/85 via-zinc-950/60 to-zinc-950/90"
      />
      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            {art ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={art}
                alt=""
                className={`h-14 w-14 rounded-xl border border-zinc-700 object-cover shadow-lg shadow-black/50 transition-transform duration-300 group-hover:rotate-3 group-hover:scale-105 ${
                  teaser ? "blur-md saturate-0" : ""
                }`}
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-2xl">
                {teaser ? "❓" : "🪙"}
              </div>
            )}
            <div>
              <div className="text-xl font-black drop-shadow">
                {teaser ? "???" : round.token.name}{" "}
                {!teaser && <span className="text-zinc-400">${round.token.symbol}</span>}
              </div>
              <div className="mt-0.5 text-sm text-zinc-400">
                {teaser ? `Theme: ${round.token.theme}` : round.token.theme}
              </div>
            </div>
          </div>
          <span
            className={`shrink-0 rounded px-2 py-1 text-xs font-bold ${
              round.state === "live"
                ? "animate-pulse bg-emerald-500/25 text-emerald-300"
                : "bg-zinc-800/90 text-zinc-300"
            }`}
          >
            {stateLabel[round.state] ?? round.state}
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between">
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
            <span className="ml-2 rounded bg-zinc-800/90 px-1.5 py-0.5 text-xs uppercase">
              {round.tier}
            </span>
          </div>
          <Link
            href={`/round/${round.id}`}
            className="rounded-lg bg-lime-400 px-4 py-2 font-black text-zinc-950 shadow-lg shadow-lime-400/20 transition hover:bg-lime-300 hover:shadow-lime-300/40"
          >
            Pull Up
          </Link>
        </div>
      </div>
    </div>
  );
}
