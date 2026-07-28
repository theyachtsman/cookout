"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_GAME_MODE, GAME_MODES, type GameMode, type RiskTier } from "@cookout/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { CoinCard } from "./CoinCard";

/**
 * Run It Back — a second chance for coins that didn't graduate.
 *
 * The button shows on every failed coin card; only the coin's developer can
 * actually fire it (the server re-checks). The dev gets a confirm modal: their
 * coin card, a mode picker (pick how it runs next time), then Confirm / Cancel.
 * Anyone else gets the explainer modal instead of a dead click, which doubles
 * as marketing for making your own coin. On success the coin goes back onto the
 * community vote, and we jump to the vote page so the dev can rally support.
 */

interface RunnableRound {
  id: string;
  creatorAddress: string;
  tier?: RiskTier;
  mode?: GameMode;
  matchMinutes?: number;
  token: { name: string; symbol: string; theme: string; artworkUrl?: string; bannerUrl?: string };
}

export function RunItBackButton({ round, className = "" }: { round: RunnableRound; className?: string }) {
  const { profile } = useSession();
  const router = useRouter();
  const [modal, setModal] = useState<"confirm" | "explain" | "error" | null>(null);
  const [mode, setMode] = useState<GameMode>(round.mode ?? DEFAULT_GAME_MODE);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Portal target only exists client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDev =
    !!profile && profile.address.toLowerCase() === round.creatorAddress.toLowerCase();

  const open = (e: React.MouseEvent) => {
    // Cards are usually wrapped in a Link — this button must never navigate.
    e.preventDefault();
    e.stopPropagation();
    setError("");
    setMode(round.mode ?? DEFAULT_GAME_MODE);
    setModal(isDev ? "confirm" : "explain");
  };

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const back = await api<{ conceptId: string }>(`/api/rounds/${round.id}/runback`, {
        body: { mode },
      });
      router.push(`/vote#coin-${back.conceptId}`);
    } catch (err) {
      setError((err as Error).message);
      setModal("error");
      setBusy(false);
    }
  };

  const close = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) setModal(null);
  };

  return (
    <>
      <button
        onClick={(e) => open(e)}
        className={`rounded-lg px-3 py-1 text-xs font-black transition ${
          isDev
            ? "bg-lime-400 text-zinc-950 hover:bg-lime-300"
            : "border border-zinc-700 text-zinc-400 hover:border-lime-400/50 hover:text-zinc-200"
        } ${className}`}
        title={isDev ? "Put this coin back up for a vote, pick a fresh mode" : "What's Run It Back?"}
      >
        🔁 Run It Back
      </button>

      {mounted &&
        modal &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={close}
          >
            <div
              className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {modal === "confirm" ? (
                <>
                  <div className="text-center">
                    <div className="text-3xl">🔁</div>
                    <h3 className="mt-1 text-xl font-black">Run it back</h3>
                    <p className="mt-1 text-sm text-zinc-400">
                      Put <b className="text-zinc-200">${round.token.symbol}</b> back up for a
                      community vote. Pick how it runs, then rally the crowd to send it to the grill
                      again.
                    </p>
                  </div>

                  <div className="mt-4">
                    <CoinCard
                      coin={{
                        name: round.token.name,
                        symbol: round.token.symbol,
                        theme: round.token.theme,
                        artworkUrl: round.token.artworkUrl,
                        bannerUrl: round.token.bannerUrl,
                        mode,
                      }}
                    />
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 text-xs text-zinc-500">Game mode</div>
                    <div className="grid grid-cols-2 gap-2">
                      {GAME_MODES.map((m) => {
                        const locked = m.disabled || (profile?.level ?? 1) < m.unlockLevel;
                        const active = !locked && mode === m.key;
                        const noRug = !m.rugRules;
                        return (
                          <button
                            key={m.key}
                            disabled={locked}
                            onClick={() => !locked && setMode(m.key)}
                            title={
                              m.disabled
                                ? `${m.name} unlocks later`
                                : locked
                                  ? `Reach level ${m.unlockLevel} to launch ${m.name}`
                                  : m.blurb
                            }
                            className={`rounded-xl border p-2.5 text-left transition ${
                              active
                                ? noRug
                                  ? "border-red-400/70 bg-red-400/10"
                                  : "border-lime-400/70 bg-lime-400/10"
                                : locked
                                  ? "cursor-not-allowed border-zinc-800 opacity-45"
                                  : "border-zinc-700 hover:border-zinc-500"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-sm font-black">{m.name}</span>
                              {m.disabled ? (
                                <span className="text-[9px] font-bold text-zinc-500">🔒 Soon</span>
                              ) : locked ? (
                                <span className="text-[9px] font-bold text-zinc-500">
                                  🔒 Lv{m.unlockLevel}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                              {m.tagline}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {error && <p className="mt-3 text-center text-sm text-red-300">{error}</p>}

                  <div className="mt-5 flex items-center justify-center gap-3">
                    <button
                      onClick={() => void confirm()}
                      disabled={busy}
                      className="rounded-xl bg-lime-400 px-6 py-2.5 font-black text-zinc-950 shadow-lg shadow-lime-400/25 transition hover:bg-lime-300 disabled:opacity-50"
                    >
                      {busy ? "Sending to the vote…" : "🔁 Send Back to the Vote"}
                    </button>
                    <button
                      onClick={(e) => close(e)}
                      disabled={busy}
                      className="text-sm text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : modal === "explain" ? (
                <>
                  <div className="text-3xl">🔁</div>
                  <h3 className="mt-2 text-xl font-black">Run It Back</h3>
                  <p className="mt-2 text-sm text-zinc-400">
                    When a coin doesn&apos;t graduate, its developer gets a second serving:{" "}
                    <b className="text-zinc-200">Run It Back</b> puts the coin back up for a
                    community vote in whatever mode they choose. Get the votes and it heads to the
                    grill again.
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    Only <b className="text-zinc-200">${round.token.symbol}</b>&apos;s developer can
                    run this one back. Want a coin of your own to run?
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <a
                      href="/submissions"
                      className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
                    >
                      🔥 Launch a Coin
                    </a>
                    <button
                      onClick={(e) => close(e)}
                      className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-bold text-zinc-300 hover:border-zinc-500"
                    >
                      Got it
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-3xl">🚧</div>
                  <h3 className="mt-2 text-xl font-black">Couldn&apos;t run it back</h3>
                  <p className="mt-2 text-sm text-red-300">{error}</p>
                  <button
                    onClick={(e) => close(e)}
                    className="mt-4 rounded-lg border border-zinc-700 px-4 py-2 text-sm font-bold text-zinc-300 hover:border-zinc-500"
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
