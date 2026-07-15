"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CREATOR_FEE_SHARE,
  TIER_CONFIGS,
  VOTE_THRESHOLD,
  VOTING_WINDOW_MS,
  type TokenConcept,
} from "@cookout/shared";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { ImagePicker } from "../../components/ImagePicker";

export default function Submissions() {
  const { profile, signIn } = useSession();
  const [concepts, setConcepts] = useState<TokenConcept[]>([]);
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    theme: "",
    pitch: "",
    artworkUrl: "",
    totalSupply: "",
  });
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<TokenConcept[]>("/api/concepts")
      .then(setConcepts)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const submit = async () => {
    setError("");
    try {
      await api("/api/concepts", {
        body: {
          ...form,
          artworkUrl: form.artworkUrl || undefined,
          totalSupply: form.totalSupply ? Number(form.totalSupply) : undefined,
        },
      });
      setForm({ name: "", symbol: "", theme: "", pitch: "", artworkUrl: "", totalSupply: "" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const vote = async (id: string) => {
    setError("");
    try {
      await api(`/api/concepts/${id}/vote`, { body: {} });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const statusStyle: Record<string, string> = {
    submitted: "bg-zinc-800 text-zinc-300",
    shortlisted: "bg-sky-500/20 text-sky-300",
    scheduled: "bg-lime-400/20 text-lime-300",
    launched: "bg-emerald-500/20 text-emerald-300",
    rejected: "bg-red-500/20 text-red-300",
  };

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-zinc-800 p-5">
        <h1 className="mb-1 text-xl font-black">Submit a Token Concept</h1>
        <p className="mb-4 text-xs text-zinc-500">
          Tokens deploy from the platform-audited template only — you supply metadata, never code.
          No mint, pause, or blacklist controls. Community votes, the Arena Committee shortlists,
          winners get a match slot.
        </p>
        {!profile ? (
          <button
            onClick={() => void signIn()}
            className="rounded-lg bg-lime-400 px-4 py-2 font-black text-zinc-950"
          >
            Connect Wallet to Submit
          </button>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <input
              placeholder="Token name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            />
            <input
              placeholder="SYMBOL"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
            />
            <input
              placeholder="Theme (one line)"
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value })}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm md:col-span-2"
            />
            <textarea
              placeholder="Pitch (optional)"
              value={form.pitch}
              onChange={(e) => setForm({ ...form, pitch: e.target.value })}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm md:col-span-2"
              rows={2}
            />
            <div className="flex flex-wrap items-end gap-6 md:col-span-2">
              <ImagePicker
                label="Coin image"
                value={form.artworkUrl || undefined}
                onChange={(dataUrl) => setForm({ ...form, artworkUrl: dataUrl })}
              />
              <label className="text-sm">
                <div className="mb-1 text-xs text-zinc-500">
                  Total supply (100K – 1B, default 2,000,000)
                </div>
                <input
                  placeholder="2000000"
                  value={form.totalSupply}
                  onChange={(e) =>
                    setForm({ ...form, totalSupply: e.target.value.replace(/[^0-9]/g, "") })
                  }
                  className="w-44 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
                />
              </label>
            </div>
            <button
              onClick={() => void submit()}
              className="w-fit rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
            >
              Submit Concept
            </button>
          </div>
        )}
        {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      </section>

      <section className="rounded-xl border border-zinc-800 p-5">
        <h2 className="mb-1 text-lg font-bold">Tokenomics — declared up front</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Every launch uses the platform template. Creators choose name, art, and total supply —
          nothing else. No creator mint, pause, or blacklist. Ever.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          {[
            ["Supply in pool at open", "50%"],
            ["Seed liquidity (rookie)", `${TIER_CONFIGS.rookie.initialEthLiquidity} pETH`],
            ["Trade fee", `${TIER_CONFIGS.rookie.tradeFeeBps / 100}% (creator gets ${CREATOR_FEE_SHARE * 100}% of fees)`],
            ["Auction fee", `${TIER_CONFIGS.rookie.auctionFeeBps / 100}%`],
            ["Serves up at", `$40,000 mcap · ${TIER_CONFIGS.rookie.graduationMinHolders} holders · ${TIER_CONFIGS.rookie.graduationMinVolume} pETH vol`],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-zinc-900 p-3">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</div>
              <div className="mt-0.5 font-mono text-xs font-bold text-zinc-200">{v}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold">Voting Now</h2>
        <p className="mb-3 text-xs text-zinc-500">
          {VOTE_THRESHOLD} upvotes sends a concept to the committee shortlist. Submissions that
          don&apos;t hit the threshold within {Math.round(VOTING_WINDOW_MS / 3_600_000)} hours are
          closed.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {concepts
            .filter((c) => c.status === "submitted" || c.status === "shortlisted")
            .map((c) => (
            <div key={c.id} className="rounded-xl border border-zinc-800 p-4">
              <div className="flex items-start justify-between">
                <div className="flex gap-3">
                  {c.artworkUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.artworkUrl}
                      alt=""
                      className="h-12 w-12 rounded-lg border border-zinc-700 object-cover"
                    />
                  )}
                  <div>
                  <div className="font-black">
                    {c.name} <span className="text-zinc-500">${c.symbol}</span>
                  </div>
                  <div className="text-sm text-zinc-400">{c.theme}</div>
                  {c.pitch && <div className="mt-1 text-xs text-zinc-500">{c.pitch}</div>}
                  <div className="mt-1 text-xs text-zinc-600">
                    Launched by{" "}
                    <a href={`/creator/${c.creatorAddress}`} className="hover:underline">
                      {c.creatorAddress.slice(0, 6)}…{c.creatorAddress.slice(-4)}
                    </a>
                  </div>
                  </div>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs ${statusStyle[c.status]}`}>
                  {c.status}
                </span>
              </div>
              <div className="mt-2 text-xs text-zinc-500">
                Supply: <span className="font-mono text-zinc-300">{(c.totalSupply ?? 2_000_000).toLocaleString()}</span>
              </div>
              {c.status === "submitted" ? (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
                    <div
                      className="h-full bg-lime-400"
                      style={{ width: `${Math.min(100, (c.votes / VOTE_THRESHOLD) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-zinc-500">
                    <span>
                      {c.votes}/{VOTE_THRESHOLD} votes to shortlist
                    </span>
                    <span>{timeLeft(c.createdAt)}</span>
                  </div>
                </>
              ) : (
                <div className="mt-2 text-xs font-bold text-sky-300">
                  ✓ Vote passed — awaiting a match slot
                </div>
              )}
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => void vote(c.id)}
                  disabled={!profile || c.status !== "submitted"}
                  className="rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 disabled:opacity-40"
                >
                  ▲ Upvote
                </button>
                <span className="font-mono text-sm text-zinc-400">{c.votes} votes</span>
              </div>
            </div>
          ))}
          {concepts.filter((c) => c.status === "submitted" || c.status === "shortlisted").length ===
            0 && <div className="text-sm text-zinc-500">Nothing up for a vote — submit one.</div>}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold text-zinc-300">Previous Submissions</h2>
        <div className="grid gap-2 md:grid-cols-3">
          {concepts
            .filter((c) => c.status === "scheduled" || c.status === "launched" || c.status === "rejected")
            .map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 p-3 text-sm">
                {c.artworkUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.artworkUrl} alt="" className="h-9 w-9 rounded object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">
                    {c.name} <span className="text-zinc-500">${c.symbol}</span>
                  </div>
                  <div className="text-xs text-zinc-500">{c.votes} votes</div>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs ${statusStyle[c.status]}`}>
                  {c.status === "launched" ? "🎓 launched" : c.status}
                </span>
              </div>
            ))}
          {concepts.filter((c) => ["scheduled", "launched", "rejected"].includes(c.status)).length ===
            0 && <div className="text-sm text-zinc-500">No history yet.</div>}
        </div>
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
