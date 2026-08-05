"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Self-exclusion, on the Settings page.
 *
 * One-way and not reversible by us — which is the only version of this control
 * worth having. Someone setting it is doing so precisely because they expect to
 * want it lifted later, and an exclusion staff can undo on request protects
 * nobody. The confirmation says so rather than softening it.
 */
export function SelfExclusion() {
  const [days, setDays] = useState<number[]>([]);
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ enabled: boolean; selfExclusionDays: number[] }>("/api/compliance")
      .then((d) => setDays(d.selfExclusionDays ?? []))
      .catch(() => {});
  }, []);

  if (days.length === 0) return null;

  const label = (d: number) =>
    d >= 365 ? `${d / 365} year` : d >= 30 ? `${Math.round(d / 30)} month${d >= 60 ? "s" : ""}` : `${d} day${d > 1 ? "s" : ""}`;

  const commit = async () => {
    if (choice === null) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/me/self-exclude", { body: { days: choice } });
      // The server drops every session, so there is nothing to return to.
      localStorage.removeItem("cookout_token");
      window.location.href = "/";
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-white/5">
      <h2 className="text-sm font-black text-zinc-200">Take a break</h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        Lock yourself out of the Cook Out for a set period. This signs you out and stops you
        signing back in until it ends.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {days.map((d) => (
          <button
            key={d}
            onClick={() => setChoice(choice === d ? null : d)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              choice === d ? "bg-red-500 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {label(d)}
          </button>
        ))}
      </div>
      {choice !== null && (
        <div className="mt-3 rounded-xl bg-red-500/10 p-3 ring-1 ring-red-500/30">
          <p className="text-xs leading-relaxed text-red-200">
            <b>This cannot be undone.</b> Nobody here can shorten or lift it, including support, and
            asking won&apos;t change that. You&apos;ll be able to sign in again in {label(choice)}.
          </p>
          <button
            disabled={busy}
            onClick={() => void commit()}
            className="mt-2 rounded-lg bg-red-500 px-4 py-2 text-xs font-black text-white hover:bg-red-400 disabled:opacity-50"
          >
            {busy ? "Applying…" : `Lock me out for ${label(choice)}`}
          </button>
        </div>
      )}
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
    </section>
  );
}
