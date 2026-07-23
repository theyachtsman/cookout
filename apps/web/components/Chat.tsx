"use client";

import { useState } from "react";
import type { ChatMessage } from "@cookout/shared";
import { useSession } from "../lib/session";
import { ChatLog } from "./ChatLog";

const CHEERS = ["🔥", "🚀", "😂", "💀", "🧊", "📉"];

/**
 * Match chat — the room for this round only. It renders through the shared
 * ChatLog, so system events (queue opened, settled, whale, rug, bond) appear
 * inline as banners alongside the crowd's messages. Global chat keeps
 * running in the dock while this room is open, and this room is frozen —
 * never destroyed — when the match ends.
 */
export function Chat({
  messages,
  onSend,
  onReact,
  reactions = [],
  title = "Match Chat",
  frozen = false,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onReact?: (emoji: string) => void;
  reactions?: Array<{ id: number; emoji: string }>;
  title?: string;
  /** Round is over: the room stays readable but takes no new messages. */
  frozen?: boolean;
}) {
  const { profile, promptPlayNow } = useSession();
  const [text, setText] = useState("");

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-zinc-800">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <h4 className="text-sm font-bold text-zinc-300">{title}</h4>
        {frozen && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
            frozen
          </span>
        )}
        <div className="ml-auto flex h-6 items-center gap-1 overflow-hidden">
          {reactions.slice(-8).map((r) => (
            <span key={r.id} className="killfeed-item text-base">
              {r.emoji}
            </span>
          ))}
        </div>
      </div>

      <ChatLog
        messages={messages}
        me={profile?.address}
        myName={profile?.displayName}
        className="min-h-32 flex-1"
        emptyText={frozen ? "No messages in this round." : "The trenches are quiet. Start talking."}
      />

      {onReact && !frozen && (
        <div className="flex gap-1 px-2 pb-1">
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

      {!profile && !frozen ? (
        // Logged-out visitors can read the trenches; joining creates an account.
        <div className="border-t border-zinc-800 p-2">
          <button
            onClick={promptPlayNow}
            className="w-full rounded-lg bg-lime-400/90 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
          >
            Play to join the chat →
          </button>
        </div>
      ) : (
        <div className="flex gap-2 border-t border-zinc-800 p-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={
              frozen ? "this round is over. chat lives on in The Grill" : "message the trenches…"
            }
            disabled={!profile || frozen}
            maxLength={280}
            className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-lime-400/50 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!profile || frozen}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-bold hover:bg-zinc-700 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}
