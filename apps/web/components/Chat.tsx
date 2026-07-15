"use client";

import { useState } from "react";
import type { ChatMessage } from "@cookout/shared";
import { useSession } from "../lib/session";

const CHEERS = ["🔥", "🚀", "😂", "💀", "🧊", "📉"];

export function Chat({
  messages,
  onSend,
  onReact,
  reactions = [],
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onReact?: (emoji: string) => void;
  reactions?: Array<{ id: number; emoji: string }>;
}) {
  const { profile } = useSession();
  const [text, setText] = useState("");

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="rounded-xl border border-zinc-800 p-4">
      <div className="mb-2 flex items-center">
        <h4 className="text-sm font-bold text-zinc-300">Chat</h4>
        <div className="ml-auto flex h-6 items-center gap-1 overflow-hidden">
          {reactions.slice(-8).map((r) => (
            <span key={r.id} className="killfeed-item text-base">
              {r.emoji}
            </span>
          ))}
        </div>
      </div>
      <div className="flex max-h-56 flex-col-reverse gap-1 overflow-y-auto text-sm">
        {[...messages].reverse().map((m) => (
          <div key={m.id} className="rounded px-1 py-0.5">
            {m.badge && <span className="mr-1">{m.badge}</span>}
            <span className="mr-1.5 font-bold" style={{ color: m.color ?? "#f59e0b" }}>
              {m.displayName ?? `${m.userAddress.slice(0, 6)}…`}
            </span>
            <span className="text-zinc-300">{m.text}</span>
          </div>
        ))}
        {messages.length === 0 && <div className="text-xs text-zinc-600">say something…</div>}
      </div>
      {onReact && (
        <div className="mt-2 flex gap-1">
          {CHEERS.map((e) => (
            <button
              key={e}
              onClick={() => onReact(e)}
              disabled={!profile}
              className="rounded bg-zinc-900 px-2 py-1 text-sm hover:bg-zinc-800 disabled:opacity-40"
              title="cheer"
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={profile ? "message…" : "connect wallet to chat"}
          disabled={!profile}
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={!profile}
          className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
