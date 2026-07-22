"use client";

import { useEffect, useState } from "react";
import { EmojiPicker } from "./EmojiPicker";

/**
 * The speed-emoji bar above the chat input — the user's own macro row. Pick the
 * emoji you want parked here, then click one over and over to spam it into your
 * message (🔥🔥🔥) before you send. Your set persists per browser.
 */

const STORE_KEY = "cookout:speed-emoji";
const DEFAULT = ["🔥", "🚀", "😂", "💀", "🧊", "📉"];
const MAX_SLOTS = 10;

function load(): string[] {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT;
    const list = JSON.parse(raw) as string[];
    return Array.isArray(list) && list.length ? list.slice(0, MAX_SLOTS) : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function SpeedEmojiBar({ onSpam }: { onSpam: (emoji: string) => void }) {
  const [list, setList] = useState<string[]>(DEFAULT);
  const [editing, setEditing] = useState(false);
  useEffect(() => setList(load()), []);

  const save = (next: string[]) => {
    setList(next);
    if (typeof window !== "undefined") localStorage.setItem(STORE_KEY, JSON.stringify(next));
  };
  const add = (e: string) => {
    if (list.includes(e) || list.length >= MAX_SLOTS) return;
    save([...list, e]);
  };
  const remove = (e: string) => save(list.filter((x) => x !== e));

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 pb-1">
      {list.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => (editing ? remove(e) : onSpam(e))}
          className={`relative rounded px-1.5 py-1 text-sm transition ${
            editing
              ? "bg-red-500/15 ring-1 ring-red-500/40 hover:bg-red-500/25"
              : "bg-zinc-900 hover:bg-zinc-800 active:scale-90"
          }`}
          title={editing ? "remove" : "click to spam — hold nothing back"}
        >
          {e}
          {editing && (
            <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-black text-white">
              ×
            </span>
          )}
        </button>
      ))}

      {editing && list.length < MAX_SLOTS && <EmojiPicker onPick={add} label="＋" />}

      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        className={`ml-auto rounded px-1.5 py-1 text-xs transition ${
          editing ? "bg-lime-400 font-black text-zinc-950" : "text-zinc-500 hover:text-zinc-300"
        }`}
        title={editing ? "done" : "customize your speed emojis"}
      >
        {editing ? "done" : "✏️"}
      </button>
    </div>
  );
}
