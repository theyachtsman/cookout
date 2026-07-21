"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PresenceUser } from "@cookout/shared";
import { useSession } from "../lib/session";
import { useSocial } from "../lib/social";
import { ChatLog } from "./ChatLog";
import { STATUS_META, UserName } from "./UserCard";

/**
 * The Cookout dock — the persistent social layer, present on every page.
 *
 * Collapsed it's a tab showing the online count and unread badge; open it's
 * the global room plus the roster of who's here and what they're doing. It
 * never unmounts, so the conversation follows you across the whole site.
 */
export function SocialDock() {
  const { profile } = useSession();
  const { online, messages, connected, unread, setReading, send } = useSocial();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "people">("chat");
  const [text, setText] = useState("");

  // Unread only accumulates while the room isn't actually on screen.
  useEffect(() => {
    setReading(open && tab === "chat");
    return () => setReading(false);
  }, [open, tab, setReading]);

  const grouped = useMemo(() => {
    const order: PresenceUser["status"][] = ["trading", "queue", "spectating", "finished", "hanging"];
    return order
      .map((status) => ({ status, users: online.filter((o) => o.status === status) }))
      .filter((g) => g.users.length > 0);
  }, [online]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send(text);
    setText("");
  };

  if (!profile) return null; // the dock is for players who are actually in

  return (
    <>
      {/* collapsed tab */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/95 px-4 py-2.5 text-sm font-black shadow-2xl shadow-black/60 backdrop-blur transition hover:border-lime-400/60"
        >
          <span className="relative flex h-2 w-2">
            <span
              className={`absolute inline-flex h-full w-full rounded-full ${
                connected ? "animate-ping bg-lime-400 opacity-60" : "bg-zinc-600"
              }`}
            />
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                connected ? "bg-lime-400" : "bg-zinc-600"
              }`}
            />
          </span>
          The Cookout
          <span className="font-mono text-xs text-zinc-400">{online.length}</span>
          {unread > 0 && (
            <span className="rounded-full bg-lime-400 px-1.5 text-[10px] font-black text-zinc-950">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      )}

      {/* open dock */}
      {open && (
        <div className="fixed bottom-4 right-4 z-40 flex h-[30rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950/95 shadow-2xl shadow-black/60 backdrop-blur">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <span className="text-sm font-black">🔥 The Cookout</span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-lime-400" : "bg-zinc-600"}`}
              title={connected ? "connected" : "reconnecting…"}
            />
            <div className="ml-auto flex overflow-hidden rounded-full bg-zinc-900 p-0.5 text-[11px] font-bold">
              <button
                onClick={() => setTab("chat")}
                className={`rounded-full px-2.5 py-0.5 ${
                  tab === "chat" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Chat
              </button>
              <button
                onClick={() => setTab("people")}
                className={`rounded-full px-2.5 py-0.5 ${
                  tab === "people" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {online.length} here
              </button>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="ml-1 px-1 text-zinc-500 hover:text-zinc-200"
              title="minimize"
            >
              ✕
            </button>
          </div>

          {tab === "chat" ? (
            <>
              <ChatLog messages={messages} me={profile.address} className="flex-1" />
              <form onSubmit={submit} className="flex gap-2 border-t border-zinc-800 p-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="say something to the whole cookout…"
                  maxLength={280}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-lime-400/50"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-lime-400 px-3 py-1.5 text-sm font-black text-zinc-950 hover:bg-lime-300"
                >
                  Send
                </button>
              </form>
            </>
          ) : (
            <OnlineList grouped={grouped} onNavigate={() => setOpen(false)} />
          )}
        </div>
      )}
    </>
  );
}

/** The roster, grouped by what everyone is doing. */
export function OnlineList({
  grouped,
  onNavigate,
}: {
  grouped: Array<{ status: PresenceUser["status"]; users: PresenceUser[] }>;
  onNavigate?: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  if (grouped.length === 0)
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-zinc-600">
        Nobody else is here yet — you&apos;re first to the grill.
      </div>
    );
  return (
    <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-3">
      {grouped.map(({ status, users }) => {
        const meta = STATUS_META[status];
        return (
          <div key={status}>
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              <span>{meta.dot}</span>
              <span className={meta.cls}>{meta.label}</span>
              <span className="text-zinc-700">{users.length}</span>
            </div>
            <div className="space-y-0.5">
              {users.map((u) => (
                <div
                  key={u.address}
                  className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-zinc-900"
                >
                  {u.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 text-[9px] font-bold text-zinc-400">
                      {(u.displayName ?? u.address.slice(2, 4)).slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <UserName
                    address={u.address}
                    name={u.displayName}
                    badge={u.badge}
                    className="min-w-0 flex-1 text-left text-xs text-zinc-200"
                  />
                  {u.roundId && u.roundSymbol ? (
                    <Link
                      href={`/round/${u.roundId}`}
                      onClick={onNavigate}
                      className="shrink-0 font-mono text-[10px] text-zinc-500 hover:text-lime-300"
                    >
                      ${u.roundSymbol}
                    </Link>
                  ) : (
                    <span className="shrink-0 font-mono text-[10px] text-zinc-600">Lv{u.level}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
