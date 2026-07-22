"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A full emoji suite for chat — a button that opens a categorized, searchable
 * grid. Built for Twitch-style spam: the panel stays open on pick and focus
 * returns to the input, so you can rattle off 🔥🔥🔥 without it closing on you.
 *
 * Native unicode emoji — no image assets, no external picker dependency.
 */

const CATEGORIES: Array<{ key: string; icon: string; label: string; emoji: string[] }> = [
  {
    key: "cookout",
    icon: "🔥",
    label: "Cookout",
    emoji: [
      "🔥", "🚀", "🍽️", "👨‍🍳", "🧑‍🍳", "🍔", "🌭", "🥩", "🍖", "🍗", "🧈", "🧂", "🍳", "🥓",
      "💰", "💸", "📈", "📉", "🤑", "💎", "🙌", "🧊", "💀", "☠️", "🐋", "🦍", "🧑‍🌾", "🚜",
      "🏆", "🥇", "👑", "⚡", "💥", "🎯", "🎰", "🃏", "📊", "🕯️", "🟢", "🔴", "✅", "❌",
    ],
  },
  {
    key: "smileys",
    icon: "😀",
    label: "Smileys",
    emoji: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊", "😇", "🥰", "😍",
      "🤩", "😘", "😗", "😚", "😙", "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔",
      "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥", "😌", "😔", "😪", "🤤", "😴",
      "😷", "🤒", "🤕", "🤢", "🤮", "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓",
      "🧐", "😕", "😟", "🙁", "☹️", "😮", "😯", "😲", "😳", "🥺", "😦", "😧", "😨", "😰", "😥",
      "😢", "😭", "😱", "😖", "😣", "😞", "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "😈",
      "👿", "💀", "💩", "🤡", "👹", "👺", "👻", "👽", "🤖", "😺", "😸", "😹", "😻", "😼", "😽",
      "🙀", "😿", "😾",
    ],
  },
  {
    key: "gestures",
    icon: "👍",
    label: "Gestures",
    emoji: [
      "👍", "👎", "👌", "🤌", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "👇", "☝️",
      "✋", "🤚", "🖐️", "🖖", "👋", "🤝", "🙏", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲",
      "💪", "🦾", "🫡", "🫠", "🫥", "🫶", "🤦", "🤷", "🙅", "🙆", "🙋", "🤦‍♂️", "🤷‍♂️", "💅", "🤳",
    ],
  },
  {
    key: "hearts",
    icon: "❤️",
    label: "Hearts",
    emoji: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗",
      "💖", "💘", "💝", "💟", "♥️", "💌", "💋", "🔥", "✨", "💫", "⭐", "🌟", "💯", "🎉", "🎊",
    ],
  },
  {
    key: "animals",
    icon: "🐸",
    label: "Animals",
    emoji: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵",
      "🙈", "🙉", "🙊", "🐔", "🐧", "🐦", "🐤", "🦄", "🐝", "🦋", "🐌", "🐞", "🐢", "🐍", "🦖",
      "🦕", "🐙", "🦑", "🦐", "🐳", "🐋", "🐬", "🐟", "🐠", "🦈", "🐊", "🐅", "🦓", "🦍", "🐘",
      "🦏", "🐐", "🐏", "🐑", "🐎", "🐖", "🦅", "🦉", "🐺", "🐗",
    ],
  },
  {
    key: "food",
    icon: "🍕",
    label: "Food",
    emoji: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍈", "🍒", "🍑", "🥭", "🍍",
      "🥥", "🥝", "🍅", "🥑", "🍆", "🥔", "🥕", "🌽", "🌶️", "🫑", "🥒", "🥬", "🥦", "🧄", "🧅",
      "🍄", "🥜", "🌰", "🍞", "🥐", "🥖", "🥨", "🧀", "🥚", "🍳", "🧈", "🥞", "🧇", "🥓", "🥩",
      "🍗", "🍖", "🌭", "🍔", "🍟", "🍕", "🥪", "🌮", "🌯", "🥗", "🍝", "🍜", "🍲", "🍛", "🍣",
      "🍱", "🥟", "🦪", "🍤", "🍙", "🍚", "🍘", "🍥", "🥠", "🍢", "🍡", "🍧", "🍨", "🍦", "🥧",
      "🧁", "🍰", "🎂", "🍮", "🍭", "🍬", "🍫", "🍿", "🍩", "🍪", "☕", "🍵", "🧃", "🥤", "🍺",
      "🍻", "🥂", "🍷", "🥃", "🍸", "🍹", "🍾", "🧊",
    ],
  },
  {
    key: "activity",
    icon: "⚽",
    label: "Activity",
    emoji: [
      "⚽", "🏀", "🏈", "⚾", "🥎", "🎾", "🏐", "🏉", "🎱", "🏓", "🏸", "🥅", "🏒", "🏑", "🥍",
      "🏏", "⛳", "🎯", "🎳", "🎮", "🕹️", "🎲", "🧩", "♟️", "🎰", "🎨", "🎭", "🎬", "🎤", "🎧",
      "🎸", "🎹", "🥁", "🎺", "🎻", "🏆", "🥇", "🥈", "🥉", "🏅", "🎖️", "🏵️", "🎗️", "🎫", "🎟️",
    ],
  },
  {
    key: "symbols",
    icon: "💠",
    label: "Symbols",
    emoji: [
      "💯", "✅", "❌", "⭕", "❗", "❓", "‼️", "⁉️", "💢", "💥", "💫", "💦", "💨", "🕳️", "💬",
      "🗯️", "💭", "🔥", "⚡", "🌈", "☀️", "⭐", "🌟", "✨", "⚠️", "🚫", "♻️", "✔️", "☑️", "🔴",
      "🟠", "🟡", "🟢", "🔵", "🟣", "⚫", "⚪", "🟤", "🔺", "🔻", "🔸", "🔹", "🔶", "🔷", "🔘",
      "🆗", "🆒", "🆕", "🆙", "🔝", "🔜", "©️", "®️", "™️", "＃", "＊", "➡️", "⬅️", "⬆️", "⬇️",
    ],
  },
];

const RECENT_KEY = "cookout:recent-emoji";

function loadRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState(CATEGORIES[0]!.key);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setRecent(loadRecent()), [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Search scans every category; the picker is a flat grid when querying.
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const all = Array.from(new Set(CATEGORIES.flatMap((c) => c.emoji)));
    // Match against the query directly (so pasting an emoji finds itself) and,
    // loosely, against the category label — good enough without a name DB.
    const inLabels = CATEGORIES.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())).flatMap(
      (c) => c.emoji,
    );
    const direct = all.filter((e) => e.includes(q));
    const merged = [...new Set([...direct, ...inLabels])];
    return merged;
  }, [query]);

  const grid = results ?? CATEGORIES.find((c) => c.key === cat)!.emoji;

  const pick = (e: string) => {
    onPick(e);
    // Twitch-style: keep the panel open, update recents so spam is one click.
    const next = [e, ...recent.filter((x) => x !== e)].slice(0, 24);
    setRecent(next);
    if (typeof window !== "undefined") localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Emojis"
        aria-label="Open emoji picker"
        className={`rounded-lg border px-2 py-1.5 text-base leading-none transition ${
          open
            ? "border-lime-400/60 bg-lime-400/10"
            : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
        }`}
      >
        😀
      </button>

      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-2 w-[19rem] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-700 bg-zinc-950/98 shadow-2xl shadow-black/60 backdrop-blur">
          {/* search */}
          <div className="border-b border-zinc-800 p-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search emoji…"
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm outline-none focus:border-lime-400/50"
            />
          </div>

          {/* category tabs (hidden while searching) */}
          {!results && (
            <div className="flex gap-0.5 overflow-x-auto border-b border-zinc-800 px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recent.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCat("__recent")}
                  title="Recent"
                  className={`shrink-0 rounded px-2 py-1 text-base ${
                    cat === "__recent" ? "bg-zinc-700" : "hover:bg-zinc-800"
                  }`}
                >
                  🕑
                </button>
              )}
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCat(c.key)}
                  title={c.label}
                  className={`shrink-0 rounded px-2 py-1 text-base ${
                    cat === c.key ? "bg-zinc-700" : "hover:bg-zinc-800"
                  }`}
                >
                  {c.icon}
                </button>
              ))}
            </div>
          )}

          {/* grid */}
          <div className="max-h-56 overflow-y-auto p-2">
            <div className="grid grid-cols-8 gap-0.5">
              {(cat === "__recent" && !results ? recent : grid).map((e, i) => (
                <button
                  key={`${e}-${i}`}
                  type="button"
                  onClick={() => pick(e)}
                  className="rounded p-1 text-xl leading-none transition hover:bg-zinc-800"
                >
                  {e}
                </button>
              ))}
            </div>
            {results && results.length === 0 && (
              <p className="py-6 text-center text-xs text-zinc-600">No emoji match that.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
