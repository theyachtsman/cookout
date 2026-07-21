"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, SystemChatKind } from "@cookout/shared";
import { UserName } from "./UserCard";

/**
 * The message log, shared by the global dock and match chat: system-event
 * banners, clickable identities, level chips, @mention highlighting,
 * hover timestamps, and sticky auto-scroll that yields when you scroll up
 * to read history.
 */

const SYSTEM_STYLE: Record<SystemChatKind, string> = {
  queue_open: "border-lime-400/40 text-lime-300",
  queue_closed: "border-zinc-600 text-zinc-300",
  settled: "border-sky-400/40 text-sky-300",
  live: "border-emerald-400/50 text-emerald-300",
  leader: "border-amber-400/40 text-amber-300",
  bond: "border-lime-400/40 text-lime-300",
  whale: "border-amber-400/50 text-amber-300",
  rug: "border-red-500/50 text-red-300",
  graduated: "border-lime-400/60 text-lime-300",
  ended: "border-zinc-600 text-zinc-400",
};

const SYSTEM_ICON: Record<SystemChatKind, string> = {
  queue_open: "🔥",
  queue_closed: "⏳",
  settled: "⚖️",
  live: "📈",
  leader: "🏆",
  bond: "🚀",
  whale: "🐋",
  rug: "💀",
  graduated: "🍽️",
  ended: "🏁",
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ChatLog({
  messages,
  me,
  myName,
  className = "",
  emptyText = "It's quiet in here. Say something.",
}: {
  messages: ChatMessage[];
  /** Viewer's address — drives "mine" styling and mention highlights. */
  me?: string;
  /** Viewer's display name, for @mention matching. */
  myName?: string;
  className?: string;
  emptyText?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [muted, setMuted] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      setMuted(
        new Set(JSON.parse(localStorage.getItem("cookout:muted-users") ?? "[]") as string[]),
      );
    } catch {
      /* ignore */
    }
  }, [messages.length]);

  // Sticky bottom: follow new messages unless the reader has scrolled up.
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const visible = messages.filter((m) => m.system || !muted.has(m.userAddress.toLowerCase()));

  return (
    <div ref={ref} onScroll={onScroll} className={`space-y-1 overflow-y-auto p-2 ${className}`}>
      {visible.length === 0 && (
        <div className="p-4 text-center text-xs text-zinc-600">{emptyText}</div>
      )}
      {visible.map((m) =>
        m.system ? (
          <div
            key={m.id}
            title={time(m.at)}
            className={`my-1 rounded-lg border-l-2 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] font-bold ${
              SYSTEM_STYLE[m.systemKind ?? "ended"]
            }`}
          >
            <span className="mr-1.5">{SYSTEM_ICON[m.systemKind ?? "ended"]}</span>
            {m.text}
          </div>
        ) : (
          <Line key={m.id} m={m} me={me} myName={myName} />
        ),
      )}
    </div>
  );
}

function Line({ m, me, myName }: { m: ChatMessage; me?: string; myName?: string }) {
  const mine = !!me && m.userAddress.toLowerCase() === me.toLowerCase();
  // Mention highlight: someone said @yourName or your short address.
  const lower = m.text.toLowerCase();
  const hit =
    !mine &&
    ((!!myName && lower.includes(`@${myName.toLowerCase()}`)) ||
      (!!me && lower.includes(me.slice(0, 8).toLowerCase())));

  return (
    <div
      title={time(m.at)}
      className={`group flex items-baseline gap-1.5 rounded px-1.5 py-0.5 text-[13px] leading-snug ${
        hit ? "bg-lime-400/10" : ""
      }`}
    >
      {m.level !== undefined && (
        <span className="shrink-0 font-mono text-[9px] text-zinc-600">{m.level}</span>
      )}
      <UserName
        address={m.userAddress}
        name={m.displayName}
        color={m.color}
        badge={m.badge}
        className={`shrink-0 text-[13px] ${
          m.color ? "" : mine ? "text-lime-300" : "text-zinc-300"
        }`}
      />
      <span className="min-w-0 break-words text-zinc-300">{highlight(m.text)}</span>
      <span className="ml-auto hidden shrink-0 font-mono text-[9px] text-zinc-700 group-hover:inline">
        {time(m.at)}
      </span>
    </div>
  );
}

/** Render @mentions in the accent color. */
function highlight(text: string): React.ReactNode {
  const parts = text.split(/(@[\w.\-]{2,24})/g);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="font-bold text-lime-300">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
