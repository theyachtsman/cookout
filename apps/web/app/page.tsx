"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Round } from "@cookout/shared";
import { api } from "../lib/api";
import { Countdown } from "../components/Countdown";

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
                  {r.graduated ? "🎓 Graduated — Arena Alumni" : `Ended: ${r.endReason}`}
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
  const stateLabel: Record<string, string> = {
    scheduled: "Starting soon",
    lobby: "Lobby open",
    queue_open: "Queue open — get in",
    settling: "Settling auction",
    live: "LIVE",
  };
  return (
    <div
      className={`rounded-xl border p-5 ${
        highlight ? "border-amber-500/60 bg-amber-500/5" : "border-zinc-800"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xl font-black">
            {teaser ? "???" : round.token.name}{" "}
            {!teaser && <span className="text-zinc-500">${round.token.symbol}</span>}
          </div>
          <div className="mt-1 text-sm text-zinc-400">
            {teaser ? `Theme: ${round.token.theme}` : round.token.theme}
          </div>
        </div>
        <span
          className={`rounded px-2 py-1 text-xs font-bold ${
            round.state === "live"
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-zinc-800 text-zinc-300"
          }`}
        >
          {stateLabel[round.state] ?? round.state}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between">
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
          <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-xs uppercase">
            {round.tier}
          </span>
        </div>
        <Link
          href={`/round/${round.id}`}
          className="rounded-lg bg-amber-500 px-4 py-2 font-black text-zinc-950 hover:bg-amber-400"
        >
          Pull Up
        </Link>
      </div>
    </div>
  );
}
