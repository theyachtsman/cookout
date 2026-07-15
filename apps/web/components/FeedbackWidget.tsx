"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

/** Floating beta-feedback button: wallet-attached, includes the current page. */
export function FeedbackWidget() {
  const { profile } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");

  if (!profile) return null;

  const send = async () => {
    try {
      await api("/api/feedback", { body: { text, page: pathname } });
      setState("sent");
      setText("");
      setTimeout(() => {
        setOpen(false);
        setState("idle");
      }, 1500);
    } catch {
      setState("error");
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-30">
      {open ? (
        <div className="w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold">Beta feedback</span>
            <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-200">
              ✕
            </button>
          </div>
          {state === "sent" ? (
            <div className="py-4 text-center text-sm font-bold text-lime-300">
              Got it — thank you 🔥
            </div>
          ) : (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder="Bug? Confusing? Too easy to rug you? Tell us."
                className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => void send()}
                disabled={!text.trim()}
                className="mt-2 w-full rounded bg-lime-400 py-1.5 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-40"
              >
                Send
              </button>
              {state === "error" && (
                <p className="mt-1 text-xs text-red-400">couldn&apos;t send — try again shortly</p>
              )}
            </>
          )}
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="rounded-full border border-lime-400/50 bg-zinc-900 px-4 py-2 text-sm font-bold text-lime-300 shadow-lg hover:bg-zinc-800"
        >
          💬 Feedback
        </button>
      )}
    </div>
  );
}
