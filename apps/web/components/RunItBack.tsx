"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

/**
 * Run It Back — a second chance for coins that didn't graduate.
 *
 * The button shows on every failed coin card; only the coin's developer can
 * actually fire it (the server re-checks). Anyone else gets the explainer
 * modal instead of a dead click, which doubles as marketing for making your
 * own coin. On success we jump straight to the fresh round's page.
 */

interface RunnableRound {
  id: string;
  creatorAddress: string;
  token: { symbol: string };
}

export function RunItBackButton({ round, className = "" }: { round: RunnableRound; className?: string }) {
  const { profile } = useSession();
  const router = useRouter();
  const [modal, setModal] = useState<"explain" | "error" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Portal target only exists client-side.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDev =
    !!profile && profile.address.toLowerCase() === round.creatorAddress.toLowerCase();

  const click = async (e: React.MouseEvent) => {
    // Cards are usually wrapped in a Link — this button must never navigate.
    e.preventDefault();
    e.stopPropagation();
    if (!isDev) {
      setModal("explain");
      return;
    }
    setBusy(true);
    try {
      const rerun = await api<{ id: string }>(`/api/rounds/${round.id}/runback`, { body: {} });
      router.push(`/round/${rerun.id}`);
    } catch (err) {
      setError((err as Error).message);
      setModal("error");
      setBusy(false);
    }
  };

  const close = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setModal(null);
  };

  return (
    <>
      <button
        onClick={(e) => void click(e)}
        disabled={busy}
        className={`rounded-lg px-3 py-1 text-xs font-black transition disabled:opacity-50 ${
          isDev
            ? "bg-lime-400 text-zinc-950 hover:bg-lime-300"
            : "border border-zinc-700 text-zinc-400 hover:border-lime-400/50 hover:text-zinc-200"
        } ${className}`}
        title={
          isDev
            ? "Re-launch this coin with the exact same setup"
            : "What's Run It Back?"
        }
      >
        🔁 Run It Back{busy ? "…" : ""}
      </button>

      {mounted &&
        modal &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={close}
          >
            <div
              className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {modal === "explain" ? (
                <>
                  <div className="text-3xl">🔁</div>
                  <h3 className="mt-2 text-xl font-black">Run It Back</h3>
                  <p className="mt-2 text-sm text-zinc-400">
                    When a coin doesn&apos;t graduate, its developer gets a second serving:{" "}
                    <b className="text-zinc-200">Run It Back</b> re-launches the coin with the
                    exact same setup (same tier, same match length, same tokenomics) straight
                    into the Arena, no new vote needed.
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    Only <b className="text-zinc-200">${round.token.symbol}</b>&apos;s developer
                    can run this one back. Want a coin of your own to run?
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <a
                      href="/submissions"
                      className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
                    >
                      🔥 Make a Coin
                    </a>
                    <button
                      onClick={close}
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
                    onClick={close}
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
