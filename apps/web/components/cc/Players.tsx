"use client";

import { useCallback, useEffect, useState } from "react";
import type { LedgerEntry, RoundHistoryEntry, UserProfile } from "@cookout/shared";
import { cc, type CcSession } from "../../lib/cc";
import { Panel } from "./CcModules";
import { BetaAccessPanel } from "./LiveOps";

/**
 * Player management.
 *
 * Balance and XP changes are entered as deltas rather than absolute values:
 * two operators acting at the same moment can't silently overwrite each
 * other's work, and the audit entry records exactly what moved. Every
 * adjustment requires a reason — an unexplained balance change is the thing
 * you most want to be able to read back six months later.
 */

interface PlayerRow {
  address: string;
  displayName?: string;
  level: number;
  xp: number;
  title: string;
  createdAt: number;
  arenaBalance: number;
  paperBalance: number;
  burgerBalance: number;
  totalPnl: number;
  trades: number;
  roundsPlayed: number;
  creatorReputation: number;
  banned: boolean;
  mutedUntil: number;
  telegram?: string;
  founderNumber?: number;
  isAI: boolean;
}

interface PlayerDetail {
  player: UserProfile & {
    stats: Record<string, number>;
    burgerBalance?: number;
  };
  mutedUntil: number;
  banned: boolean;
  ledger: LedgerEntry[];
  burgerLedger: { at: number; amount: number; source: string; note?: string }[];
  history: RoundHistoryEntry[];
}

const n = (v: number, dp = 0) =>
  v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const short = (a: string) => `${a.slice(0, 8)}…${a.slice(-4)}`;
const when = (at: number) => (at ? new Date(at).toLocaleDateString() : "—");

export function PlayersModule({ session }: { session: CcSession }) {
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("recent");
  const [system, setSystem] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams({ sort, limit: "60" });
    if (q) params.set("q", q);
    if (system) params.set("system", "1");
    cc<{ players: PlayerRow[]; total: number }>(`/api/cc/players?${params}`)
      .then((d) => {
        setRows(d.players);
        setTotal(d.total);
      })
      .catch((e) => setError((e as Error).message));
  }, [q, sort, system]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <Panel
        title="Players"
        subtitle={`${n(total)} matching · showing ${rows.length}`}
        action={
          <div className="flex flex-wrap gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
            >
              <option value="recent">Newest</option>
              <option value="xp">XP</option>
              <option value="level">Level</option>
              <option value="pnl">PnL</option>
              <option value="trades">Trades</option>
              <option value="balance">Balance</option>
              <option value="burgers">BURGERS</option>
            </select>
            <button
              onClick={() => setSystem((v) => !v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                system ? "bg-amber-400 text-zinc-950" : "bg-zinc-800 text-zinc-400"
              }`}
              title="Include paper bots and Goon Squad accounts"
            >
              {system ? "Showing system" : "People only"}
            </button>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Address, name or Telegram…"
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
            />
          </div>
        }
      >
        {rows.length === 0 ? (
          <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">Nobody matches.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-zinc-600">
                  <th className="px-2 py-1.5 text-left font-bold">Player</th>
                  <th className="px-2 py-1.5 text-right font-bold">Lv</th>
                  <th className="px-2 py-1.5 text-right font-bold">XP</th>
                  <th className="px-2 py-1.5 text-right font-bold">Balance</th>
                  <th className="px-2 py-1.5 text-right font-bold">BURG</th>
                  <th className="px-2 py-1.5 text-right font-bold">PnL</th>
                  <th className="px-2 py-1.5 text-right font-bold">Rounds</th>
                  <th className="px-2 py-1.5 text-left font-bold">Joined</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.address} className="border-t border-white/5 hover:bg-zinc-900/40">
                    <td className="max-w-[14rem] px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-bold text-zinc-100">
                          {p.displayName ?? short(p.address)}
                        </span>
                        {p.isAI && <span className="rounded bg-fuchsia-500/20 px-1 text-[9px] font-black text-fuchsia-300">AI</span>}
                        {p.founderNumber && <span title={`Founder #${p.founderNumber}`}>🥇</span>}
                        {p.banned && <span className="rounded bg-red-500/20 px-1 text-[9px] font-black text-red-300">BANNED</span>}
                        {p.mutedUntil > Date.now() && (
                          <span className="rounded bg-amber-500/20 px-1 text-[9px] font-black text-amber-300">MUTED</span>
                        )}
                      </div>
                      <div className="truncate font-mono text-[10px] text-zinc-600">{p.address}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{p.level}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{n(p.xp)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-lime-300">{n(p.arenaBalance, 3)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-orange-300">{n(p.burgerBalance)}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${p.totalPnl >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                      {p.totalPnl >= 0 ? "+" : ""}
                      {n(p.totalPnl, 2)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-zinc-400">{p.roundsPlayed}</td>
                    <td className="px-2 py-1.5 text-zinc-500">{when(p.createdAt)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        onClick={() => setSelected(p.address)}
                        className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <BetaAccessPanel />

      {selected && (
        <PlayerDetailModal
          address={selected}
          session={session}
          onClose={() => setSelected(null)}
          onChanged={(m) => {
            setNote(m);
            load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function PlayerDetailModal({
  address,
  session,
  onClose,
  onChanged,
  onError,
}: {
  address: string;
  session: CcSession;
  onClose: () => void;
  onChanged: (message: string) => void;
  onError: (m: string) => void;
}) {
  const [data, setData] = useState<PlayerDetail | null>(null);
  const [adjust, setAdjust] = useState({ xp: "", arenaBalance: "", paperBalance: "", burgers: "", reason: "" });
  const [muteMinutes, setMuteMinutes] = useState(60);

  const load = useCallback(() => {
    cc<PlayerDetail>(`/api/cc/players/${address}`)
      .then(setData)
      .catch((e) => onError((e as Error).message));
  }, [address, onError]);
  useEffect(load, [load]);

  const canEconomy = session.permissions.includes("users.economy");
  const canModerate = session.permissions.includes("users.moderate");

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      onChanged(message);
      load();
    } catch (e) {
      onError((e as Error).message);
    }
  };

  if (!data)
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div onClick={onClose} className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
        <div className="relative rounded-2xl bg-zinc-950 p-6 text-sm text-zinc-500 ring-1 ring-white/10">Loading…</div>
      </div>
    );

  const p = data.player;
  const muted = data.mutedUntil > Date.now();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
      <div onClick={onClose} className="fixed inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="relative my-8 w-full max-w-2xl space-y-4 rounded-2xl bg-zinc-950 p-5 ring-1 ring-white/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-zinc-50">{p.displayName ?? short(p.address)}</h3>
            <div className="truncate font-mono text-[11px] text-zinc-600">{p.address}</div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-bold text-zinc-300">
                Lv{p.level} {p.title}
              </span>
              {p.founderNumber && (
                <span className="rounded bg-amber-400/20 px-1.5 py-0.5 font-bold text-amber-300">
                  Founder #{p.founderNumber}
                </span>
              )}
              {p.telegram && (
                <span className="rounded bg-sky-400/20 px-1.5 py-0.5 font-bold text-sky-300">@{p.telegram.username}</span>
              )}
              {data.banned && <span className="rounded bg-red-500/20 px-1.5 py-0.5 font-black text-red-300">RUG BANNED</span>}
              {muted && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-black text-amber-300">
                  Muted until {new Date(data.mutedUntil).toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Cook Out", n(p.arenaBalance ?? 0, 3), "text-lime-300"],
            ["Bank", n(p.paperBalance, 2), "text-zinc-100"],
            ["BURGERS", n(p.burgerBalance ?? 0), "text-orange-300"],
            ["XP", n(p.xp), "text-amber-300"],
            ["Rounds", n(p.stats.roundsPlayed), "text-zinc-100"],
            ["Trades", n(p.stats.trades), "text-zinc-100"],
            ["Total PnL", n(p.stats.totalPnl, 2), p.stats.totalPnl >= 0 ? "text-emerald-300" : "text-red-300"],
            ["Reputation", n(p.creatorReputation), p.creatorReputation < 0 ? "text-red-300" : "text-zinc-100"],
          ].map(([label, value, tone]) => (
            <div key={label as string} className="rounded-lg bg-zinc-900/60 p-2">
              <div className="text-[10px] uppercase text-zinc-500">{label}</div>
              <div className={`font-mono text-sm font-black ${tone}`}>{value}</div>
            </div>
          ))}
        </div>

        {canEconomy && (
          <div className="rounded-xl bg-zinc-900/50 p-3">
            <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-zinc-400">
              Adjust balances
            </div>
            <div className="mb-1 text-[10px] text-zinc-600">
              Entered as changes, not totals — use a negative number to deduct.
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              {(["xp", "arenaBalance", "paperBalance", "burgers"] as const).map((k) => (
                <label key={k} className="block">
                  <span className="text-[10px] font-bold text-zinc-500">
                    {k === "arenaBalance" ? "Cook Out ±" : k === "paperBalance" ? "Bank ±" : k === "burgers" ? "BURGERS ±" : "XP ±"}
                  </span>
                  <input
                    value={adjust[k]}
                    onChange={(e) => setAdjust({ ...adjust, [k]: e.target.value })}
                    placeholder="0"
                    className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 font-mono text-sm outline-none ring-1 ring-white/10"
                  />
                </label>
              ))}
            </div>
            <input
              value={adjust.reason}
              onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
              placeholder="Reason (required — this goes in the audit log)"
              className="mt-2 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10"
            />
            <button
              onClick={() =>
                void act(
                  () =>
                    cc(`/api/cc/players/${address}/adjust`, {
                      body: {
                        xp: Number(adjust.xp) || 0,
                        arenaBalance: Number(adjust.arenaBalance) || 0,
                        paperBalance: Number(adjust.paperBalance) || 0,
                        burgers: Number(adjust.burgers) || 0,
                        reason: adjust.reason,
                      },
                    }),
                  "Balances adjusted.",
                ).then(() => setAdjust({ xp: "", arenaBalance: "", paperBalance: "", burgers: "", reason: "" }))
              }
              className="mt-2 rounded-lg bg-lime-400 px-3 py-1.5 text-sm font-black text-zinc-950 hover:bg-lime-300"
            >
              Apply adjustment
            </button>
          </div>
        )}

        {canModerate && (
          <div className="rounded-xl bg-zinc-900/50 p-3">
            <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-zinc-400">Moderation</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                value={muteMinutes}
                onChange={(e) => setMuteMinutes(Number(e.target.value))}
                className="w-24 rounded-lg bg-zinc-900 px-2 py-1.5 font-mono text-sm ring-1 ring-white/10"
              />
              <span className="text-xs text-zinc-500">minutes</span>
              <button
                onClick={() =>
                  void act(
                    () =>
                      cc(`/api/cc/players/${address}/moderate`, {
                        body: { action: "mute", minutes: muteMinutes, reason: "Command Center" },
                      }),
                    "Muted.",
                  )
                }
                className="rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-black text-zinc-950 hover:bg-amber-300"
              >
                Mute
              </button>
              <button
                onClick={() =>
                  void act(
                    () =>
                      cc(`/api/cc/players/${address}/moderate`, {
                        // A ban is a mute that outlives us all.
                        body: { action: "mute", minutes: 100 * 365 * 24 * 60, reason: "Command Center ban" },
                      }),
                    "Banned from chat.",
                  )
                }
                className="rounded-lg bg-red-500/20 px-3 py-1.5 text-sm font-black text-red-300 hover:bg-red-500/30"
              >
                Ban from chat
              </button>
              {muted && (
                <button
                  onClick={() =>
                    void act(
                      () => cc(`/api/cc/players/${address}/moderate`, { body: { action: "unmute" } }),
                      "Unmuted.",
                    )
                  }
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-bold text-zinc-200 hover:bg-zinc-700"
                >
                  Unmute
                </button>
              )}
              {data.banned && (
                <button
                  onClick={() =>
                    void act(
                      () => cc(`/api/cc/players/${address}/moderate`, { body: { action: "lift_rug_ban" } }),
                      "Rug ban lifted.",
                    )
                  }
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-bold text-zinc-200 hover:bg-zinc-700"
                >
                  Lift rug ban
                </button>
              )}
              {p.creatorReputation < 0 && (
                <button
                  onClick={() =>
                    void act(
                      () => cc(`/api/cc/players/${address}/moderate`, { body: { action: "clear_flags" } }),
                      "Reputation reset to zero.",
                    )
                  }
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-bold text-zinc-200 hover:bg-zinc-700"
                >
                  Clear flags
                </button>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-zinc-400">Recent matches</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {data.history.length === 0 && <div className="text-xs text-zinc-600">None yet.</div>}
              {data.history.map((h, i) => (
                <div key={i} className="flex items-center gap-2 rounded bg-zinc-900/60 px-2 py-1 text-[11px]">
                  <span className="font-mono font-bold text-zinc-200">${h.symbol}</span>
                  <span className={h.pnl >= 0 ? "text-emerald-300" : "text-red-300"}>
                    {h.pnl >= 0 ? "+" : ""}
                    {n(h.pnl, 3)}
                  </span>
                  <span className="ml-auto text-zinc-600">{h.graduated ? "🍽️" : h.endReason?.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-zinc-400">Balance ledger</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {data.ledger.length === 0 && <div className="text-xs text-zinc-600">Nothing recorded.</div>}
              {data.ledger.map((l, i) => (
                <div key={i} className="flex items-center gap-2 rounded bg-zinc-900/60 px-2 py-1 text-[11px]">
                  <span className="text-zinc-400">{l.kind}</span>
                  <span className={l.amount >= 0 ? "text-emerald-300" : "text-red-300"}>
                    {l.amount >= 0 ? "+" : ""}
                    {n(l.amount, 4)}
                  </span>
                  <span className="ml-auto truncate text-zinc-600">{l.symbol ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
