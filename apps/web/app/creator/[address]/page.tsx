"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Round, RoundSummary, RugBan, TokenConcept } from "@cookout/shared";
import { api } from "../../../lib/api";
import { useUnit } from "../../../lib/chainOnly";
import { ReputationPanel, repStanding } from "../../../components/Reputation";
import { RunItBackButton } from "../../../components/RunItBack";
import { Avatar, ProfileHero, SectionTitle, StatCard, StatGrid } from "../../../components/ProfileUI";

interface CreatorView {
  address: string;
  displayName?: string;
  level: number;
  title: string;
  creatorReputation: number;
  banned?: boolean;
  rugBans?: RugBan[];
  feesEarned: number;
  concepts: TokenConcept[];
  rounds: Array<{ round: Round; summary: RoundSummary | null }>;
  aggregates: {
    submissions: number;
    roundsLaunched: number;
    graduations: number;
    rugs: number;
    totalVotes: number;
    totalVolume: number;
  };
}

const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-zinc-800 text-zinc-300",
  shortlisted: "bg-sky-500/20 text-sky-300",
  scheduled: "bg-lime-400/20 text-lime-300",
  launched: "bg-emerald-500/20 text-emerald-300",
  rejected: "bg-red-500/15 text-red-300/80",
};

export default function CreatorPage() {
  const unit = useUnit();
  const { address } = useParams<{ address: string }>();
  const [view, setView] = useState<CreatorView | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<CreatorView>(`/api/creator/${address}`)
      .then(setView)
      .catch(() => setMissing(true));
  }, [address]);

  if (missing)
    return (
      <div className="py-24 text-center">
        <div className="text-4xl">🍳</div>
        <p className="mt-3 text-sm text-zinc-500">No creator record for this address.</p>
      </div>
    );
  if (!view) return <div className="p-10 text-center text-zinc-500">Loading…</div>;

  const a = view.aggregates;
  const name = view.displayName ?? `${view.address.slice(0, 8)}…${view.address.slice(-6)}`;
  const standing = repStanding(view.creatorReputation);
  const gradRate = a.roundsLaunched > 0 ? Math.round((a.graduations / a.roundsLaunched) * 100) : 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ProfileHero
        avatar={<Avatar url={undefined} name={name} level={view.level} />}
        name={name}
        level={view.level}
        title={`${view.title} · Creator`}
        accent={!!view.banned}
        chips={
          <>
            <span className={`rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] font-bold ${standing.accent}`}>
              {standing.emoji} {standing.label} creator
            </span>
            {view.banned && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-red-300">
                🚫 launch ban
              </span>
            )}
          </>
        }
        right={
          <div>
            <div className="font-mono text-2xl font-black text-lime-400">
              {view.feesEarned.toFixed(3)}
            </div>
            <div className="text-[11px] text-zinc-500">{unit} fees earned</div>
          </div>
        }
      >
        <Link
          href={`/profile/${view.address}`}
          className="inline-block text-xs font-bold text-lime-400 hover:underline"
        >
          View player profile →
        </Link>
      </ProfileHero>

      {/* Reputation — the headline for a creator */}
      <section>
        <SectionTitle title="Creator Reputation" />
        <ReputationPanel
          reputation={view.creatorReputation}
          bans={view.rugBans ?? []}
          banned={!!view.banned}
        />
      </section>

      {/* Track record */}
      <section>
        <SectionTitle title="Track Record" />
        <StatGrid>
          <StatCard icon="🪙" label="Submissions" value={a.submissions} />
          <StatCard icon="🚀" label="Launched" value={a.roundsLaunched} />
          <StatCard icon="🍽️" label="Served Up" value={a.graduations} tone="text-lime-300" />
          <StatCard icon="🔥" label="Rugs" value={a.rugs} tone={a.rugs > 0 ? "text-red-300" : "text-zinc-100"} />
          <StatCard icon="📊" label="Graduation Rate" value={`${gradRate}%`} tone="text-emerald-300" />
          <StatCard icon="🗳️" label="Community Votes" value={a.totalVotes} />
          <StatCard icon="💧" label="Volume Launched" value={a.totalVolume.toFixed(1)} hint={unit} />
          <StatCard icon="💰" label="Fees Earned" value={view.feesEarned.toFixed(3)} hint={unit} />
        </StatGrid>
      </section>

      {/* Rounds launched */}
      <section>
        <SectionTitle title="Rounds Launched" />
        {view.rounds.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            No rounds launched yet.
          </div>
        ) : (
          <div className="space-y-2">
            {view.rounds.map(({ round, summary }) => {
              const rug =
                round.endReason === "rug_detected" || round.endReason === "liquidity_removed";
              return (
                <div
                  key={round.id}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border p-3.5 text-sm transition ${
                    round.graduated
                      ? "border-lime-400/30 bg-lime-400/[0.03]"
                      : rug
                        ? "border-red-900/50 bg-red-500/[0.03]"
                        : "border-zinc-800 bg-zinc-900/40"
                  }`}
                >
                  <Link href={`/round/${round.id}`} className="flex items-center gap-2 hover:underline">
                    {round.token.artworkUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={round.token.artworkUrl}
                        alt=""
                        className="h-9 w-9 rounded-lg border border-zinc-700 object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900">
                        🪙
                      </div>
                    )}
                    <span className="font-bold">
                      {round.token.name} <span className="font-mono text-zinc-500">${round.token.symbol}</span>
                    </span>
                  </Link>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-300">
                    {round.tier}
                  </span>
                  <span
                    className={`text-xs font-bold ${
                      round.state === "live"
                        ? "text-emerald-300"
                        : round.graduated
                          ? "text-lime-300"
                          : rug
                            ? "text-red-300"
                            : "text-zinc-400"
                    }`}
                  >
                    {round.state === "live"
                      ? "● LIVE"
                      : round.graduated
                        ? "🍽️ served up"
                        : rug
                          ? "🔥 burnt"
                          : (round.endReason ?? "").replace(/_/g, " ")}
                  </span>
                  {summary && (
                    <span className="ml-auto font-mono text-[11px] text-zinc-500">
                      vol {summary.totalVolume.toFixed(1)} · peak {summary.peakMcap.toFixed(0)} ·{" "}
                      {summary.holderCount} holders
                    </span>
                  )}
                  {round.state === "results" && !round.graduated && (
                    <RunItBackButton round={round} className={summary ? "" : "ml-auto"} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Submission history */}
      <section>
        <SectionTitle title="Submission History" />
        {view.concepts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            Nothing submitted yet.
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {view.concepts.map((c) => (
              <div key={c.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-bold">
                    {c.name} <span className="font-mono text-zinc-500">${c.symbol}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      STATUS_STYLE[c.status] ?? "bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {c.status}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-zinc-400">{c.theme}</div>
                <div className="mt-1.5 font-mono text-[11px] text-zinc-600">{c.votes} votes</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
