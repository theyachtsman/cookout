"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Round, RoundSummary, TokenConcept } from "@cookout/shared";
import { api } from "../../../lib/api";

interface CreatorView {
  address: string;
  displayName?: string;
  level: number;
  title: string;
  creatorReputation: number;
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

function reputationTier(rep: number): string {
  if (rep < 0) return "Flagged";
  if (rep >= 20) return "Elite";
  if (rep >= 10) return "Trusted";
  if (rep >= 3) return "Established";
  return "New";
}

export default function CreatorPage() {
  const { address } = useParams<{ address: string }>();
  const [view, setView] = useState<CreatorView | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    api<CreatorView>(`/api/creator/${address}`)
      .then(setView)
      .catch(() => setMissing(true));
  }, [address]);

  if (missing) return <div className="p-10 text-center text-zinc-500">No creator record for this address.</div>;
  if (!view) return <div className="p-10 text-center text-zinc-500">Loading…</div>;

  const a = view.aggregates;
  const tier = reputationTier(view.creatorReputation);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-800 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-black">
            {view.displayName ?? `${view.address.slice(0, 8)}…${view.address.slice(-6)}`}
          </h1>
          <span
            className={`rounded px-2 py-0.5 text-xs font-bold ${
              tier === "Flagged"
                ? "bg-red-500/20 text-red-300"
                : tier === "Elite" || tier === "Trusted"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-zinc-800 text-zinc-300"
            }`}
          >
            {tier} creator
          </span>
          <Link href={`/profile/${view.address}`} className="ml-auto text-sm text-zinc-400 hover:text-zinc-200">
            player profile →
          </Link>
        </div>
        <div className="mt-1 text-sm text-zinc-400">
          Reputation {view.creatorReputation} · fees earned {view.feesEarned.toFixed(3)} pETH
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ["Submissions", a.submissions],
          ["Launched", a.roundsLaunched],
          ["Served up", a.graduations],
          ["Rugs", a.rugs],
          ["Community votes", a.totalVotes],
          ["Volume launched", `${a.totalVolume.toFixed(1)}`],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-lg border border-zinc-800 p-3">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</div>
            <div className="font-mono text-lg font-bold">{v}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-bold">Rounds Launched</h2>
        <div className="space-y-2">
          {view.rounds.map(({ round, summary }) => (
            <Link
              key={round.id}
              href={`/round/${round.id}`}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-3 text-sm hover:border-zinc-600"
            >
              <span className="font-bold">
                {round.token.name} <span className="text-zinc-500">${round.token.symbol}</span>
              </span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs uppercase">{round.tier}</span>
              <span className="text-xs text-zinc-400">
                {round.state === "live"
                  ? "LIVE"
                  : round.graduated
                    ? "🍽️ served up"
                    : (round.endReason ?? "").replace(/_/g, " ")}
              </span>
              {summary && (
                <span className="ml-auto font-mono text-xs text-zinc-500">
                  vol {summary.totalVolume.toFixed(1)} · peak mcap {summary.peakMcap.toFixed(0)} ·{" "}
                  {summary.holderCount} holders
                </span>
              )}
            </Link>
          ))}
          {view.rounds.length === 0 && <div className="text-sm text-zinc-500">No rounds launched yet.</div>}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-lg font-bold">Submission History</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {view.concepts.map((c) => (
            <div key={c.id} className="rounded-lg border border-zinc-800 p-3 text-sm">
              <span className="font-bold">
                {c.name} <span className="text-zinc-500">${c.symbol}</span>
              </span>
              <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-xs">{c.status}</span>
              <span className="ml-2 font-mono text-xs text-zinc-500">{c.votes} votes</span>
              <div className="mt-1 text-xs text-zinc-400">{c.theme}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
