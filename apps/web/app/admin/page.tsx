"use client";

import { useCallback, useEffect, useState } from "react";
import type { Round, TokenConcept } from "@cookout/shared";
import { api } from "../../lib/api";

interface Overview {
  users: number;
  concepts: number;
  rounds: number;
  liveRounds: number;
  totalFees: number;
  log: { id: string; at: number; action: string; detail: string }[];
}

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [concepts, setConcepts] = useState<TokenConcept[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const k = localStorage.getItem("cookout_admin_key");
    if (k) {
      setKey(k);
      setSaved(true);
    }
  }, []);

  const load = useCallback(async () => {
    if (!key) return;
    try {
      setError("");
      setOverview(await api<Overview>("/api/admin/overview", { admin: key }));
      setRounds(await api<Round[]>("/api/calendar"));
      setConcepts(await api<TokenConcept[]>("/api/concepts"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [key]);

  useEffect(() => {
    if (!saved) return;
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [saved, load]);

  const act = async (path: string, body?: unknown) => {
    try {
      setError("");
      await api(path, { admin: key, body: body ?? {}, method: "POST" });
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!saved)
    return (
      <div className="mx-auto max-w-sm py-16">
        <h1 className="mb-3 text-xl font-black">Admin</h1>
        <input
          type="password"
          placeholder="admin key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="mb-2 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2"
        />
        <button
          onClick={() => {
            localStorage.setItem("cookout_admin_key", key);
            setSaved(true);
          }}
          className="rounded bg-amber-500 px-4 py-2 font-bold text-zinc-950"
        >
          Enter
        </button>
      </div>
    );

  const activeRounds = rounds.filter((r) =>
    ["scheduled", "lobby", "queue_open", "settling", "live"].includes(r.state),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-black">Admin Dashboard</h1>
        <button
          onClick={() => {
            localStorage.removeItem("cookout_admin_key");
            setSaved(false);
            setKey("");
          }}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-300"
        >
          change key
        </button>
      </div>
      {error && <div className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>}

      {overview && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["Users", overview.users],
            ["Concepts", overview.concepts],
            ["Rounds", overview.rounds],
            ["Live now", overview.liveRounds],
            ["Fees (pETH)", overview.totalFees.toFixed(3)],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg border border-zinc-800 p-3">
              <div className="text-[10px] uppercase text-zinc-500">{k}</div>
              <div className="font-mono text-lg font-bold">{v}</div>
            </div>
          ))}
        </div>
      )}

      <section>
        <h2 className="mb-2 font-bold">Live Match Controls</h2>
        <div className="space-y-2">
          {activeRounds.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-3 text-sm"
            >
              <span className="font-bold">
                {r.token.name} <span className="text-zinc-500">${r.token.symbol}</span>
              </span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">{r.state}</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs uppercase">{r.tier}</span>
              <div className="ml-auto flex gap-2">
                <button onClick={() => void act(`/api/admin/rounds/${r.id}/pause`)} className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700">
                  Pause
                </button>
                <button onClick={() => void act(`/api/admin/rounds/${r.id}/resume`)} className="rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700">
                  Resume
                </button>
                <button onClick={() => void act(`/api/admin/rounds/${r.id}/end`)} className="rounded bg-red-900/50 px-2 py-1 text-xs text-red-300 hover:bg-red-900">
                  End
                </button>
                <button onClick={() => void act(`/api/admin/rounds/${r.id}/rug`)} className="rounded bg-red-900/50 px-2 py-1 text-xs text-red-300 hover:bg-red-900" title="Paper-mode test tool: simulates a liquidity pull">
                  Simulate Rug
                </button>
              </div>
            </div>
          ))}
          {activeRounds.length === 0 && <div className="text-sm text-zinc-500">No active rounds.</div>}
        </div>
        <p className="mt-1 text-xs text-zinc-600">
          Emergency pause is rate-limited (3/hour) and logged — it cannot be used selectively.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Submission Review Queue</h2>
        <div className="space-y-2">
          {concepts
            .filter((c) => c.status === "submitted" || c.status === "shortlisted")
            .map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-3 text-sm">
                <span className="font-bold">
                  {c.name} <span className="text-zinc-500">${c.symbol}</span>
                </span>
                <span className="text-zinc-400">{c.theme}</span>
                <span className="font-mono text-xs text-zinc-500">{c.votes} votes</span>
                <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs">{c.status}</span>
                <div className="ml-auto flex gap-2">
                  {c.status === "submitted" && (
                    <button onClick={() => void act(`/api/admin/concepts/${c.id}/shortlist`)} className="rounded bg-sky-900/50 px-2 py-1 text-xs text-sky-300 hover:bg-sky-900">
                      Shortlist
                    </button>
                  )}
                  {["rookie", "standard", "degen"].map((tier) => (
                    <button
                      key={tier}
                      onClick={() => void act(`/api/admin/concepts/${c.id}/schedule`, { tier, inSeconds: 20 })}
                      className="rounded bg-amber-900/50 px-2 py-1 text-xs text-amber-300 hover:bg-amber-900"
                    >
                      Schedule {tier}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </section>

      {overview && (
        <section>
          <h2 className="mb-2 font-bold">Audit Log</h2>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-800 font-mono text-xs">
            {[...overview.log].reverse().map((l) => (
              <div key={l.id} className="border-b border-zinc-800/50 px-3 py-1.5">
                <span className="text-zinc-500">{new Date(l.at).toLocaleTimeString()}</span>{" "}
                <span className="font-bold text-amber-400">{l.action}</span>{" "}
                <span className="text-zinc-400">{l.detail}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
