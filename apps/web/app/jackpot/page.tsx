"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { JackpotPayout, JackpotStanding, JackpotStatus } from "@cookout/shared";
import { api } from "../../lib/api";

const usd0 = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const usd2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const medal = ["🥇", "🥈", "🥉"];

function useCountdown(target: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  let ms = Math.max(0, target - now);
  const d = Math.floor(ms / 86_400_000);
  ms -= d * 86_400_000;
  const h = Math.floor(ms / 3_600_000);
  ms -= h * 3_600_000;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms - m * 60_000) / 1000);
  return `${d}d ${h}h ${m}m ${s}s`;
}

export default function JackpotPage() {
  const [jp, setJp] = useState<JackpotStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api<JackpotStatus>("/api/jackpot").then((d) => alive && setJp(d)).catch(() => {});
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const countdown = useCountdown(jp?.nextPayoutAt ?? Date.now());

  if (!jp) return <div className="py-20 text-center text-zinc-500">Loading the pot…</div>;

  const cur = jp.paperMode ? "pETH" : "ETH";

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-400/40 bg-gradient-to-br from-amber-500/15 via-zinc-950 to-zinc-950 p-8 text-center">
        <div className="pointer-events-none absolute -right-10 -top-10 text-[10rem] opacity-10">🎰</div>
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-amber-400/80">
          The Weekly Jackpot
        </div>
        <div className="mt-3 text-6xl font-black tabular-nums text-amber-300 drop-shadow sm:text-7xl">
          {usd0(jp.poolUsd)}
        </div>
        <div className="mt-1 font-mono text-sm text-zinc-400">
          {jp.poolEth.toFixed(4)} {cur} · 1 ETH ≈ {usd0(jp.ethUsd)}
        </div>
        <div className="mt-5 inline-flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-6 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Pays out in</div>
            <div className="font-mono text-lg font-bold text-lime-300">{countdown}</div>
          </div>
          <div className="h-8 w-px bg-zinc-800" />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Winners</div>
            <div className="font-mono text-lg font-bold">Top 10 by weekly XP</div>
          </div>
          <div className="h-8 w-px bg-zinc-800" />
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">Paid to date</div>
            <div className="font-mono text-lg font-bold">
              {jp.lifetimePaidEth.toFixed(3)} {cur}
            </div>
          </div>
        </div>
        <p className="mx-auto mt-4 max-w-2xl text-sm text-zinc-400">
          Every trade on The Cookout feeds this pot. The more the whole site trades, the bigger it
          grows. At the end of each week (Monday 00:00 UTC) it&apos;s split among the ten players who
          earned the most XP that week, paid automatically{" "}
          {jp.paperMode ? "in paper ETH to your balance" : "in ETH to your wallet"}.
        </p>
      </div>

      {/* Live standings */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-black">This Week&apos;s Leaders · {jp.week}</h2>
          <span className="text-xs text-zinc-500">projected payout if the week ended now</span>
        </div>
        <Standings rows={jp.standings} cur={cur} />
      </section>

      {/* Where the money comes from */}
      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800 p-5">
          <h3 className="text-base font-black">Where the pot comes from</h3>
          <p className="mt-1 text-sm text-zinc-400">
            Every round charges a small trading fee. Here&apos;s how each fee is split:
          </p>
          <FeeBar b={jp.breakdown} />
          <p className="mt-3 text-xs text-zinc-500">
            The jackpot takes <span className="font-bold text-amber-300">{jp.breakdown.jackpotPct}%</span>{" "}
            of every trading fee, half of the platform&apos;s house cut. Nothing is minted for it. It is
            pure fee revenue, so a busy trading week directly means a bigger jackpot.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 p-5">
          <h3 className="text-base font-black">How it&apos;s split across 10 winners</h3>
          <p className="mt-1 text-sm text-zinc-400">
            First, second and third always take the biggest shares; 4th–10th taper down from there.
          </p>
          <PayoutTable weights={jp.payoutWeights} pool={jp.poolEth} ethUsd={jp.ethUsd} cur={cur} />
        </div>
      </section>

      {/* Explainer */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
        <h3 className="text-base font-black">How the Jackpot works</h3>
        <ol className="mt-3 space-y-3 text-sm text-zinc-300">
          {[
            ["Trade drives the pot", `A fixed ${jp.breakdown.jackpotPct}% of all trading fees across every lobby flows into one shared jackpot. There is no cap. The pot is exactly as big as the week's trading makes it.`],
            ["Earn XP to climb", "Everything that grants XP counts toward your weekly total: playing rounds, hitting missions, correct predictions, win streaks. The jackpot rewards activity, so newcomers and veterans compete on the same weekly reset."],
            ["Top 10 get paid", "When the week closes (Monday 00:00 UTC), the ten highest weekly-XP players split the pot. Ranks 1–3 earn the most; 4th–10th receive tapering shares."],
            [`Paid ${jp.paperMode ? "in paper ETH" : "in ETH, automatically"}`, jp.paperMode ? "During the paper beta, winnings land in your paper balance instantly and show on your public profile. In production, the same payout goes out as real ETH to the winning addresses." : "Winnings are sent as ETH straight to the winning addresses and recorded on their public profiles."],
            ["Unfilled shares roll over", "If fewer than ten players earned XP in a week, the unclaimed shares stay in the pot and roll into next week, so the jackpot only ever grows toward a big week."],
          ].map(([t, body], i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-xs font-black text-amber-300">
                {i + 1}
              </span>
              <span>
                <span className="font-bold text-zinc-100">{t}.</span> {body}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-xs text-zinc-500">
          Climbing the weekly board is the fastest way in. Check the{" "}
          <Link href="/leaderboard" className="text-lime-400 hover:underline">
            leaderboard
          </Link>{" "}
          and grab open{" "}
          <Link href="/matches" className="text-lime-400 hover:underline">
            matches
          </Link>
          .
        </p>
      </section>

      {/* Past winners */}
      {jp.history.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-black">Past Payouts</h2>
          <div className="space-y-4">
            {jp.history.map((p) => (
              <PastPayout key={p.week} p={p} cur={cur} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Standings({ rows, cur }: { rows: JackpotStanding[]; cur: string }) {
  if (rows.length === 0)
    return (
      <div className="rounded-2xl border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-500">
        No XP earned yet this week. Play a round to claim the top spot.
      </div>
    );
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800">
      <div className="-mx-1 overflow-x-auto px-1"><table className="w-full min-w-[30rem] text-sm">
        <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-2">#</th>
            <th className="px-4 py-2">Player</th>
            <th className="px-4 py-2 text-right">Weekly XP</th>
            <th className="px-4 py-2 text-right">Projected cut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.address}
              className={`border-t border-zinc-800/60 ${r.rank <= 3 ? "bg-amber-500/[0.04]" : ""}`}
            >
              <td className="px-4 py-2.5 font-mono font-bold text-zinc-400">
                {r.rank <= 3 ? medal[r.rank - 1] : r.rank}
              </td>
              <td className="px-4 py-2.5">
                <Link href={`/profile/${r.address}`} className="hover:underline">
                  {r.badge && <span className="mr-1.5">{r.badge}</span>}
                  {r.displayName ?? short(r.address)}
                </Link>
                <span className="ml-2 text-xs text-zinc-500">
                  Lv{r.level} {r.title}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-zinc-300">
                {r.weeklyXp.toLocaleString()}
              </td>
              <td className="px-4 py-2.5 text-right">
                <span className="font-mono font-bold text-amber-300">{usd2(r.amountUsd)}</span>
                <span className="ml-2 font-mono text-xs text-zinc-500">
                  {r.amountEth.toFixed(4)} {cur}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function FeeBar({ b }: { b: JackpotStatus["breakdown"] }) {
  const segs = [
    ["Jackpot", b.jackpotPct, "bg-amber-400"],
    ["Creator", b.creatorPct, "bg-lime-400"],
    ["Referral", b.referralPct, "bg-sky-400"],
    ["House", b.housePct, "bg-zinc-600"],
  ] as const;
  return (
    <div className="mt-4">
      <div className="flex h-6 overflow-hidden rounded-full">
        {segs.map(([label, pct, color]) => (
          <div
            key={label}
            className={`${color} flex items-center justify-center text-[10px] font-black text-zinc-950`}
            style={{ width: `${pct}%` }}
            title={`${label} ${pct}%`}
          >
            {pct >= 12 ? `${pct}%` : ""}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
        {segs.map(([label, pct, color]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} />
            {label} {pct}%
          </span>
        ))}
      </div>
    </div>
  );
}

function PayoutTable({
  weights,
  pool,
  ethUsd,
  cur,
}: {
  weights: number[];
  pool: number;
  ethUsd: number;
  cur: string;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-zinc-800">
      <div className="-mx-1 overflow-x-auto px-1"><table className="w-full min-w-[30rem] text-sm">
        <thead className="bg-zinc-900 text-left text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-3 py-2">Rank</th>
            <th className="px-3 py-2 text-right">Share</th>
            <th className="px-3 py-2 text-right">At current pot</th>
          </tr>
        </thead>
        <tbody>
          {weights.map((w, i) => {
            const eth = pool * w;
            return (
              <tr key={i} className="border-t border-zinc-800/60">
                <td className="px-3 py-1.5 font-mono">
                  {i < 3 ? medal[i] : ""} {i + 1}
                  {["st", "nd", "rd"][i] ?? "th"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-amber-300">
                  {(w * 100).toFixed(0)}%
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-zinc-400">
                  {usd2(eth * ethUsd)}
                  <span className="ml-1.5 text-xs text-zinc-600">
                    {eth.toFixed(4)} {cur}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}

function PastPayout({ p, cur }: { p: JackpotPayout; cur: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-800 bg-zinc-900/50 px-4 py-2.5">
        <span className="font-black">{p.week}</span>
        <span className="font-mono text-sm text-amber-300">
          {usd0(p.totalUsd)} · {p.totalEth.toFixed(4)} {cur} to {p.winners.length}
        </span>
      </div>
      <div className="divide-y divide-zinc-800/60">
        {p.winners.map((w) => (
          <div key={w.address} className="flex items-center gap-3 px-4 py-2 text-sm">
            <span className="w-8 font-mono text-zinc-500">
              {w.rank <= 3 ? medal[w.rank - 1] : w.rank}
            </span>
            <Link href={`/profile/${w.address}`} className="flex-1 truncate hover:underline">
              {w.badge && <span className="mr-1.5">{w.badge}</span>}
              {w.displayName ?? short(w.address)}
            </Link>
            <span className="font-mono text-xs text-zinc-500">{w.weeklyXp.toLocaleString()} XP</span>
            <span className="w-24 text-right font-mono font-bold text-amber-300">{usd2(w.amountUsd)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
