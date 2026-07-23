"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CREATOR_FEE_SHARE,
  TIER_CONFIGS,
  TIER_UNLOCK_LEVEL,
  type RiskTier,
  type TokenConcept,
} from "@cookout/shared";
import { api } from "../../lib/api";
import { useUnit } from "../../lib/chainOnly";
import { useSession } from "../../lib/session";
import { ImagePicker } from "../../components/ImagePicker";

export default function Submissions() {
  const unit = useUnit();
  const { profile, signIn } = useSession();
  const [concepts, setConcepts] = useState<TokenConcept[]>([]);
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    theme: "",
    pitch: "",
    artworkUrl: "",
    totalSupply: "",
    tier: "rookie" as RiskTier,
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
      setForm({
        name: "",
        symbol: "",
        theme: "",
        pitch: "",
        artworkUrl: "",
        totalSupply: "",
        tier: "rookie",
      });
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

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-zinc-800 p-5">
        <h1 className="mb-1 text-xl font-black">Submit a Token Concept</h1>
        <p className="mb-4 text-xs text-zinc-500">
          Tokens deploy from the platform-audited template only — you supply metadata, never code.
          No mint, pause, or blacklist controls. The community votes — hit the vote bar and your coin
          goes straight onto the match calendar at your chosen tier.
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
            {/* Risk tier — creator-chosen, level-gated like playing the tier. */}
            <div className="md:col-span-2">
              <div className="mb-1.5 text-xs text-zinc-500">
                Risk tier — sets the stakes and pace of your coin&apos;s match
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    ["rookie", "🥾", "Training grounds — gentler stakes, forgiving pace."],
                    ["standard", "⚔️", "The main arena — real pace, real crowds."],
                    ["degen", "☠️", "Max stakes, max chaos. Not for the faint."],
                  ] as Array<[RiskTier, string, string]>
                ).map(([tier, icon, blurb]) => {
                  const unlockAt = TIER_UNLOCK_LEVEL[tier];
                  const locked = (profile.level ?? 1) < unlockAt;
                  const active = form.tier === tier;
                  return (
                    <button
                      key={tier}
                      disabled={locked}
                      onClick={() => setForm({ ...form, tier })}
                      title={locked ? `Reach level ${unlockAt} to launch ${tier} coins` : blurb}
                      className={`rounded-xl border p-3 text-left transition ${
                        active
                          ? "border-lime-400/70 bg-lime-400/10"
                          : locked
                            ? "cursor-not-allowed border-zinc-800 opacity-45"
                            : "border-zinc-700 hover:border-zinc-500"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-black capitalize">
                          {icon} {tier}
                        </span>
                        {locked ? (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
                            🔒 Lv{unlockAt}
                          </span>
                        ) : active ? (
                          <span className="rounded bg-lime-400/20 px-1.5 py-0.5 text-[10px] font-bold text-lime-300">
                            selected
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[11px] leading-snug text-zinc-500">{blurb}</div>
                    </button>
                  );
                })}
              </div>
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
            ["Seed liquidity (rookie)", `${TIER_CONFIGS.rookie.initialEthLiquidity} ${unit}`],
            ["Trade fee", `${TIER_CONFIGS.rookie.tradeFeeBps / 100}% (creator gets ${CREATOR_FEE_SHARE * 100}% of fees)`],
            ["Auction fee", `${TIER_CONFIGS.rookie.auctionFeeBps / 100}%`],
            ["Serves up at", `$40,000 mcap · ${TIER_CONFIGS.rookie.graduationMinHolders} holders · ${TIER_CONFIGS.rookie.graduationMinVolume} ${unit} vol`],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-zinc-900 p-3">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</div>
              <div className="mt-0.5 font-mono text-xs font-bold text-zinc-200">{v}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-lime-400/30 bg-lime-400/[0.05] p-5 text-center">
        <h2 className="text-lg font-black">Submitted? The crowd decides next.</h2>
        <p className="mx-auto mt-1 max-w-lg text-sm text-zinc-400">
          Voting — plus every submission ever made, including the ones that didn&apos;t pass — now
          lives on its own page.
        </p>
        <Link
          href="/vote"
          className="mt-4 inline-block rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
        >
          Go to Community Vote →
        </Link>
      </section>
    </div>
  );
}

