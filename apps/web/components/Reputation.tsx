"use client";

import { useEffect, useState } from "react";
import type { RugBan } from "@cookout/shared";
import { api } from "../lib/api";

/**
 * The reputation panel — one component, three homes: your own profile (with
 * the self-serve "Clear my ban" button on paper-beta environments), the
 * public player profile, and the creator page.
 *
 * The rule it renders: a rug ban blocks launching coins, never chatting or
 * trading. On paper beta the player lifts it themselves (the record stays);
 * on wait-out environments the ban carries an expiry from the escalation
 * schedule and only time or an admin lifts it.
 */

export function repStanding(rep: number): { label: string; cls: string } {
  if (rep < 0) return { label: "In the red", cls: "bg-red-500/20 text-red-300" };
  if (rep >= 20) return { label: "Elite", cls: "bg-emerald-500/20 text-emerald-300" };
  if (rep >= 10) return { label: "Trusted", cls: "bg-emerald-500/20 text-emerald-300" };
  if (rep >= 3) return { label: "Established", cls: "bg-zinc-800 text-zinc-300" };
  return { label: "New", cls: "bg-zinc-800 text-zinc-300" };
}

function fmtWait(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  const d = Math.floor(mins / (24 * 60));
  const h = Math.floor((mins % (24 * 60)) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const LIFTED_LABEL: Record<NonNullable<RugBan["liftedBy"]>, string> = {
  self: "cleared by owner",
  admin: "lifted by a moderator",
  timeout: "served out",
};

export function ReputationPanel({
  reputation,
  bans,
  banned,
  self = false,
  selfServe = false,
  onCleared,
}: {
  reputation: number;
  bans: RugBan[];
  banned: boolean;
  /** Rendering the signed-in owner's profile — offers the self-unban path. */
  self?: boolean;
  /** This environment lets players clear their own ban. */
  selfServe?: boolean;
  onCleared?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A live tick keeps the wait-out countdown honest.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const standing = repStanding(reputation);
  const active = banned ? bans[bans.length - 1] : undefined;

  const clearBan = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/me/reputation/unban", { body: {} });
      onCleared?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl border p-5 ${banned ? "border-red-500/40" : "border-zinc-800"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-black">Reputation</h2>
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${standing.cls}`}>
          {standing.label}
        </span>
        <span className="font-mono text-sm text-zinc-400">score {reputation}</span>
        {banned && (
          <span className="ml-auto rounded bg-red-500/20 px-2 py-0.5 text-xs font-black uppercase tracking-wide text-red-300">
            🚫 launch ban active
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Launching a coin that graduates earns +2, any clean launch +1, a rug −5 and a launch ban.
        Banned wallets can still chat and trade. They just can&apos;t put a coin on the ballot.
      </p>

      {active && (
        <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/[0.06] p-3">
          <div className="text-sm font-bold text-red-300">
            Rug ban · offense #{active.offense}
            {active.symbol && <span className="text-red-400/80"> · ${active.symbol}</span>}
            <span className="ml-2 font-normal text-zinc-500">
              since {new Date(active.at).toLocaleDateString()}
            </span>
          </div>
          {active.expiresAt ? (
            <div className="mt-1 text-xs text-zinc-400">
              This ban lifts itself in{" "}
              <b className="font-mono text-amber-300">{fmtWait(active.expiresAt - now)}</b>: repeat
              offenses wait longer. A moderator can lift it early.
            </div>
          ) : self ? (
            selfServe ? (
              <div className="mt-2">
                <p className="text-xs text-zinc-400">
                  Paper beta grace: you can clear this ban yourself. The record stays on your
                  profile either way. Reputation remembers.
                </p>
                <button
                  disabled={busy}
                  onClick={() => void clearBan()}
                  className="mt-2 rounded-lg bg-red-500/80 px-4 py-1.5 text-sm font-black text-zinc-50 transition hover:bg-red-500 disabled:opacity-50"
                >
                  {busy ? "Clearing…" : "Clear my ban"}
                </button>
                {error && <div className="mt-1 text-xs text-red-400">{error}</div>}
              </div>
            ) : (
              <div className="mt-1 text-xs text-zinc-400">
                This ban stays until a moderator lifts it.
              </div>
            )
          ) : (
            <div className="mt-1 text-xs text-zinc-500">
              This wallet can&apos;t launch coins until the ban is lifted.
            </div>
          )}
        </div>
      )}

      {bans.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            Ban history
          </div>
          <div className="space-y-1">
            {[...bans].reverse().map((b, i) => {
              const isActive = active && b === active;
              return (
                <div
                  key={`${b.at}-${i}`}
                  className={`flex flex-wrap items-center gap-2 rounded px-2 py-1 text-xs ${
                    isActive ? "bg-red-500/10 text-red-200" : "bg-zinc-900 text-zinc-400"
                  }`}
                >
                  <span className="font-mono text-zinc-500">
                    {new Date(b.at).toLocaleDateString()}
                  </span>
                  <span className="font-bold">
                    offense #{b.offense}
                    {b.symbol && ` · $${b.symbol}`}
                  </span>
                  {b.tier && <span className="uppercase text-zinc-600">{b.tier}</span>}
                  <span className="ml-auto">
                    {isActive
                      ? "ACTIVE"
                      : b.liftedBy
                        ? LIFTED_LABEL[b.liftedBy]
                        : b.liftedAt
                          ? "lifted"
                          : "ACTIVE"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
