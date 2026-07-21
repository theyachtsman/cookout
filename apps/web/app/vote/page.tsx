"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { VOTE_THRESHOLD, VOTING_WINDOW_MS, type Round, type TokenConcept } from "@cookout/shared";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useSocial } from "../../lib/social";

/**
 * Community Vote — the launchpad's other half. Concepts up for a vote, plus
 * the full archive of everything ever submitted (including the ones the
 * community passed on), filterable and clickable through to their rounds.
 */

type Filter = "voting" | "all" | "launched" | "scheduled" | "rejected";

const STATUS: Record<
  TokenConcept["status"],
  { label: string; cls: string }
> = {
  submitted: { label: "up for vote", cls: "bg-zinc-800 text-zinc-300" },
  shortlisted: { label: "✓ shortlisted", cls: "bg-sky-500/20 text-sky-300" },
  scheduled: { label: "scheduled", cls: "bg-lime-400/20 text-lime-300" },
  launched: { label: "🍽️ launched", cls: "bg-emerald-500/20 text-emerald-300" },
  rejected: { label: "✗ didn't pass", cls: "bg-red-500/15 text-red-300/80" },
};

export default function VotePage() {
  const { profile, signIn } = useSession();
  const { setActiveRoom } = useSocial();
  // Voting has its own room: creators pitch, everyone else argues about it.
  useEffect(() => {
    setActiveRoom({ id: "vote", label: "Vote" });
    return () => setActiveRoom(null);
  }, [setActiveRoom]);
  const [concepts, setConcepts] = useState<TokenConcept[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [filter, setFilter] = useState<Filter>("voting");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    api<TokenConcept[]>("/api/concepts")
      .then(setConcepts)
      .catch(() => {});
    api<Round[]>("/api/calendar")
      .then(setRounds)
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  /** conceptId → the round it became, so archive rows click through. */
  const roundOf = useMemo(() => {
    const m = new Map<string, Round>();
    for (const r of rounds) m.set(r.conceptId, r);
    return m;
  }, [rounds]);

  const vote = async (id: string) => {
    setError("");
    setBusy(id);
    try {
      await api(`/api/concepts/${id}/vote`, { body: {} });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const voting = concepts
    .filter((c) => c.status === "submitted")
    .sort((a, b) => b.votes - a.votes);
  const archive = useMemo(
    () =>
      [...concepts]
        .filter((c) => (filter === "voting" ? false : true))
        .filter((c) =>
          filter === "all"
            ? true
            : filter === "launched"
              ? c.status === "launched"
              : filter === "scheduled"
                ? c.status === "scheduled" || c.status === "shortlisted"
                : filter === "rejected"
                  ? c.status === "rejected"
                  : true,
        )
        .sort((a, b) => b.createdAt - a.createdAt),
    [concepts, filter],
  );

  const counts = useMemo(
    () => ({
      voting: concepts.filter((c) => c.status === "submitted").length,
      all: concepts.length,
      launched: concepts.filter((c) => c.status === "launched").length,
      scheduled: concepts.filter((c) => c.status === "scheduled" || c.status === "shortlisted")
        .length,
      rejected: concepts.filter((c) => c.status === "rejected").length,
    }),
    [concepts],
  );

  return (
    <div className="space-y-8">
      <header className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-lime-400/[0.07] via-zinc-950 to-zinc-950 p-6">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">
          Community Vote
        </div>
        <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
          The crowd picks what cooks.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every coin on the calendar got there by vote.{" "}
          <b className="text-zinc-200">{VOTE_THRESHOLD} upvotes</b> sends a concept to the committee
          shortlist; anything that doesn&apos;t hit the bar within{" "}
          {Math.round(VOTING_WINDOW_MS / 3_600_000)} hours closes out. One vote per wallet.
        </p>
        <Link
          href="/submissions"
          className="mt-4 inline-block rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
        >
          Submit your own coin →
        </Link>
      </header>

      {error && <div className="text-sm text-red-400">{error}</div>}

      <section>
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-black">Voting Now</h2>
          <span className="text-xs text-zinc-500">{voting.length} up for a vote</span>
        </div>
        {voting.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            Nothing up for a vote right now —{" "}
            <Link href="/submissions" className="text-lime-400 hover:underline">
              submit one
            </Link>
            .
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {voting.map((c) => {
              const pct = Math.min(100, (c.votes / VOTE_THRESHOLD) * 100);
              return (
                <div
                  key={c.id}
                  className="group relative overflow-hidden rounded-2xl border border-zinc-800 p-4 transition hover:border-lime-400/50"
                >
                  {c.artworkUrl && (
                    <div
                      aria-hidden
                      className="absolute inset-0 scale-110 bg-cover bg-center opacity-[0.12] blur-xl"
                      style={{ backgroundImage: `url(${c.artworkUrl})` }}
                    />
                  )}
                  <div className="relative">
                    <div className="flex items-start gap-3">
                      {c.artworkUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={c.artworkUrl}
                          alt=""
                          className="h-14 w-14 shrink-0 rounded-xl border border-zinc-700 object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-900 text-2xl">
                          🪙
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-black">
                          {c.name} <span className="text-zinc-500">${c.symbol}</span>
                        </div>
                        <div className="text-sm text-zinc-400">{c.theme}</div>
                        {c.pitch && (
                          <div className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{c.pitch}</div>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-2xl font-black text-lime-300">
                        {c.votes}
                      </span>
                    </div>

                    <div className="mt-3 h-1.5 overflow-hidden rounded bg-zinc-800">
                      <div className="h-full bg-lime-400 transition-[width]" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
                      <span>
                        {c.votes}/{VOTE_THRESHOLD} to shortlist
                      </span>
                      <span>{timeLeft(c.createdAt)}</span>
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                      {profile ? (
                        <button
                          disabled={busy === c.id}
                          onClick={() => void vote(c.id)}
                          className="rounded-lg bg-lime-400 px-4 py-1.5 text-sm font-black text-zinc-950 transition hover:bg-lime-300 active:scale-95 disabled:opacity-50"
                        >
                          ▲ Upvote
                        </button>
                      ) : (
                        <button
                          onClick={() => void signIn()}
                          className="rounded-lg border border-zinc-700 px-4 py-1.5 text-sm font-bold text-zinc-300 hover:border-lime-400/60"
                        >
                          Connect to vote
                        </button>
                      )}
                      <Link
                        href={`/creator/${c.creatorAddress}`}
                        className="text-xs text-zinc-600 hover:text-zinc-400"
                      >
                        by {c.creatorAddress.slice(0, 6)}…{c.creatorAddress.slice(-4)}
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-black">All Submissions</h2>
          <div className="flex flex-wrap gap-1 text-xs font-bold">
            {(
              [
                ["all", "All"],
                ["launched", "🍽️ Launched"],
                ["scheduled", "Shortlisted"],
                ["rejected", "✗ Didn't pass"],
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

        {archive.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 p-6 text-sm text-zinc-500">
            Nothing here yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            {archive.map((c) => {
              const round = roundOf.get(c.id);
              const meta = STATUS[c.status];
              const row = (
                <div className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-zinc-900/60">
                  {c.artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.artworkUrl}
                      alt=""
                      className={`h-10 w-10 shrink-0 rounded-lg border border-zinc-800 object-cover ${
                        c.status === "rejected" ? "opacity-50 grayscale" : ""
                      }`}
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
                      🪙
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold">
                      {c.name} <span className="text-zinc-500">${c.symbol}</span>
                    </div>
                    <div className="truncate text-[11px] text-zinc-500">{c.theme}</div>
                  </div>
                  {round && (
                    <span
                      className={`hidden shrink-0 rounded px-2 py-0.5 text-[10px] font-bold sm:inline ${
                        round.graduated
                          ? "bg-lime-400/20 text-lime-300"
                          : round.endReason === "rug_detected" ||
                              round.endReason === "liquidity_removed"
                            ? "bg-red-500/20 text-red-300"
                            : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {round.graduated
                        ? "served up"
                        : round.state === "live"
                          ? "LIVE"
                          : round.endReason === "rug_detected" ||
                              round.endReason === "liquidity_removed"
                            ? "burnt"
                            : round.state === "results"
                              ? "closed"
                              : round.state}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-xs text-zinc-500">{c.votes} ▲</span>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${meta.cls}`}>
                    {meta.label}
                  </span>
                </div>
              );
              return (
                <div key={c.id} className="border-b border-zinc-800/60 last:border-b-0">
                  {round ? <Link href={`/round/${round.id}`}>{row}</Link> : row}
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-[11px] text-zinc-600">
          Rows with a round are clickable — jump straight to the chart and results.
        </p>
      </section>
    </div>
  );
}

function timeLeft(createdAt: number): string {
  const ms = createdAt + VOTING_WINDOW_MS - Date.now();
  if (ms <= 0) return "closing…";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
