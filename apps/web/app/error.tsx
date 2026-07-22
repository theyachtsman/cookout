"use client";

import { useEffect } from "react";

/**
 * App-level error boundary. A transient client-side throw (e.g. mid wallet
 * switch, before the session settles) used to blank the whole page to Next's
 * bare "Application error" screen, recoverable only by refreshing a few times.
 * This catches it, keeps the brand, and offers a one-click recovery.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it in the console for anyone debugging; no PII beyond the message.
    console.error("App error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="text-4xl">🍔💨</div>
      <h1 className="mt-4 text-xl font-black text-zinc-100">Something slipped off the grill</h1>
      <p className="mt-2 max-w-sm text-sm text-zinc-500">
        A hiccup on our end — usually a wallet still settling. Give it another go.
      </p>
      <div className="mt-5 flex gap-2">
        <button
          onClick={() => reset()}
          className="rounded-lg bg-lime-400 px-5 py-2 text-sm font-black text-zinc-950 transition hover:bg-lime-300"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg border border-zinc-700 px-5 py-2 text-sm font-bold text-zinc-300 transition hover:border-zinc-500"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
