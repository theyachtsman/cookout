"use client";

import { useCallback, useEffect, useState } from "react";
import type { TokenConcept } from "@cookout/shared";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { ImagePicker } from "../../components/ImagePicker";

export default function Submissions() {
  const { profile, signIn } = useSession();
  const [concepts, setConcepts] = useState<TokenConcept[]>([]);
  const [form, setForm] = useState({ name: "", symbol: "", theme: "", pitch: "", artworkUrl: "" });
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<TokenConcept[]>("/api/concepts")
      .then(setConcepts)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const submit = async () => {
    setError("");
    try {
      await api("/api/concepts", { body: { ...form, artworkUrl: form.artworkUrl || undefined } });
      setForm({ name: "", symbol: "", theme: "", pitch: "", artworkUrl: "" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const vote = async (id: string) => {
    setError("");
    try {
      await api(`/api/concepts/${id}/vote`, { body: {} });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const statusStyle: Record<string, string> = {
    submitted: "bg-zinc-800 text-zinc-300",
    shortlisted: "bg-sky-500/20 text-sky-300",
    scheduled: "bg-amber-500/20 text-amber-300",
    launched: "bg-emerald-500/20 text-emerald-300",
    rejected: "bg-red-500/20 text-red-300",
  };

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-zinc-800 p-5">
        <h1 className="mb-1 text-xl font-black">Submit a Token Concept</h1>
        <p className="mb-4 text-xs text-zinc-500">
          Tokens deploy from the platform-audited template only — you supply metadata, never code.
          No mint, pause, or blacklist controls. Community votes, the Arena Committee shortlists,
          winners get a match slot.
        </p>
        {!profile ? (
          <button
            onClick={() => void signIn()}
            className="rounded-lg bg-amber-500 px-4 py-2 font-black text-zinc-950"
          >
            Connect Wallet to Submit
          </button>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <input
              placeholder="Token name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
            />
            <input
              placeholder="SYMBOL"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm"
            />
            <input
              placeholder="Theme (one line)"
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value })}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm md:col-span-2"
            />
            <textarea
              placeholder="Pitch (optional)"
              value={form.pitch}
              onChange={(e) => setForm({ ...form, pitch: e.target.value })}
              className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm md:col-span-2"
              rows={2}
            />
            <div className="md:col-span-2">
              <ImagePicker
                label="Coin image"
                value={form.artworkUrl || undefined}
                onChange={(dataUrl) => setForm({ ...form, artworkUrl: dataUrl })}
              />
            </div>
            <button
              onClick={() => void submit()}
              className="w-fit rounded-lg bg-amber-500 px-5 py-2 font-black text-zinc-950 hover:bg-amber-400"
            >
              Submit Concept
            </button>
          </div>
        )}
        {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-bold">Community Voting</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {concepts.map((c) => (
            <div key={c.id} className="rounded-xl border border-zinc-800 p-4">
              <div className="flex items-start justify-between">
                <div className="flex gap-3">
                  {c.artworkUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.artworkUrl}
                      alt=""
                      className="h-12 w-12 rounded-lg border border-zinc-700 object-cover"
                    />
                  )}
                  <div>
                  <div className="font-black">
                    {c.name} <span className="text-zinc-500">${c.symbol}</span>
                  </div>
                  <div className="text-sm text-zinc-400">{c.theme}</div>
                  {c.pitch && <div className="mt-1 text-xs text-zinc-500">{c.pitch}</div>}
                  <div className="mt-1 text-xs text-zinc-600">
                    Launched by{" "}
                    <a href={`/creator/${c.creatorAddress}`} className="hover:underline">
                      {c.creatorAddress.slice(0, 6)}…{c.creatorAddress.slice(-4)}
                    </a>
                  </div>
                  </div>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs ${statusStyle[c.status]}`}>
                  {c.status}
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={() => void vote(c.id)}
                  disabled={!profile || (c.status !== "submitted" && c.status !== "shortlisted")}
                  className="rounded bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700 disabled:opacity-40"
                >
                  ▲ Upvote
                </button>
                <span className="font-mono text-sm text-zinc-400">{c.votes} votes</span>
              </div>
            </div>
          ))}
          {concepts.length === 0 && (
            <div className="text-sm text-zinc-500">No submissions yet — be first.</div>
          )}
        </div>
      </section>
    </div>
  );
}
