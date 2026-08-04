"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatMessage } from "@cookout/shared";
import { cc, type CcSession } from "../../lib/cc";
import { Panel } from "./CcModules";

/**
 * Moderation — chat review, active mutes and bans, and match control.
 *
 * Censoring and deleting are offered as separate actions on purpose: censoring
 * keeps the message in the record with its text replaced, which leaves the
 * conversation legible and the moderation visible; deleting removes it
 * entirely. Both are audited with the original text, so a removal is
 * recoverable by hand even though the room no longer shows it.
 */

interface Room {
  id: string;
  label: string;
  state?: string;
  messages: number;
  lastAt: number;
}

interface MutedRow {
  address: string;
  displayName?: string;
  until: number;
}

interface RugBannedRow {
  address: string;
  displayName?: string;
  symbol: string;
  at: number;
  offense: number;
  expiresAt?: number;
  reputation: number;
}

interface MatchRow {
  id: string;
  symbol: string;
  name: string;
  state: string;
  matchType: string;
  mode?: string;
  creatorAddress: string;
  scheduledAt: number;
  endsAt?: number;
  mcap: number;
}

const ago = (at: number) => {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
};
const until = (at: number) => {
  const s = Math.max(0, Math.floor((at - Date.now()) / 1000));
  if (s > 86_400 * 365) return "indefinitely";
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86_400) return `${Math.ceil(s / 3600)}h`;
  return `${Math.ceil(s / 86_400)}d`;
};

export function ModerationModule({ session }: { session: CcSession }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [muted, setMuted] = useState<MutedRow[]>([]);
  const [rugBanned, setRugBanned] = useState<RugBannedRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [room, setRoom] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const canControl = session.permissions.includes("matches.control");

  const load = useCallback(() => {
    cc<{ rooms: Room[]; muted: MutedRow[]; rugBanned: RugBannedRow[] }>("/api/cc/moderation/rooms")
      .then((d) => {
        setRooms(d.rooms);
        setMuted(d.muted);
        setRugBanned(d.rugBanned);
      })
      .catch((e) => setError((e as Error).message));
    if (canControl)
      cc<{ matches: MatchRow[] }>("/api/cc/moderation/matches")
        .then((d) => setMatches(d.matches))
        .catch(() => {});
  }, [canControl]);
  useEffect(load, [load]);

  const loadRoom = useCallback((id: string) => {
    setRoom(id);
    cc<{ messages: ChatMessage[] }>(`/api/cc/moderation/chat/${id}`)
      .then((d) => setMessages(d.messages))
      .catch((e) => setError((e as Error).message));
  }, []);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError("");
    setNote("");
    try {
      await fn();
      setNote(message);
      load();
      if (room) loadRoom(room);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <Panel title="Rooms" subtitle="Where people are talking">
          <div className="space-y-1">
            {rooms.length === 0 && <div className="text-xs text-zinc-600">No chat yet.</div>}
            {rooms.map((r) => (
              <button
                key={r.id}
                onClick={() => loadRoom(r.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                  room === r.id ? "bg-lime-400 text-zinc-950" : "bg-zinc-950/50 text-zinc-300 hover:bg-zinc-800/60"
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-bold">{r.label}</span>
                {r.state === "live" && (
                  <span className={`text-[9px] font-black ${room === r.id ? "text-zinc-900" : "text-emerald-300"}`}>
                    LIVE
                  </span>
                )}
                <span className={`font-mono text-[10px] ${room === r.id ? "text-zinc-800" : "text-zinc-600"}`}>
                  {r.messages}
                </span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel
          title={room ? `Chat · ${rooms.find((r) => r.id === room)?.label ?? room}` : "Chat"}
          subtitle={
            room
              ? "Censoring keeps the message with its text replaced; deleting removes it. Both are audited with the original."
              : "Pick a room to review its messages"
          }
        >
          {!room ? (
            <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">
              Choose a room on the left.
            </div>
          ) : messages.length === 0 ? (
            <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">Nothing here.</div>
          ) : (
            <div className="max-h-[28rem] space-y-1 overflow-y-auto">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`group flex items-baseline gap-2 rounded-lg px-2 py-1 text-xs ${
                    m.system ? "bg-zinc-900/40 text-zinc-500" : "bg-zinc-950/50"
                  }`}
                >
                  <span className="w-16 shrink-0 font-mono text-[10px] text-zinc-600">{ago(m.at)}</span>
                  {!m.system && (
                    <span className="w-28 shrink-0 truncate font-bold text-zinc-200">
                      {m.displayName ?? `${m.userAddress.slice(0, 8)}…`}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 break-words text-zinc-300">{m.text}</span>
                  {!m.system && (
                    <span className="shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() =>
                          void act(
                            () =>
                              cc(`/api/cc/moderation/chat/${room}/${m.id}`, { body: { action: "censor" } }),
                            "Message censored.",
                          )
                        }
                        className="mr-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300"
                      >
                        Censor
                      </button>
                      <button
                        onClick={() =>
                          void act(
                            () =>
                              cc(`/api/cc/moderation/chat/${room}/${m.id}`, { body: { action: "delete" } }),
                            "Message deleted.",
                          )
                        }
                        className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300"
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Muted players" subtitle={`${muted.length} active`}>
          {muted.length === 0 ? (
            <div className="text-xs text-zinc-600">Nobody is muted.</div>
          ) : (
            <div className="space-y-1">
              {muted.map((m) => (
                <div key={m.address} className="flex items-center gap-2 rounded-lg bg-zinc-950/50 px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate font-bold text-zinc-200">
                    {m.displayName ?? `${m.address.slice(0, 10)}…`}
                  </span>
                  <span className="font-mono text-[10px] text-amber-300">{until(m.until)}</span>
                  <button
                    onClick={() =>
                      void act(
                        () => cc(`/api/cc/players/${m.address}/moderate`, { body: { action: "unmute" } }),
                        "Unmuted.",
                      )
                    }
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700"
                  >
                    Unmute
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Rug bans" subtitle={`${rugBanned.length} wallets barred from launching`}>
          {rugBanned.length === 0 ? (
            <div className="text-xs text-zinc-600">No active rug bans.</div>
          ) : (
            <div className="space-y-1">
              {rugBanned.map((b) => (
                <div key={b.address} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950/50 px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate font-bold text-zinc-200">
                    {b.displayName ?? `${b.address.slice(0, 10)}…`}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-500">
                    ${b.symbol} · offense #{b.offense} · rep {b.reputation}
                  </span>
                  <span className="font-mono text-[10px] text-red-300">
                    {b.expiresAt ? until(b.expiresAt) : "self-serve"}
                  </span>
                  <button
                    onClick={() =>
                      void act(
                        () => cc(`/api/cc/players/${b.address}/moderate`, { body: { action: "lift_rug_ban" } }),
                        "Rug ban lifted.",
                      )
                    }
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700"
                  >
                    Lift
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {canControl && (
        <Panel title="Live match control" subtitle={`${matches.length} scheduled or running`}>
          {matches.length === 0 ? (
            <div className="text-xs text-zinc-600">Nothing on the calendar.</div>
          ) : (
            <div className="space-y-1">
              {matches.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950/50 px-3 py-2 text-xs">
                  <span className="font-mono font-black text-zinc-100">${m.symbol}</span>
                  <span className="min-w-0 truncate text-zinc-500">{m.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${
                      m.state === "live" ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {m.state}
                  </span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {m.matchType === "pit" ? "Pit" : (m.mode ?? "—")}
                  </span>
                  {m.mcap > 0 && <span className="font-mono text-[10px] text-zinc-500">mc {m.mcap.toFixed(2)}</span>}
                  <a
                    href={`/${m.matchType === "pit" ? "pit" : "round"}/${m.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700"
                  >
                    Open
                  </a>
                  {m.state === "live" && (
                    <>
                      <button
                        onClick={() =>
                          void act(() => cc(`/api/admin/rounds/${m.id}/pause`, { body: {} }), "Match paused.")
                        }
                        className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300"
                      >
                        Pause
                      </button>
                      <button
                        onClick={() =>
                          void act(() => cc(`/api/admin/rounds/${m.id}/resume`, { body: {} }), "Match resumed.")
                        }
                        className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-300"
                      >
                        Resume
                      </button>
                      <button
                        onClick={() => {
                          if (!confirm(`End $${m.symbol} now? Positions resolve at the current price.`)) return;
                          void act(() => cc(`/api/admin/rounds/${m.id}/end`, { body: {} }), "Match ended.");
                        }}
                        className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300"
                      >
                        End
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
