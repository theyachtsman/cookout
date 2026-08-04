"use client";

import { useCallback, useEffect, useState } from "react";
import { cc } from "../../lib/cc";
import { Panel } from "./CcModules";

/**
 * Live Ops — the switches that change how the platform behaves right now:
 * the match calendar, the paper bot swarm, and what The Grill announces.
 *
 * Also carries beta access and tester feedback, which were the last two
 * things living on the old single-page console.
 */

interface OverviewShape {
  users: number;
  concepts: number;
  rounds: number;
  liveRounds: number;
  betaSignups: number;
  whitelistOn: boolean;
  feedbackCount: number;
  settings: {
    autoSchedule: boolean;
    tier: string;
    leadSeconds: number;
    bots?: boolean;
    announceTips?: string[];
    announceEveryMin?: number;
    pinnedAnnouncement?: string;
  };
}

export function LiveOpsPanel() {
  const [data, setData] = useState<OverviewShape | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    cc<OverviewShape>("/api/admin/overview")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const save = async (patch: Record<string, unknown>, message = "Saved.") => {
    setError("");
    setNote("");
    try {
      await cc("/api/admin/settings", { body: patch });
      setNote(message);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!data) return null;
  const s = data.settings;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <Panel title="Live Ops" subtitle="These take effect immediately">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <button
            onClick={() => save({ autoSchedule: !s.autoSchedule }, "Calendar updated.")}
            className={`rounded-xl p-3 text-left ring-1 transition ${
              s.autoSchedule ? "bg-lime-400/[0.07] ring-lime-400/40" : "bg-zinc-950/50 ring-white/10"
            }`}
          >
            <div className="text-sm font-black text-zinc-100">Auto-schedule</div>
            <div className="text-[11px] text-zinc-500">Keep the calendar filling from top-voted coins</div>
            <div className={`mt-1 text-[11px] font-black ${s.autoSchedule ? "text-lime-300" : "text-zinc-500"}`}>
              {s.autoSchedule ? "ON" : "OFF"}
            </div>
          </button>

          <button
            onClick={() => save({ bots: !s.bots }, "Bot swarm updated.")}
            className={`rounded-xl p-3 text-left ring-1 transition ${
              s.bots ? "bg-lime-400/[0.07] ring-lime-400/40" : "bg-zinc-950/50 ring-white/10"
            }`}
          >
            <div className="text-sm font-black text-zinc-100">Paper bot swarm</div>
            <div className="text-[11px] text-zinc-500">A crowd to trade against during the beta</div>
            <div className={`mt-1 text-[11px] font-black ${s.bots ? "text-lime-300" : "text-zinc-500"}`}>
              {s.bots ? "ON" : "OFF"}
            </div>
          </button>

          <label className="block rounded-xl bg-zinc-950/50 p-3 ring-1 ring-white/10">
            <span className="text-[11px] font-bold text-zinc-300">Default tier</span>
            <select
              value={s.tier}
              onChange={(e) => save({ tier: e.target.value })}
              className="mt-1 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm ring-1 ring-white/10"
            >
              {["rookie", "standard", "degen"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[10px] text-zinc-600">Fallback for legacy coins with no mode</span>
          </label>

          <label className="block rounded-xl bg-zinc-950/50 p-3 ring-1 ring-white/10">
            <span className="text-[11px] font-bold text-zinc-300">Lead time (s)</span>
            <input
              type="number"
              defaultValue={s.leadSeconds}
              onBlur={(e) => Number(e.target.value) !== s.leadSeconds && save({ leadSeconds: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg bg-zinc-900 px-2 py-1.5 font-mono text-sm outline-none ring-1 ring-white/10"
            />
            <span className="mt-1 block text-[10px] text-zinc-600">Between booking a slot and the lobby opening</span>
          </label>
        </div>
      </Panel>

      <Panel title="The Grill announcements" subtitle="Rotating tips and the pinned banner in global chat">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-300">Rotating tips — one per line</span>
            <textarea
              defaultValue={(s.announceTips ?? []).join("\n")}
              rows={6}
              onBlur={(e) =>
                save(
                  { announceTips: e.target.value.split("\n").map((t) => t.trim()).filter(Boolean) },
                  "Tips saved.",
                )
              }
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 text-xs leading-snug outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-300">Every (minutes)</span>
            <input
              type="number"
              defaultValue={s.announceEveryMin ?? 0}
              onBlur={(e) =>
                Number(e.target.value) !== (s.announceEveryMin ?? 0) &&
                save({ announceEveryMin: Number(e.target.value) })
              }
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 font-mono text-sm outline-none ring-1 ring-white/10"
            />
            <span className="mt-1 block text-[10px] text-zinc-600">0 turns them off</span>
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-[11px] font-bold text-zinc-300">Pinned announcement</span>
          <input
            defaultValue={s.pinnedAnnouncement ?? ""}
            placeholder="Blank = nothing pinned"
            onBlur={(e) =>
              e.target.value !== (s.pinnedAnnouncement ?? "") &&
              save({ pinnedAnnouncement: e.target.value }, "Pinned announcement updated.")
            }
            className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
          />
        </label>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------- beta access

interface BetaRow {
  address: string;
  approved: boolean;
  at: number;
  xHandle?: string;
}

/** The beta whitelist: who may sign in while BETA_WHITELIST=1. */
export function BetaAccessPanel() {
  const [rows, setRows] = useState<BetaRow[]>([]);
  const [whitelistOn, setWhitelistOn] = useState(false);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    cc<{ signups: BetaRow[]; whitelistOn: boolean }>("/api/admin/beta")
      .then((d) => {
        setRows(d.signups ?? []);
        setWhitelistOn(d.whitelistOn);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const act = async (path: string, body: unknown, message: string) => {
    setError("");
    setNote("");
    try {
      await cc(path, { body: body ?? {} });
      setNote(message);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pending = rows.filter((r) => !r.approved);

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <Panel
        title="Beta access"
        subtitle={
          whitelistOn
            ? "The whitelist is ON — only approved wallets and dev wallets can sign in"
            : "The whitelist is OFF — anyone can sign in"
        }
        action={
          pending.length > 0 && (
            <button
              onClick={() => act("/api/admin/beta/approve-all", {}, `Approved ${pending.length}.`)}
              className="rounded-lg bg-lime-400 px-3 py-1.5 text-xs font-black text-zinc-950 hover:bg-lime-300"
            >
              Approve all {pending.length}
            </button>
          )
        }
      >
        <div className="mb-3">
          <div className="mb-1 text-[11px] font-bold text-zinc-300">
            Import wallets — paste anything, every 0x… address is extracted
          </div>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            placeholder="Paste a CSV, a list, or a wall of X replies…"
            className="w-full rounded-lg bg-zinc-900 px-3 py-2 font-mono text-xs outline-none ring-1 ring-white/10"
          />
          <button
            onClick={() =>
              act("/api/admin/beta/import", { addresses: paste }, "Imported.").then(() => setPaste(""))
            }
            className="mt-1 rounded-lg bg-lime-400 px-3 py-1.5 text-xs font-black text-zinc-950 hover:bg-lime-300"
          >
            Import &amp; approve
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">
            Nobody on the list yet.
          </div>
        ) : (
          <div className="max-h-96 space-y-1 overflow-y-auto">
            {rows.map((r) => (
              <div key={r.address} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950/50 px-2 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono text-zinc-300">{r.address}</span>
                {r.xHandle && <span className="text-[10px] text-sky-300">{r.xHandle}</span>}
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
                    r.approved ? "bg-lime-400/20 text-lime-300" : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {r.approved ? "approved" : "pending"}
                </span>
                {!r.approved ? (
                  <button
                    onClick={() => act("/api/admin/beta/approve", { address: r.address }, "Approved.")}
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700"
                  >
                    Approve
                  </button>
                ) : (
                  <button
                    onClick={() => act("/api/admin/beta/revoke", { address: r.address }, "Revoked.")}
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700"
                  >
                    Revoke
                  </button>
                )}
                <button
                  onClick={() => act("/api/admin/beta/remove", { address: r.address }, "Removed.")}
                  className="rounded bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300 hover:bg-red-500/25"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- feedback

interface FeedbackRow {
  id: string;
  address: string;
  displayName?: string;
  text: string;
  page?: string;
  at: number;
}

/** Tester feedback, submitted from the in-app widget. */
export function FeedbackPanel() {
  const [items, setItems] = useState<FeedbackRow[]>([]);

  useEffect(() => {
    const load = () =>
      cc<FeedbackRow[]>("/api/admin/feedback")
        .then(setItems)
        .catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <Panel title="Tester feedback" subtitle={`${items.length} submitted from the in-app widget`}>
      {items.length === 0 ? (
        <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">Nothing yet.</div>
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {[...items].reverse().map((f) => (
            <div key={f.id} className="rounded-lg bg-zinc-950/50 p-2 text-xs">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-bold text-zinc-200">
                  {f.displayName ?? `${f.address.slice(0, 10)}…`}
                </span>
                {f.page && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{f.page}</span>}
                <span className="ml-auto text-[10px] text-zinc-600">{new Date(f.at).toLocaleString()}</span>
              </div>
              <div className="mt-1 whitespace-pre-wrap text-zinc-300">{f.text}</div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
