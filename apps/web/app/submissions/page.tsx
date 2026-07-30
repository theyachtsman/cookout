"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  CREATOR_FEE_SHARE,
  DEFAULT_GAME_MODE,
  DEFAULT_PIT_DURATION,
  GAME_MODES,
  GAME_MODE_MAP,
  MODIFIERS,
  PIT_DURATIONS,
  TIER_CONFIGS,
  type GameMode,
  type PitDurationKey,
  type TokenConcept,
} from "@cookout/shared";
import { api } from "../../lib/api";
import { useUnit } from "../../lib/chainOnly";
import { useSession } from "../../lib/session";
import { CoinCard } from "../../components/CoinCard";
import { ImagePicker } from "../../components/ImagePicker";

/** The coin's social inputs, in display order. Keys match CoinSocials. */
const SOCIAL_FIELDS = [
  { key: "x", icon: "𝕏", placeholder: "@handle or x.com/…" },
  { key: "telegram", icon: "✈️", placeholder: "@group or t.me/…" },
  { key: "youtube", icon: "▶️", placeholder: "youtube.com/@…" },
  { key: "instagram", icon: "📸", placeholder: "@handle or instagram.com/…" },
  { key: "website", icon: "🌐", placeholder: "yourcoin.xyz" },
] as const;

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
    bannerUrl: "",
    totalSupply: "",
    gameType: "cookout" as "cookout" | "pit",
    mode: DEFAULT_GAME_MODE as GameMode,
    pitDuration: DEFAULT_PIT_DURATION as PitDurationKey,
    socials: { x: "", telegram: "", youtube: "", instagram: "", website: "" },
    modifiers: { overtime: false },
  });
  const [error, setError] = useState("");
  // The just-submitted concept — drives the "your coin is live" preview modal.
  const [created, setCreated] = useState<TokenConcept | null>(null);
  // Two-step submit: "preview" shows the coin card for a final look before
  // anything is created; confirming actually submits.
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  useEffect(() => setMounted(true), []);

  const load = useCallback(() => {
    api<TokenConcept[]>("/api/concepts")
      .then(setConcepts)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  // Deep link from The Pit ("Launch a Pit match") preselects the game type.
  // Read from the URL directly (no useSearchParams) so the page needs no
  // Suspense boundary at build time.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("type") === "pit")
      setForm((f) => (f.gameType === "pit" ? f : { ...f, gameType: "pit" }));
  }, []);

  // The Pit launches directly (no vote): create + go straight to the lobby.
  const launchPit = async () => {
    setError("");
    if (!form.name.trim() || !form.symbol.trim() || !form.theme.trim()) {
      setError("name, symbol, and theme are required");
      return;
    }
    setSubmitting(true);
    try {
      const { round } = await api<{ round: { id: string } }>("/api/pit/launch", {
        body: {
          name: form.name,
          symbol: form.symbol,
          theme: form.theme,
          pitch: form.pitch || undefined,
          artworkUrl: form.artworkUrl || undefined,
          bannerUrl: form.bannerUrl || undefined,
          socials: form.socials,
          duration: form.pitDuration,
        },
      });
      router.push(`/pit/${round.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Step 1: nothing is created yet — validate and show the card preview.
  const openPreview = () => {
    setError("");
    if (!form.name.trim() || !form.symbol.trim() || !form.theme.trim()) {
      setError("name, symbol, and theme are required");
      return;
    }
    setPreviewing(true);
  };

  // Step 2: the player confirmed — actually submit the concept.
  const confirmSubmit = async () => {
    setError("");
    setSubmitting(true);
    try {
      const concept = await api<TokenConcept>("/api/concepts", {
        body: {
          ...form,
          artworkUrl: form.artworkUrl || undefined,
          bannerUrl: form.bannerUrl || undefined,
          totalSupply: form.totalSupply ? Number(form.totalSupply) : undefined,
        },
      });
      setPreviewing(false);
      setCreated(concept);
      setForm({
        name: "",
        symbol: "",
        theme: "",
        pitch: "",
        artworkUrl: "",
        bannerUrl: "",
        totalSupply: "",
        gameType: "cookout",
        mode: DEFAULT_GAME_MODE,
        pitDuration: DEFAULT_PIT_DURATION,
        socials: { x: "", telegram: "", youtube: "", instagram: "", website: "" },
        modifiers: { overtime: false },
      });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
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
      <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-lime-400/[0.1] via-zinc-900/40 to-zinc-900/40 p-6">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">
          Launch a Coin
        </div>
        <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">
          Put your coin on the grill.
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Supply the name, art, and story. Your token deploys from the platform-audited template, so
          there are no mint, pause, or blacklist controls. Pick a game mode, rally the votes, and it
          heads straight to the Cook Out.
        </p>
        <Link
          href="/vote"
          className="mt-4 inline-block rounded-lg bg-zinc-800 px-5 py-2 font-bold text-zinc-200 transition hover:bg-zinc-700 hover:text-lime-300"
        >
          See what&apos;s up for a vote →
        </Link>
      </header>

      <section className="rounded-2xl bg-zinc-900/40 p-5">
        <h2 className="mb-1 text-lg font-black">Your coin</h2>
        <p className="mb-4 text-xs text-zinc-500">
          You supply the metadata, never the code. Hit the vote bar and your coin goes straight to
          the Cook Out in its chosen mode.
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
              className="rounded bg-zinc-950/60 outline-none focus:ring-2 focus:ring-lime-400/30 px-3 py-2 text-sm"
            />
            <input
              placeholder="SYMBOL"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
              className="rounded bg-zinc-950/60 outline-none focus:ring-2 focus:ring-lime-400/30 px-3 py-2 font-mono text-sm"
            />
            <input
              placeholder="Theme (one line)"
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value })}
              className="rounded bg-zinc-950/60 outline-none focus:ring-2 focus:ring-lime-400/30 px-3 py-2 text-sm md:col-span-2"
            />
            <textarea
              placeholder="Pitch (optional)"
              value={form.pitch}
              onChange={(e) => setForm({ ...form, pitch: e.target.value })}
              className="rounded bg-zinc-950/60 outline-none focus:ring-2 focus:ring-lime-400/30 px-3 py-2 text-sm md:col-span-2"
              rows={2}
            />
            {/* Socials — shown as interactive badges on the coin's trading banner. */}
            <div className="md:col-span-2">
              <div className="mb-1.5 text-xs text-zinc-500">
                Socials (optional) · shown as badges on your coin&apos;s trading banner
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SOCIAL_FIELDS.map((f) => (
                  <div
                    key={f.key}
                    className="flex items-center gap-2 rounded bg-zinc-950/60 outline-none focus:ring-2 focus:ring-lime-400/30 px-2.5"
                  >
                    <span className="w-5 shrink-0 text-center text-sm">{f.icon}</span>
                    <input
                      placeholder={f.placeholder}
                      value={form.socials[f.key]}
                      onChange={(e) =>
                        setForm({ ...form, socials: { ...form.socials, [f.key]: e.target.value } })
                      }
                      className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-6 md:col-span-2">
              <ImagePicker
                label="Coin image"
                value={form.artworkUrl || undefined}
                onChange={(dataUrl) => setForm({ ...form, artworkUrl: dataUrl })}
              />
              <ImagePicker
                label="Promo banner (wide, optional)"
                wide
                size={1024}
                value={form.bannerUrl || undefined}
                onChange={(dataUrl) => setForm({ ...form, bannerUrl: dataUrl })}
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
                  className="w-44 rounded bg-zinc-950/60 outline-none focus:ring-2 focus:ring-lime-400/30 px-3 py-2 font-mono text-sm"
                />
              </label>
            </div>
            {/* Game Type — Standard Cookout (PvP) or The Pit (PvE vs Swarm AI). */}
            <div className="md:col-span-2">
              <div className="mb-1.5 text-xs text-zinc-500">Game type</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { key: "cookout" as const, name: "Standard Cookout", blurb: "PvP. The crowd votes it up, then everyone trades against each other.", accent: "lime" },
                  { key: "pit" as const, name: "The Pit", blurb: "PvE vs Swarm AI. Launches straight to the lobby. Predict or trade the Swarm.", accent: "fuchsia" },
                ].map((gt) => {
                  const active = form.gameType === gt.key;
                  return (
                    <button
                      key={gt.key}
                      onClick={() => setForm({ ...form, gameType: gt.key })}
                      className={`rounded-xl p-3 text-left transition ring-1 ${
                        active
                          ? gt.accent === "fuchsia"
                            ? "bg-fuchsia-500/15 ring-fuchsia-400/50"
                            : "bg-lime-400/15 ring-lime-400/50"
                          : "bg-zinc-800/60 ring-white/10 hover:bg-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black">{gt.name}</span>
                        {active && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              gt.accent === "fuchsia" ? "bg-fuchsia-500/20 text-fuchsia-300" : "bg-lime-400/20 text-lime-300"
                            }`}
                          >
                            selected
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] leading-snug text-zinc-500">{gt.blurb}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {form.gameType === "pit" ? (
              <div className="md:col-span-2">
                <div className="mb-1.5 text-xs text-zinc-500">
                  Match duration · sets the live trading length
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {PIT_DURATIONS.map((dur) => {
                    const active = form.pitDuration === dur.key;
                    return (
                      <button
                        key={dur.key}
                        onClick={() => setForm({ ...form, pitDuration: dur.key })}
                        className={`rounded-xl p-3 text-left transition ring-1 ${
                          active ? "bg-fuchsia-500/15 ring-fuchsia-400/50" : "bg-zinc-800/60 ring-white/10 hover:bg-zinc-700"
                        }`}
                      >
                        <div className="text-sm font-black">
                          {dur.icon} {dur.name}
                        </div>
                        <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                          {dur.tagline}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 rounded-lg bg-fuchsia-500/[0.08] p-3 text-xs text-zinc-300">
                  <b className="text-fuchsia-300">Powered by Swarm AI.</b> The Pit skips the vote and
                  opens a lobby immediately. Players pay to predict the outcome, trade a paper stack
                  against the Swarm, or both. There is no dev bag and nobody launches banned.
                </div>
              </div>
            ) : (
              <>
            {/* Game mode — the single curated choice: bundles length + rules. */}
            <div className="md:col-span-2">
              <div className="mb-1.5 text-xs text-zinc-500">
                Game mode · picks the length and the rules of your coin&apos;s match
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {GAME_MODES.map((m) => {
                  const locked = m.disabled || (profile.level ?? 1) < m.unlockLevel;
                  const active = !locked && form.mode === m.key;
                  const noRug = !m.rugRules;
                  return (
                    <button
                      key={m.key}
                      disabled={locked}
                      onClick={() => !locked && setForm({ ...form, mode: m.key })}
                      title={
                        m.disabled
                          ? `${m.name} unlocks later`
                          : locked
                            ? `Reach level ${m.unlockLevel} to launch ${m.name}`
                            : m.blurb
                      }
                      className={`rounded-xl p-3 text-left transition ${
                        active
                          ? noRug
                            ? "bg-red-400/20"
                            : "bg-lime-400/20"
                          : locked
                            ? "cursor-not-allowed bg-zinc-900/40 opacity-45"
                            : "bg-zinc-800/60 hover:bg-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black">{m.name}</span>
                        {m.disabled ? (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
                            🔒 Soon
                          </span>
                        ) : locked ? (
                          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
                            🔒 Lv{m.unlockLevel}
                          </span>
                        ) : active ? (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              noRug ? "bg-red-400/20 text-red-300" : "bg-lime-400/20 text-lime-300"
                            }`}
                          >
                            selected
                          </span>
                        ) : (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              noRug ? "bg-red-500/15 text-red-300/80" : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {noRug ? "rug rules off" : "standard rules"}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                        {m.tagline} · {m.pullUpCap} {unit} pull-up cap
                      </div>
                      <div className="mt-1 text-[11px] leading-snug text-zinc-500">{m.blurb}</div>
                    </button>
                  );
                })}
              </div>
              {!GAME_MODE_MAP[form.mode].rugRules && (
                <div className="mt-2 rounded-lg bg-red-500/[0.1] p-3 text-xs text-zinc-300">
                  <b className="text-red-300">🔥 {GAME_MODE_MAP[form.mode].name}: rug rules off.</b>{" "}
                  No dev-dump auto-rug, no pool-drain rug, no dev sell lock. As the dev you can{" "}
                  <b>sell whenever and however much you want</b> with zero reputation hit and no
                  launch ban. Nobody gets &quot;rugged,&quot; the price action is the whole game.
                  Traders, it&apos;s fast and it&apos;s violent. Get in, get a bag, get out.
                </div>
              )}
            </div>
            {/* Modifiers — optional tweaks layered on the mode. */}
            <div className="md:col-span-2">
              <div className="mb-1.5 text-xs text-zinc-500">
                Modifiers · optional tweaks on top of your mode
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODIFIERS.map((mod) => {
                  const on = !!form.modifiers[mod.key];
                  return (
                    <button
                      key={mod.key}
                      onClick={() =>
                        setForm({
                          ...form,
                          modifiers: { ...form.modifiers, [mod.key]: !on },
                        })
                      }
                      title={mod.blurb}
                      className={`flex items-start gap-3 rounded-xl p-3 text-left transition ${
                        on ? "bg-sky-400/20" : "bg-zinc-800/60 hover:bg-zinc-700"
                      }`}
                    >
                      <span className="text-lg leading-none">{mod.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-black">{mod.name}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              on ? "bg-sky-400/20 text-sky-300" : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {on ? "ON" : "OFF"}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                          {mod.tagline}
                        </span>
                        <span className="mt-1 block text-[11px] leading-snug text-zinc-500">
                          {mod.blurb}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
              </>
            )}
            {form.gameType === "pit" ? (
              <button
                onClick={launchPit}
                disabled={submitting}
                className="w-fit rounded-lg bg-fuchsia-500 px-5 py-2 font-black text-zinc-950 hover:bg-fuchsia-400 disabled:opacity-40"
              >
                {submitting ? "Launching…" : "Enter The Pit →"}
              </button>
            ) : (
              <button
                onClick={openPreview}
                className="w-fit rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
              >
                Preview &amp; Submit
              </button>
            )}
          </div>
        )}
        {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      </section>

      <section className="rounded-2xl bg-zinc-900/40 p-5">
        <h2 className="mb-1 text-lg font-bold">Tokenomics, declared up front</h2>
        <p className="mb-3 text-xs text-zinc-500">
          Every launch uses the platform template. Creators choose name, art, and total supply, and
          nothing else. No creator mint, pause, or blacklist. Ever.
        </p>
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
          {[
            ["Supply in pool at open", "50%"],
            ["Seed liquidity (Classic)", `${TIER_CONFIGS.standard.initialEthLiquidity} ${unit}`],
            ["Trade fee", `${TIER_CONFIGS.standard.tradeFeeBps / 100}% (creator gets ${CREATOR_FEE_SHARE * 100}% of fees)`],
            ["Auction fee", `${TIER_CONFIGS.standard.auctionFeeBps / 100}%`],
            ["Serves up at", `$40,000 mcap · ${TIER_CONFIGS.standard.graduationMinHolders} holders · ${TIER_CONFIGS.standard.graduationMinVolume} ${unit} vol`],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg bg-zinc-950/50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</div>
              <div className="mt-0.5 font-mono text-xs font-bold text-zinc-200">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-red-500/[0.08] p-3 text-xs text-zinc-300">
          <b className="text-red-300">🔥 The rug rule:</b> in <b>Classic</b> and <b>Pressure</b> you
          can trade your own coin like anyone else, but <b>selling 75% of the most you ever held</b>{" "}
          (cumulative) pulls the launch and brands it Burnt, which tanks your reputation and bans you
          from launching. Trim to take profit; don&apos;t full-send your own bag.{" "}
          <b className="text-amber-300">Blitz and Reflex turn rug rules off</b>: no auto-rug, no
          sell lock, no penalty. The price action is the whole game.
        </div>
      </section>

      <section className="rounded-2xl bg-lime-400/[0.08] p-5 text-center">
        <h2 className="text-lg font-black">Submitted? The crowd decides next.</h2>
        <p className="mx-auto mt-1 max-w-lg text-sm text-zinc-400">
          Voting lives on its own page now, alongside every submission ever made, including the
          ones that didn&apos;t pass.
        </p>
        <Link
          href="/vote"
          className="mt-4 inline-block rounded-lg bg-lime-400 px-5 py-2 font-black text-zinc-950 hover:bg-lime-300"
        >
          Go to Community Vote →
        </Link>
      </section>

      {/* Pre-submit confirmation: look the card over before it's created. */}
      {mounted &&
        previewing &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <div
              onClick={() => !submitting && setPreviewing(false)}
              className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            />
            <div className="relative w-full max-w-md">
              <div className="mb-3 text-center">
                <div className="text-3xl">👀</div>
                <h2 className="mt-1 text-xl font-black tracking-tight text-zinc-50">
                  Look it over. Are you sure?
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  This is exactly how your coin will appear on the ballot and across the Cook Out,
                  from the lineup to the live chart. Once submitted it can&apos;t be edited.
                </p>
              </div>
              <CoinCard
                coin={{
                  name: form.name.trim(),
                  symbol: form.symbol.trim().toUpperCase().slice(0, 8),
                  theme: form.theme.trim(),
                  artworkUrl: form.artworkUrl || undefined,
                  bannerUrl: form.bannerUrl || undefined,
                  mode: form.mode,
                  tier: GAME_MODE_MAP[form.mode].tier,
                  matchMinutes: GAME_MODE_MAP[form.mode].minutes ?? undefined,
                  modifiers: form.modifiers,
                }}
              />
              {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
              <div className="mt-4 flex items-center justify-center gap-3">
                <button
                  disabled={submitting}
                  onClick={() => void confirmSubmit()}
                  className="rounded-xl bg-lime-400 px-6 py-2.5 font-black text-zinc-950 shadow-lg shadow-lime-400/25 transition hover:bg-lime-300 disabled:opacity-50"
                >
                  {submitting ? "Submitting…" : "✓ Confirm & Submit"}
                </button>
                <button
                  disabled={submitting}
                  onClick={() => setPreviewing(false)}
                  className="text-sm text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                >
                  Cancel, keep editing
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Post-submit payoff: the coin's promo card, then straight to the vote. */}
      {mounted &&
        created &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <div
              onClick={() => setCreated(null)}
              className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            />
            <div className="relative w-full max-w-md">
              <div className="mb-3 text-center">
                <div className="text-3xl">🔥</div>
                <h2 className="mt-1 text-xl font-black tracking-tight text-zinc-50">
                  Your coin is on the ballot!
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  This is how it&apos;ll look at the Cook Out. The crowd votes now. Hit the bar and
                  it goes straight to the Cook Out at your tier.
                </p>
              </div>
              <CoinCard coin={created} />
              <div className="mt-4 flex items-center justify-center gap-3">
                <button
                  onClick={() => {
                    setCreated(null);
                    router.push("/vote");
                  }}
                  className="rounded-xl bg-lime-400 px-6 py-2.5 font-black text-zinc-950 shadow-lg shadow-lime-400/25 transition hover:bg-lime-300"
                >
                  Watch the votes →
                </button>
                <button
                  onClick={() => setCreated(null)}
                  className="text-sm text-zinc-500 hover:text-zinc-300"
                >
                  stay here
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

