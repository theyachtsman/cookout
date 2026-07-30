"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  VOTE_ROOM,
  VOTE_THRESHOLD,
  VOTING_WINDOW_MS,
  type Round,
  type TokenConcept,
} from "@cookout/shared";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useSocial } from "../../lib/social";
import { CoinCard } from "../../components/CoinCard";
import { CategoryShelf } from "../../components/CategoryShelf";

/**
 * Community Vote — the launchpad's other half. Concepts up for a vote, plus
 * the full archive of everything ever submitted (including the ones the
 * community passed on), grouped by outcome into streaming rails and clickable
 * through to their rounds.
 */

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
  // The launchpad has its own channel: walk onto the Vote page and the dock
  // switches to Vote chat — campaign for your coin without flooding The Grill.
  useEffect(() => {
    setActiveRoom({ id: VOTE_ROOM, label: "🗳️ Vote" });
    return () => setActiveRoom(null);
  }, [setActiveRoom]);
  const [concepts, setConcepts] = useState<TokenConcept[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
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

  // Open X's composer with a ready-made promo. The tweet links to the coin's
  // share page (/coin/:id), which carries per-coin OpenGraph tags so the post
  // unfurls with the coin card image; the link itself leads to the vote page.
  const shillOnX = (c: TokenConcept) => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${base}/coin/${c.id}`;
    const text =
      `🍳 $${c.symbol} (${c.name}) just dropped on The Cookout, the live trading battleground.\n` +
      `Vote it onto the grill and get ready for the Cookout 🔥🗳️`;
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      text,
    )}&url=${encodeURIComponent(url)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  };

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

  // Deep link from the Pit Boss shill post (/vote#coin-<id>): once the concept
  // is loaded, scroll its card into view and flash a ring so it's obvious which
  // coin they came to shill for.
  const [highlight, setHighlight] = useState("");
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#coin-")) return;
    const id = hash.slice("#coin-".length);
    if (!concepts.some((c) => c.id === id)) return;
    const el = document.getElementById(`coin-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlight(id);
    const t = setTimeout(() => setHighlight(""), 2600);
    return () => clearTimeout(t);
  }, [concepts]);
  // The archive, de-tabled into streaming rails grouped by outcome. Coins still
  // up for a vote live in the section above, so they aren't repeated here.
  const submissionGroups = useMemo(() => {
    const pick = (fn: (c: TokenConcept) => boolean) =>
      [...concepts].filter(fn).sort((a, b) => b.createdAt - a.createdAt);
    return [
      {
        key: "launched",
        title: "Launched",
        icon: "🍽️",
        tagline: "Made it to the Cook Out",
        list: pick((c) => c.status === "launched"),
      },
      {
        key: "shortlisted",
        title: "Shortlisted",
        icon: "✓",
        tagline: "Cleared the vote, waiting for a slot",
        list: pick((c) => c.status === "shortlisted" || c.status === "scheduled"),
      },
      {
        key: "rejected",
        title: "Didn't pass",
        icon: "✗",
        tagline: "The crowd passed on these",
        list: pick((c) => c.status === "rejected"),
      },
    ].filter((g) => g.list.length > 0);
  }, [concepts]);

  return (
    <div className="space-y-8">
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-lime-400/[0.1] via-zinc-900/40 to-zinc-900/40 p-6">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">
          Community Vote
        </div>
        <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
          The crowd picks what cooks.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every coin at the Cook Out got there by vote.{" "}
          <b className="text-zinc-200">{VOTE_THRESHOLD} upvotes</b> sends a coin straight to the
          Cook Out at its chosen tier; anything that doesn&apos;t hit the bar within{" "}
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
          <div className="rounded-2xl bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
            Nothing up for a vote right now.{" "}
            <Link href="/submissions" className="text-lime-400 hover:underline">
              Make a coin
            </Link>
            .
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {voting.map((c) => {
              const pct = Math.min(100, (c.votes / VOTE_THRESHOLD) * 100);
              return (
                <div key={c.id} id={`coin-${c.id}`} className="scroll-mt-24">
                <CoinCard
                  coin={c}
                  onEdited={load}
                  borderClass="border-transparent"
                  className={`transition ${
                    highlight === c.id ? "ring-2 ring-lime-400 ring-offset-2 ring-offset-zinc-950" : ""
                  }`}
                  corner={
                    <span className="font-mono text-2xl font-black text-lime-300 drop-shadow">
                      {c.votes}
                    </span>
                  }
                >
                  {c.pitch && (
                    <div className="line-clamp-2 text-xs text-zinc-500">{c.pitch}</div>
                  )}
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
                    <div className="h-full bg-lime-400 transition-[width]" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
                    <span>
                      {c.votes}/{VOTE_THRESHOLD} to the Cook Out
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
                        className="rounded-lg bg-zinc-800 px-4 py-1.5 text-sm font-bold text-zinc-300 transition hover:bg-zinc-700"
                      >
                        Connect to vote
                      </button>
                    )}
                    <button
                      onClick={() => shillOnX(c)}
                      title="Post it to your X. A ready-made promo with the coin card and a link to vote."
                      className="rounded-lg bg-sky-500/15 px-4 py-1.5 text-sm font-black text-sky-300 transition hover:bg-sky-500/25 active:scale-95"
                    >
                      𝕏 Shill
                    </button>
                    <Link
                      href={`/creator/${c.creatorAddress}`}
                      className="ml-auto text-xs text-zinc-600 hover:text-zinc-400"
                    >
                      by {c.creatorAddress.slice(0, 6)}…{c.creatorAddress.slice(-4)}
                    </Link>
                  </div>
                </CoinCard>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-1 flex items-baseline gap-3">
          <h2 className="text-lg font-black">All Submissions</h2>
          <span className="text-xs text-zinc-500">every coin ever dropped, by outcome</span>
        </div>

        {submissionGroups.length === 0 ? (
          <div className="rounded-2xl bg-zinc-900/40 p-6 text-sm text-zinc-500">
            Nothing here yet.
          </div>
        ) : (
          <div className="space-y-6">
            {submissionGroups.map((g) => (
              <CategoryShelf
                key={g.key}
                title={g.title}
                icon={g.icon}
                tagline={g.tagline}
                count={g.list.length}
              >
                {g.list.map((c) => (
                  <div key={c.id} className="w-80 shrink-0">
                    <ConceptCard concept={c} round={roundOf.get(c.id)} />
                  </div>
                ))}
              </CategoryShelf>
            ))}
          </div>
        )}
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

/** One archived submission as a borderless card, matching the Cook Out result
 *  cards. Links through to its round when it has one; rejected coins dim. */
function ConceptCard({ concept: c, round }: { concept: TokenConcept; round?: Round }) {
  const meta = STATUS[c.status];
  const card = (
    <CoinCard
      coin={{
        name: c.name,
        symbol: c.symbol,
        theme: c.theme,
        artworkUrl: c.artworkUrl,
        bannerUrl: c.bannerUrl,
        tier: c.tier,
        mode: c.mode,
        matchMinutes: c.matchMinutes,
        modifiers: c.modifiers,
        id: c.id,
        creatorAddress: c.creatorAddress,
      }}
      borderClass="border-transparent"
      className={c.status === "rejected" ? "opacity-70" : ""}
      corner={
        <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${meta.cls}`}>
          {meta.label}
        </span>
      }
    >
      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span className="font-mono">{c.votes} ▲</span>
        {round && (
          <span>
            {round.graduated
              ? "served up"
              : round.endReason === "rug_detected" || round.endReason === "liquidity_removed"
                ? "burnt"
                : round.state === "live"
                  ? "LIVE"
                  : round.state === "results" || round.state === "ended"
                    ? "closed"
                    : round.state}
          </span>
        )}
      </div>
    </CoinCard>
  );
  return round ? (
    <Link
      href={`/round/${round.id}`}
      className="block h-full transition duration-300 hover:-translate-y-1"
    >
      {card}
    </Link>
  ) : (
    <div className="h-full">{card}</div>
  );
}
