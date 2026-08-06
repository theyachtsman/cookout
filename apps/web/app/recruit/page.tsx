"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CARD_RARITIES,
  type CollectionProgress,
  type CollectionSet,
  type CratePack,
  type CrateResult,
} from "@cookout/shared";
import { api } from "../../lib/api";
import { emitBurger } from "../../lib/burgerBus";
import { useSession } from "../../lib/session";
import { useCollectionVisible } from "../../lib/chainOnly";
import { CollectionBrowser, type BrowserCard } from "../../components/collection/CollectionBrowser";

/**
 * Recruit NFT Goon — the one page where crates are bought and opened.
 *
 * Everything to do with recruiting lives here: the Burger store, the odds, the
 * cinematic, and the roster it fills. The wallet slider links in; nothing else
 * opens a crate. Keeping it to one page means the 3D scene has room to be a
 * spectacle rather than something crammed into a drawer.
 */

const CrateOpening = dynamic(
  () => import("../../components/collection/CrateOpening").then((m) => m.CrateOpening),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black">
        <div className="animate-pulse text-sm font-black uppercase tracking-[0.3em] text-lime-300">
          Entering the bunker…
        </div>
      </div>
    ),
  },
);

interface SetProgress {
  set: CollectionSet;
  total: number;
  owned: number;
  complete: boolean;
}

interface Feed {
  enabled: boolean;
  cards: BrowserCard[];
  packs: CratePack[];
  progress: CollectionProgress | null;
  sets: SetProgress[];
  burgerBalance: number;
}

const SKIP_KEY = "cookout_crate_skip";

export default function RecruitPage() {
  const { profile, signIn } = useSession();
  // The route stays in the bundle but says nothing on the public beta: someone
  // guessing /recruit should learn no more than someone who never guessed.
  const collectionVisible = useCollectionVisible();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [opening, setOpening] = useState<CrateResult | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [skipPref, setSkipPref] = useState(false);

  useEffect(() => setSkipPref(localStorage.getItem(SKIP_KEY) === "1"), []);

  const load = useCallback(() => {
    api<Feed>("/api/collection")
      .then(setFeed)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const buy = async (pack: CratePack) => {
    setBusy(pack.key);
    setError("");
    setNote("");
    try {
      const result = await api<CrateResult>("/api/collection/open", { body: { pack: pack.key } });
      setOpening(result);
      // The wallet's live counter follows the spend immediately.
      emitBurger({
        amount: -result.burgersSpent,
        balance: result.burgerBalance,
        source: "loot_box",
        label: "Recruit Crate",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  if (!collectionVisible)
    return (
      <div className="py-24 text-center">
        <div className="text-4xl">🚪</div>
        <p className="mt-3 text-sm text-zinc-400">Nothing here.</p>
        <Link href="/" className="mt-4 inline-block text-sm font-bold text-lime-300 hover:underline">
          Back to the Cook Out
        </Link>
      </div>
    );

  if (!profile)
    return (
      <div className="py-24 text-center">
        <div className="text-4xl">📦</div>
        <p className="mt-3 text-sm text-zinc-400">Sign in to recruit the Flame Goon Squad.</p>
        <button
          onClick={() => void signIn()}
          className="mt-4 rounded-xl bg-lime-400 px-6 py-3 font-black text-zinc-950 hover:bg-lime-300"
        >
          Play Now
        </button>
      </div>
    );

  if (!feed) return <div className="py-24 text-center text-sm text-zinc-600">Opening the bunker…</div>;
  const p = feed.progress;

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500/10 via-zinc-900/50 to-zinc-950 p-6 ring-1 ring-white/10 sm:p-8">
        <div className="text-[11px] font-black uppercase tracking-[0.25em] text-amber-300">
          Flame Goon Squad · Recruitment
        </div>
        <h1 className="mt-1 text-3xl font-black text-zinc-50 sm:text-4xl">Recruit NFT Goon</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-300">
          Spend Burgers on Recruit Crates and build your roster. Every crate rolls the same table —
          bundles save Burgers, never change the odds. Named officers are real members of the Squad:
          recruiting one adds their dossier, and there is only ever one of each.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="rounded-xl bg-zinc-950/70 px-4 py-2 font-mono text-lg font-black text-amber-300">
            🍔 {Math.floor(feed.burgerBalance).toLocaleString()}
          </span>
          <Link
            href="/wallet"
            className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold text-zinc-200 hover:bg-zinc-700"
          >
            Burger wallet & history →
          </Link>
          {p && (
            <span className="text-xs text-zinc-500">
              {p.collected} of {p.total} recruited · {p.percent}% · score {p.score.toLocaleString()}
            </span>
          )}
        </div>
      </header>

      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      {/* the store */}
      <section className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-white/5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-200">Recruit Crates</h2>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <input
              type="checkbox"
              checked={skipPref}
              onChange={(e) => {
                setSkipPref(e.target.checked);
                localStorage.setItem(SKIP_KEY, e.target.checked ? "1" : "0");
              }}
              className="accent-lime-400"
            />
            Skip the opening animation
          </label>
        </div>

        {!feed.enabled ? (
          <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">
            Recruitment is closed right now. Your roster is safe.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {feed.packs.map((pack) => {
              const affordable = feed.burgerBalance >= pack.cost;
              const perCrate = pack.cost / pack.crates;
              const base = feed.packs[0]!.cost;
              const saving = Math.round((1 - perCrate / base) * 100);
              return (
                <button
                  key={pack.key}
                  disabled={!affordable || !!busy}
                  onClick={() => void buy(pack)}
                  className={`group relative overflow-hidden rounded-2xl p-5 text-left ring-1 transition ${
                    affordable
                      ? "bg-gradient-to-br from-amber-500/10 to-zinc-950 ring-amber-400/25 hover:-translate-y-1 hover:ring-amber-400/70"
                      : "cursor-not-allowed bg-zinc-950/40 opacity-50 ring-white/5"
                  }`}
                >
                  {saving > 0 && (
                    <span className="absolute right-2 top-2 rounded-full bg-lime-400/20 px-2 py-0.5 text-[10px] font-black text-lime-300">
                      save {saving}%
                    </span>
                  )}
                  <div className="text-4xl transition group-hover:scale-110">📦</div>
                  <div className="mt-2 text-lg font-black text-zinc-100">
                    {pack.crates > 1 ? `×${pack.crates} Crates` : "1 Crate"}
                  </div>
                  <div className="font-mono text-2xl font-black text-amber-300">🍔 {pack.cost}</div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {perCrate.toFixed(0)} per crate
                  </div>
                  {busy === pack.key && (
                    <div className="mt-1 text-xs font-bold text-lime-300">Opening…</div>
                  )}
                  {!affordable && (
                    <div className="mt-1 text-[11px] text-zinc-600">
                      Need {Math.ceil(pack.cost - feed.burgerBalance)} more
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 rounded-xl bg-zinc-950/50 p-3">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
            Recruit odds
          </div>
          <div className="flex flex-wrap gap-2">
            {CARD_RARITIES.map((r) => {
              const stat = p?.byRarity[r.key];
              if (!stat?.total) return null;
              return (
                <span
                  key={r.key}
                  className="rounded-lg px-2 py-1 text-[11px] font-bold"
                  style={{ background: `${r.color}18`, color: r.color }}
                >
                  {r.label} · {stat.collected}/{stat.total}
                </span>
              );
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-zinc-600">
            Duplicates are kept, never destroyed — quantity is shown on each dossier.
          </p>
        </div>
      </section>

      {/* sets */}
      {feed.sets.length > 0 && (
        <section className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-white/5">
          <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-200">
            Collection sets
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[...feed.sets]
              .sort((a, b) => b.owned / (b.total || 1) - a.owned / (a.total || 1))
              .slice(0, 12)
              .map(({ set, total, owned, complete }) => (
                <div
                  key={set.id}
                  className={`rounded-xl p-3 ring-1 ${
                    complete ? "bg-lime-400/[0.07] ring-lime-400/40" : "bg-zinc-950/50 ring-white/5"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-black text-zinc-100">{set.name}</span>
                    {complete && <span className="text-[10px] font-black text-lime-300">DONE</span>}
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

      {/* the roster */}
      <section className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-white/5">
        <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-zinc-200">Your roster</h2>
        <CollectionBrowser
          cards={feed.cards}
          emptyNote="Open a Recruit Crate to start your roster."
        />
      </section>

      {opening && (
        <CrateOpening
          pulls={opening.pulls}
          skipDefault={skipPref}
          onDone={() => {
            const completed = opening.completedSets;
            setOpening(null);
            if (completed.length)
              setNote(
                completed
                  .map((c) => `🐺 ${c.set.name} complete · +${c.xp} XP · 🍔 +${c.burgers}`)
                  .join("   "),
              );
            load();
          }}
        />
      )}
    </div>
  );
}
