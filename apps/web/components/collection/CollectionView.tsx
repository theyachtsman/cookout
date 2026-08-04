"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import {
  CARD_RARITIES,
  RARITY_MAP,
  type CollectionProgress,
  type CollectionSet,
  type CratePack,
  type CrateResult,
} from "@cookout/shared";
import { api } from "../../lib/api";
import { CollectionBrowser, type BrowserCard } from "./CollectionBrowser";
// Three.js is ~450kB and only ever needed the moment a crate is actually
// opened. Loading it eagerly put it on every profile page, including other
// people's. Split it out so the roster, the sets and the browser cost nothing
// extra, and the 3D scene is fetched on the click that needs it.
const CrateOpening = dynamic(() => import("./CrateOpening").then((m) => m.CrateOpening), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black">
      <div className="text-sm font-black uppercase tracking-[0.3em] text-lime-300">
        Entering the bunker…
      </div>
    </div>
  ),
});

/**
 * The Squad Collection: recruit crates, roster, sets and progress.
 *
 * Used both as the signed-in player's own view (with the crate store) and, in
 * read-only mode, as the Collection tab on a public profile.
 */

interface SetProgress {
  set: CollectionSet;
  total: number;
  owned: number;
  complete: boolean;
  claimed: boolean;
}

interface CollectionData {
  enabled: boolean;
  cards: BrowserCard[];
  packs: CratePack[];
  progress: CollectionProgress | null;
  sets: SetProgress[];
  burgerBalance: number;
}

const SKIP_KEY = "cookout_crate_skip";

export function CollectionView({ address }: { address?: string }) {
  const [data, setData] = useState<CollectionData | null>(null);
  const [opening, setOpening] = useState<CrateResult | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const readOnly = !!address;

  const load = useCallback(() => {
    const path = address ? `/api/collection/${address}` : "/api/collection";
    api<CollectionData>(path)
      .then((d) => setData(address ? { ...d, enabled: true, packs: [], burgerBalance: 0 } : d))
      .catch((e) => setError((e as Error).message));
  }, [address]);
  useEffect(load, [load]);

  const openPack = async (pack: CratePack) => {
    setBusy(pack.key);
    setError("");
    setNote("");
    try {
      const result = await api<CrateResult>("/api/collection/open", { body: { pack: pack.key } });
      setOpening(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  if (error && !data) return <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-300">{error}</div>;
  if (!data) return <div className="py-12 text-center text-sm text-zinc-600">Loading the roster…</div>;

  const p = data.progress;

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      {p && (
        <section className="rounded-2xl bg-gradient-to-br from-lime-500/10 via-zinc-900/40 to-zinc-950 p-5 ring-1 ring-white/10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-lime-300">
                Flame Goon Squad
              </div>
              <h2 className="text-2xl font-black text-zinc-50">
                {readOnly ? "Their roster" : "Your roster"}
              </h2>
            </div>
            <div className="text-right">
              <div className="font-mono text-3xl font-black text-lime-300">{p.percent}%</div>
              <div className="text-[11px] text-zinc-500">
                {p.collected} of {p.total} recruited
              </div>
            </div>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-lime-400 transition-[width]" style={{ width: `${p.percent}%` }} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Collection score", p.score.toLocaleString()],
              ["Sets complete", `${p.setsCompleted} / ${p.setsTotal}`],
              ["Duplicates", String(p.duplicates)],
              ["Missing", String(p.missing)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-zinc-950/60 p-3">
                <div className="text-[10px] uppercase text-zinc-500">{k}</div>
                <div className="font-mono text-lg font-black text-zinc-100">{v}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {CARD_RARITIES.map((r) => {
              const stat = p.byRarity[r.key];
              if (!stat?.total) return null;
              return (
                <span
                  key={r.key}
                  className="rounded-lg px-2 py-1 text-[11px] font-bold"
                  style={{ background: `${r.color}18`, color: r.color }}
                >
                  {r.label} {stat.collected}/{stat.total}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {!readOnly && data.enabled && data.packs.length > 0 && (
        <section className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-white/5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-black uppercase tracking-wide text-zinc-200">Recruit Crates</h3>
            <span className="text-xs text-zinc-500">
              🍔 {Math.floor(data.burgerBalance).toLocaleString()} available
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Bundles save Burgers. They never change the odds — every crate rolls the same table.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.packs.map((pack) => {
              const affordable = data.burgerBalance >= pack.cost;
              const perCrate = pack.cost / pack.crates;
              const base = data.packs[0]!.cost;
              const saving = Math.round((1 - perCrate / base) * 100);
              return (
                <button
                  key={pack.key}
                  disabled={!affordable || !!busy}
                  onClick={() => void openPack(pack)}
                  className={`rounded-2xl p-4 text-left ring-1 transition ${
                    affordable
                      ? "bg-zinc-950/60 ring-white/10 hover:-translate-y-0.5 hover:ring-lime-400/50"
                      : "cursor-not-allowed bg-zinc-950/30 opacity-50 ring-white/5"
                  }`}
                >
                  <div className="text-2xl">📦</div>
                  <div className="mt-1 text-sm font-black text-zinc-100">{pack.label}</div>
                  <div className="font-mono text-lg font-black text-orange-300">🍔 {pack.cost}</div>
                  <div className="text-[10px] text-zinc-600">
                    {perCrate.toFixed(0)} per crate{saving > 0 && ` · save ${saving}%`}
                  </div>
                  {busy === pack.key && <div className="mt-1 text-[10px] text-lime-300">Opening…</div>}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {!readOnly && !data.enabled && (
        <div className="rounded-2xl bg-zinc-900/40 p-5 text-sm text-zinc-400">
          The Collection is closed right now. Your roster is safe — check back soon.
        </div>
      )}

      {data.sets.length > 0 && (
        <section className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-white/5">
          <h3 className="mb-2 text-sm font-black uppercase tracking-wide text-zinc-200">Collection sets</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...data.sets]
              .sort((a, b) => (b.owned / (b.total || 1)) - (a.owned / (a.total || 1)))
              .map(({ set, total, owned, complete }) => (
                <div
                  key={set.id}
                  className={`rounded-xl p-3 ring-1 ${
                    complete ? "bg-lime-400/[0.07] ring-lime-400/40" : "bg-zinc-950/50 ring-white/5"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-black text-zinc-100">{set.name}</span>
                    {complete && <span className="text-[10px] font-black text-lime-300">COMPLETE</span>}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${complete ? "bg-lime-400" : "bg-zinc-500"}`}
                      style={{ width: `${total ? (owned / total) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="mt-1 flex items-baseline justify-between text-[10px] text-zinc-600">
                    <span>
                      {owned} / {total}
                    </span>
                    {(set.xpReward > 0 || set.burgerReward > 0) && (
                      <span>
                        {set.xpReward > 0 && `+${set.xpReward} XP`}
                        {set.burgerReward > 0 && ` 🍔 ${set.burgerReward}`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-white/5">
        <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-200">
          {readOnly ? "Recruited" : "The roster"}
        </h3>
        <CollectionBrowser
          cards={data.cards}
          emptyNote={readOnly ? "No recruits yet." : "Open a Recruit Crate to start your roster."}
        />
      </section>

      {opening && (
        <CrateOpening
          pulls={opening.pulls}
          skipDefault={typeof window !== "undefined" && localStorage.getItem(SKIP_KEY) === "1"}
          onDone={() => {
            const completed = opening.completedSets;
            setOpening(null);
            if (completed.length)
              setNote(
                completed
                  .map((c) => `${c.set.name} complete · +${c.xp} XP · 🍔 +${c.burgers}`)
                  .join("   "),
              );
            load();
          }}
        />
      )}
    </div>
  );
}

/** Compact roster summary for a public profile's Collection tab. */
export function CollectionSummary({ progress }: { progress: CollectionProgress }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {[
        ["Collection", `${progress.percent}%`, "text-lime-300"],
        ["Recruited", `${progress.collected}/${progress.total}`, "text-zinc-100"],
        ["Score", progress.score.toLocaleString(), "text-amber-300"],
        ["Sets", `${progress.setsCompleted}/${progress.setsTotal}`, "text-zinc-100"],
      ].map(([k, v, tone]) => (
        <div key={k} className="rounded-xl bg-zinc-950/60 p-3">
          <div className="text-[10px] uppercase text-zinc-500">{k}</div>
          <div className={`font-mono text-lg font-black ${tone}`}>{v}</div>
        </div>
      ))}
    </div>
  );
}

export { RARITY_MAP };
