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

interface Standing {
  label: string;
  emoji: string;
  /** Text color for the big score + label. */
  accent: string;
  /** Ring color around the score tile. */
  ring: string;
  /** Fill color for the climb-to-next bar. */
  bar: string;
  /** Soft glow behind the score tile. */
  glow: string;
  /** Score at which this tier begins (its floor). */
  floor: number;
  /** Score where the next tier begins, or null at the top. */
  next: number | null;
  nextLabel: string | null;
}

/**
 * Reputation tiers, color-coded so the score reads at a glance: red when a rug
 * has put you underwater, then a warm climb from New → Elite. The gold Elite
 * tier is the one everyone's chasing.
 */
export function repStanding(rep: number): Standing {
  if (rep < 0)
    return {
      label: "In the Red",
      emoji: "⚠️",
      accent: "text-red-400",
      ring: "ring-red-500/60",
      bar: "bg-red-500",
      glow: "rgba(239,68,68,0.35)",
      floor: rep,
      next: 0,
      nextLabel: "New",
    };
  if (rep >= 20)
    return {
      label: "Elite",
      emoji: "👑",
      accent: "text-amber-300",
      ring: "ring-amber-400/60",
      bar: "bg-amber-400",
      glow: "rgba(251,191,36,0.45)",
      floor: 20,
      next: null,
      nextLabel: null,
    };
  if (rep >= 10)
    return {
      label: "Trusted",
      emoji: "🛡️",
      accent: "text-emerald-300",
      ring: "ring-emerald-400/60",
      bar: "bg-emerald-400",
      glow: "rgba(52,211,153,0.38)",
      floor: 10,
      next: 20,
      nextLabel: "Elite",
    };
  if (rep >= 3)
    return {
      label: "Established",
      emoji: "⭐",
      accent: "text-sky-300",
      ring: "ring-sky-400/60",
      bar: "bg-sky-400",
      glow: "rgba(56,189,248,0.35)",
      floor: 3,
      next: 10,
      nextLabel: "Trusted",
    };
  return {
    label: "New",
    emoji: "🌱",
    accent: "text-zinc-200",
    ring: "ring-zinc-600",
    bar: "bg-zinc-400",
    glow: "rgba(161,161,170,0.25)",
    floor: 0,
    next: 3,
    nextLabel: "Established",
  };
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
  // Progress toward the next tier (only meaningful once you're out of the red).
  const toNext = standing.next !== null ? Math.max(0, standing.next - reputation) : 0;
  const pct =
    standing.next !== null && reputation >= 0
      ? Math.max(0, Math.min(100, ((reputation - standing.floor) / (standing.next - standing.floor)) * 100))
      : 0;

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
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Reputation</h2>
        {banned && (
          <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs font-black uppercase tracking-wide text-red-300">
            🚫 launch ban active
          </span>
        )}
      </div>

      {/* Hero: the score, big and color-coded — the thing a creator is judged on. */}
      <div className="mt-3 flex items-center gap-5">
        <div
          className={`relative flex h-28 w-28 shrink-0 flex-col items-center justify-center rounded-2xl bg-zinc-950 ring-2 ${standing.ring}`}
          style={{ boxShadow: `0 0 34px ${standing.glow}` }}
        >
          <div className={`text-6xl font-black leading-none tabular-nums ${standing.accent}`}>
            {reputation}
          </div>
          <div className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            rep score
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className={`text-2xl font-black ${standing.accent}`}>
            {standing.emoji} {standing.label}
          </div>
          {reputation < 0 ? (
            <div className="mt-2 text-xs text-red-300/80">
              A rug put you underwater. Launch clean coins to climb back above zero.
            </div>
          ) : standing.next !== null ? (
            <>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${standing.bar}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1.5 text-xs text-zinc-400">
                <b className="text-zinc-100">{toNext}</b> more to{" "}
                <span className="font-bold">{standing.nextLabel}</span>
              </div>
            </>
          ) : (
            <div className="mt-2 text-xs text-amber-300/90">
              Top standing. The crowd trusts your launches.
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-zinc-500">
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
