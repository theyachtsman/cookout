"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEvent, ActivityKind, PresenceUser } from "@cookout/shared";
import { useSession } from "../lib/session";
import { useSocial } from "../lib/social";
import { ChatLog } from "./ChatLog";
import { EmojiPicker } from "./EmojiPicker";
import { SpeedEmojiBar } from "./SpeedEmojiBar";
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
  const {
    online,
    messages,
    matchMessages,
    activeRoom,
    channel,
    setChannel,
    activity,
    following,
    connected,
    unread,
    setReading,
    send,
  } = useSocial();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chat" | "feed" | "people">("chat");
  const [feedScope, setFeedScope] = useState<"all" | "following">("all");
  const [dismissed, setDismissed] = useState(false);

  // Walking into a match pops the console open on that match's channel —
  // the trenches were always visible before; they still are.
  useEffect(() => {
    if (activeRoom && !dismissed) {
      setOpen(true);
      setTab("chat");
    }
  }, [activeRoom, dismissed]);
  const [text, setText] = useState("");

  // Unread only accumulates while the room isn't actually on screen.
  useEffect(() => {
    setReading(open && tab === "chat");
    return () => setReading(false);
  }, [open, tab, channel, setReading]);

  const grouped = useMemo(() => {
    const order: PresenceUser["status"][] = ["trading", "queue", "spectating", "finished", "hanging"];
    return order
      .map((status) => ({ status, users: online.filter((o) => o.status === status) }))
      .filter((g) => g.users.length > 0);
  }, [online]);

  const inMatch = channel === "match" && !!activeRoom;

  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send(text);
    setText("");
  };

  // Drop an emoji in at the cursor and keep focus, so a Twitch-style 🔥🔥🔥
  // spam is just repeated clicks without ever leaving the box.
  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + emoji + text.slice(end)).slice(0, 280);
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = Math.min(start + emoji.length, next.length);
      el.setSelectionRange(caret, caret);
    });
  };

  if (!profile) return null; // the dock is for players who are actually in

  return (
    <>
      {/* collapsed tab */}
      {!open && (
        <button
          onClick={() => {
            setOpen(true);
            setDismissed(false);
          }}
          className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900/95 px-4 py-2.5 text-sm font-black shadow-2xl shadow-black/60 backdrop-blur transition hover:border-lime-400/60"
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
          {activeRoom ? activeRoom.label : "The Grill"}
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
        <div className="fixed bottom-4 left-4 z-40 flex h-[min(30rem,70vh)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950/95 shadow-2xl shadow-black/60 backdrop-blur">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? "bg-lime-400" : "bg-zinc-600"}`}
              title={connected ? "connected" : "reconnecting…"}
            />
            {/* Channels: the global room is always there; the match channel
                appears while you're in a match and leaves when you navigate away. */}
            <div className="flex min-w-0 gap-1 text-[11px] font-black">
              <button
                onClick={() => {
                  setChannel("global");
                  setTab("chat");
                }}
                className={`shrink-0 rounded-full px-2 py-0.5 ${
                  channel === "global" && tab === "chat"
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                🔥 The Grill
              </button>
              {activeRoom && (
                <button
                  onClick={() => {
                    setChannel("match");
                    setTab("chat");
                  }}
                  className={`min-w-0 truncate rounded-full px-2 py-0.5 ${
                    channel === "match" && tab === "chat"
                      ? "bg-lime-400 text-zinc-950"
                      : "text-lime-300/80 hover:text-lime-300"
                  }`}
                >
                  {activeRoom.label}
                </button>
              )}
            </div>
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
                onClick={() => setTab("feed")}
                className={`rounded-full px-2.5 py-0.5 ${
                  tab === "feed" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Feed
              </button>
              <button
                onClick={() => setTab("people")}
                className={`rounded-full px-2.5 py-0.5 ${
                  tab === "people" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {online.length}
              </button>
            </div>
            <button
              onClick={() => {
                setOpen(false);
                setDismissed(true);
              }}
              className="ml-1 shrink-0 px-1 text-zinc-500 hover:text-zinc-200"
              title="minimize"
            >
              ✕
            </button>
          </div>

          {tab === "chat" ? (
            <>
              <ChatLog
                messages={inMatch ? matchMessages : messages}
                me={profile.address}
                myName={profile.displayName}
                className="flex-1"
                // The Grill stays human: house banners (tips, launches,
                // results) fade out 30s after they land. Match rooms keep
                // their banners — they're the round's narrative.
                fadeSystemAfterMs={inMatch ? undefined : 30_000}
                emptyText={
                  inMatch
                    ? "The trenches are quiet. Start talking."
                    : "It's quiet in here. Say something."
                }
              />
              {!(inMatch && activeRoom?.frozen) && (
                // Each tap fires its own message; the server's per-connection
                // rate limit does the throttling, Twitch-style.
                <SpeedEmojiBar onSpam={(e) => send(e)} />
              )}
              <form onSubmit={submit} className="flex items-center gap-1.5 border-t border-zinc-800 p-2">
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={inMatch && !!activeRoom?.frozen}
                  placeholder={
                    inMatch
                      ? activeRoom?.frozen
                        ? "this round is over — chat lives on in The Grill"
                        : `message ${activeRoom?.label}…`
                      : "say something to the whole cookout…"
                  }
                  maxLength={280}
                  className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-lime-400/50 disabled:opacity-50"
                />
                {!(inMatch && activeRoom?.frozen) && <EmojiPicker onPick={insertEmoji} />}
                <button
                  type="submit"
                  disabled={inMatch && !!activeRoom?.frozen}
                  className="rounded-lg bg-lime-400 px-3 py-1.5 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </>
          ) : tab === "feed" ? (
            <ActivityFeed
              events={activity}
              following={following}
              scope={feedScope}
              onScope={setFeedScope}
              onNavigate={() => setOpen(false)}
            />
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


const FEED_ICON: Record<ActivityKind, string> = {
  joined: "🚪",
  pulled_up: "🔥",
  won: "🏆",
  rekt: "💀",
  graduated: "🍽️",
  level_up: "⬆️",
  achievement: "🏅",
  jackpot: "🎰",
  submitted: "🪙",
};

const ago = (at: number) => {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

/** Live activity — what the people you care about are doing right now. */
export function ActivityFeed({
  events,
  following,
  scope,
  onScope,
  onNavigate,
}: {
  events: ActivityEvent[];
  following: string[];
  scope: "all" | "following";
  onScope: (s: "all" | "following") => void;
  onNavigate?: () => void;
}) {
  const follows = new Set(following.map((f) => f.toLowerCase()));
  const shown =
    scope === "following" ? events.filter((e) => follows.has(e.address.toLowerCase())) : events;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex gap-1 border-b border-zinc-800 px-2 py-1.5 text-[10px] font-bold">
        {(["all", "following"] as const).map((sc) => (
          <button
            key={sc}
            onClick={() => onScope(sc)}
            className={`rounded-full px-2.5 py-0.5 ${
              scope === sc ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {sc === "all" ? "Everyone" : `Following ${follows.size || ""}`}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {shown.length === 0 && (
          <div className="p-4 text-center text-xs text-zinc-600">
            {scope === "following"
              ? "You're not following anyone yet — tap a name and hit Follow."
              : "Nothing has happened yet. Be the first."}
          </div>
        )}
        {shown.map((e) => (
          <div key={e.id} className="flex items-baseline gap-1.5 rounded px-1.5 py-1 text-[12px] hover:bg-zinc-900">
            <span className="shrink-0">{FEED_ICON[e.kind]}</span>
            <UserName
              address={e.address}
              name={e.displayName}
              className="shrink-0 text-[12px] text-zinc-200"
            />
            <span className="min-w-0 break-words text-zinc-400">{e.text}</span>
            {e.roundId && (
              <Link
                href={`/round/${e.roundId}`}
                onClick={onNavigate}
                className="shrink-0 text-[10px] text-lime-300 hover:underline"
                title="open the round"
              >
                ↗
              </Link>
            )}
            <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-700">{ago(e.at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
