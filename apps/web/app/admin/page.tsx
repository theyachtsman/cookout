"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatMessage, Round, TokenConcept } from "@cookout/shared";
import { api } from "../../lib/api";

interface Overview {
  users: number;
  concepts: number;
  rounds: number;
  liveRounds: number;
  totalFees: number;
  betaSignups: number;
  whitelistOn: boolean;
  feedbackCount: number;
  settings: { autoSchedule: boolean; tier: string; leadSeconds: number };
  log: { id: string; at: number; action: string; detail: string }[];
}

interface Feedback {
  id: string;
  address: string;
  displayName?: string;
  text: string;
  page?: string;
  at: number;
}

function FlagClearer({ act }: { act: (path: string, body?: unknown, method?: string) => Promise<void> }) {
  const [addr, setAddr] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 p-3">
      <input
        placeholder="0x wallet address"
        value={addr}
        onChange={(e) => setAddr(e.target.value.trim())}
        className="w-96 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-mono text-sm"
      />
      <button
        onClick={() => addr && void act(`/api/admin/users/${addr}/clear-flags`).then(() => setAddr(""))}
        className="rounded bg-emerald-900/50 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-900"
      >
        Clear rug flag
      </button>
      <span className="text-xs text-zinc-500">
        Resets negative creator reputation to 0 so the wallet can submit again (logged).
      </span>
    </div>
  );
}

interface BetaSignup {
  address: string;
  xHandle?: string;
  at: number;
  approved: boolean;
}
interface BetaData {
  signups: BetaSignup[];
  total: number;
  approved: number;
  pending: number;
  whitelistOn: boolean;
}

function BetaList({ adminKey }: { adminKey: string }) {
  const [data, setData] = useState<BetaData | null>(null);
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<BetaData>("/api/admin/beta", { admin: adminKey }).then(setData).catch(() => {});
  }, [adminKey]);
  useEffect(load, [load]);

  const act = async (path: string, body?: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api(path, { admin: adminKey, body: body ?? {} });
      load();
    } finally {
      setBusy(false);
    }
  };

  const signups = data?.signups ?? [];

  return (
    <div className="rounded-lg border border-zinc-800 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span>
          <span className="font-mono font-bold text-emerald-400">{data?.approved ?? 0}</span>{" "}
          <span className="text-zinc-500">approved</span>
        </span>
        <span>
          <span className="font-mono font-bold text-amber-400">{data?.pending ?? 0}</span>{" "}
          <span className="text-zinc-500">pending</span>
        </span>
        <span
          className={`rounded px-2 py-0.5 text-xs font-bold ${
            data?.whitelistOn ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
          }`}
        >
          gate {data?.whitelistOn ? "ON" : "OFF"}
        </span>
        <button
          onClick={() =>
            void navigator.clipboard.writeText(
              signups.map((s) => `${s.address},${s.xHandle ?? ""},${s.approved ? "approved" : "pending"}`).join("\n"),
            )
          }
          className="ml-auto rounded bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
        >
          copy CSV
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          disabled={busy || (data?.pending ?? 0) === 0}
          onClick={() => {
            if (confirm(`Approve all ${data?.pending ?? 0} pending wallets? This opens the beta to everyone collected.`))
              void act("/api/admin/beta/approve-all");
          }}
          className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          🚀 Approve all pending (open beta)
        </button>
        <input
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          placeholder="0x… add/approve a wallet"
          className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs"
        />
        <button
          disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(addr.trim())}
          onClick={() => void act("/api/admin/beta/approve", { address: addr.trim() }).then(() => setAddr(""))}
          className="rounded bg-lime-500 px-3 py-1.5 text-xs font-bold text-zinc-950 hover:bg-lime-400 disabled:opacity-40"
        >
          Approve
        </button>
      </div>

      <div className="max-h-56 overflow-y-auto font-mono text-xs">
        {signups.map((s) => (
          <div key={s.address} className="flex items-center gap-2 border-b border-zinc-800/50 py-1">
            <span className={s.approved ? "text-emerald-400" : "text-amber-400"}>
              {s.approved ? "✓" : "•"}
            </span>
            <span className="truncate">{s.address}</span>
            <span className="ml-auto shrink-0 text-zinc-500">
              {s.xHandle && `@${s.xHandle} · `}
              {new Date(s.at).toLocaleDateString()}
            </span>
            <button
              disabled={busy}
              onClick={() =>
                void act(s.approved ? "/api/admin/beta/revoke" : "/api/admin/beta/approve", {
                  address: s.address,
                })
              }
              className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${
                s.approved
                  ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  : "bg-emerald-600 text-white hover:bg-emerald-500"
              }`}
            >
              {s.approved ? "revoke" : "approve"}
            </button>
            <button
              disabled={busy}
              title="Remove from the list (test/spam)"
              onClick={() => {
                if (confirm(`Remove ${s.address} from the beta list entirely?`))
                  void act("/api/admin/beta/remove", { address: s.address });
              }}
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold text-zinc-500 hover:bg-red-600/20 hover:text-red-300"
            >
              ✕
            </button>
          </div>
        ))}
        {signups.length === 0 && <div className="py-2 text-zinc-600">no signups yet</div>}
      </div>
      <p className="mt-2 text-[11px] text-zinc-600">
        Gate ON ⇒ only dev wallets + approved wallets can sign in. Collected signups stay{" "}
        <span className="text-amber-400">pending</span> until you approve them at launch.
      </p>
    </div>
  );
}

function FeedbackList({ adminKey }: { adminKey: string }) {
  const [items, setItems] = useState<Feedback[]>([]);
  useEffect(() => {
    api<Feedback[]>("/api/admin/feedback", { admin: adminKey })
      .then(setItems)
      .catch(() => {});
    const t = setInterval(
      () => void api<Feedback[]>("/api/admin/feedback", { admin: adminKey }).then(setItems).catch(() => {}),
      15000,
    );
    return () => clearInterval(t);
  }, [adminKey]);
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 p-2 text-sm">
      {items.map((f) => (
        <div key={f.id} className="rounded bg-zinc-900 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <a href={`/profile/${f.address}`} className="font-bold text-lime-300 hover:underline">
              {f.displayName ?? `${f.address.slice(0, 6)}…${f.address.slice(-4)}`}
            </a>
            {f.page && <span className="font-mono">{f.page}</span>}
            <span className="ml-auto">{new Date(f.at).toLocaleString()}</span>
          </div>
          <div className="mt-1 text-zinc-200">{f.text}</div>
        </div>
      ))}
      {items.length === 0 && <div className="px-3 py-4 text-zinc-600">No feedback yet.</div>}
    </div>
  );
}

export default function AdminPage() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [concepts, setConcepts] = useState<TokenConcept[]>([]);
  const [error, setError] = useState("");
  const [moderating, setModerating] = useState<string | null>(null);
  const [modChat, setModChat] = useState<ChatMessage[]>([]);

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

  const act = async (path: string, body?: unknown, method = "POST") => {
    try {
      setError("");
      await api(path, { admin: key, body: body ?? {}, method });
      void load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const loadModChat = useCallback(
    async (roundId: string) => {
      const d = await api<{ chat: ChatMessage[] }>(`/api/rounds/${roundId}`);
      setModChat(d.chat);
    },
    [],
  );

  const toggleModerate = (roundId: string) => {
    if (moderating === roundId) {
      setModerating(null);
      return;
    }
    setModerating(roundId);
    void loadModChat(roundId);
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
          className="rounded bg-lime-400 px-4 py-2 font-bold text-zinc-950"
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
          {[
            ["Users", overview.users],
            ["Concepts", overview.concepts],
            ["Rounds", overview.rounds],
            ["Live now", overview.liveRounds],
            ["Fees (pETH)", overview.totalFees.toFixed(3)],
            ["Beta signups", overview.betaSignups],
            ["Whitelist", overview.whitelistOn ? "🔒 ON" : "open"],
            ["Feedback", overview.feedbackCount],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-lg border border-zinc-800 p-3">
              <div className="text-[10px] uppercase text-zinc-500">{k}</div>
              <div className="font-mono text-lg font-bold">{v}</div>
            </div>
          ))}
        </div>
      )}

      {overview && (
        <section>
          <h2 className="mb-2 font-bold">Live Ops</h2>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 p-3 text-sm">
            <button
              onClick={() => void act("/api/admin/settings", { autoSchedule: !overview.settings.autoSchedule })}
              className={`rounded px-3 py-1.5 text-sm font-bold ${
                overview.settings.autoSchedule
                  ? "bg-emerald-900/60 text-emerald-300"
                  : "bg-zinc-800 text-zinc-400"
              }`}
            >
              Auto-schedule: {overview.settings.autoSchedule ? "ON" : "OFF"}
            </button>
            <label className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">tier</span>
              <select
                value={overview.settings.tier}
                onChange={(e) => void act("/api/admin/settings", { tier: e.target.value })}
                className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1"
              >
                <option value="rookie">rookie</option>
                <option value="standard">standard</option>
                <option value="degen">degen</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">lead seconds</span>
              <input
                defaultValue={overview.settings.leadSeconds}
                onBlur={(e) => void act("/api/admin/settings", { leadSeconds: Number(e.target.value) })}
                className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono"
              />
            </label>
            <span className="text-xs text-zinc-600">
              Whitelist gating is the BETA_WHITELIST=1 env var (restart to flip).
            </span>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-bold">Live Match Controls</h2>
        <div className="space-y-2">
          {activeRounds.map((r) => (
            <div key={r.id} className="rounded-lg border border-zinc-800 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
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
                  <button onClick={() => toggleModerate(r.id)} className="rounded bg-sky-900/50 px-2 py-1 text-xs text-sky-300 hover:bg-sky-900">
                    {moderating === r.id ? "Close Chat" : "Moderate Chat"}
                  </button>
                </div>
              </div>
              {moderating === r.id && (
                <div className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded bg-zinc-900 p-2">
                  {[...modChat].reverse().map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-xs">
                      <span className="font-bold text-lime-400">
                        {m.displayName ?? `${m.userAddress.slice(0, 6)}…`}
                      </span>
                      <span className="flex-1 truncate text-zinc-300">{m.text}</span>
                      <button
                        onClick={() =>
                          void act(`/api/admin/chat/${r.id}/${m.id}`, undefined, "DELETE").then(() => loadModChat(r.id))
                        }
                        className="rounded bg-red-900/50 px-1.5 py-0.5 text-red-300 hover:bg-red-900"
                      >
                        delete
                      </button>
                      <button
                        onClick={() => void act(`/api/admin/users/${m.userAddress}/mute`, { minutes: 15 })}
                        className="rounded bg-zinc-800 px-1.5 py-0.5 hover:bg-zinc-700"
                      >
                        mute 15m
                      </button>
                    </div>
                  ))}
                  {modChat.length === 0 && <div className="text-xs text-zinc-600">no messages</div>}
                </div>
              )}
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
                      className="rounded bg-lime-900/50 px-2 py-1 text-xs text-lime-300 hover:bg-lime-900"
                    >
                      Schedule {tier}
                    </button>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-bold">Creator Flags</h2>
        <FlagClearer act={act} />
      </section>

      <section>
        <h2 className="mb-2 font-bold">Beta Signups</h2>
        <BetaList adminKey={key} />
      </section>

      <section>
        <h2 className="mb-2 font-bold">Tester Feedback</h2>
        <FeedbackList adminKey={key} />
      </section>

      {overview && (
        <section>
          <h2 className="mb-2 font-bold">Audit Log</h2>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-800 font-mono text-xs">
            {[...overview.log].reverse().map((l) => (
              <div key={l.id} className="border-b border-zinc-800/50 px-3 py-1.5">
                <span className="text-zinc-500">{new Date(l.at).toLocaleTimeString()}</span>{" "}
                <span className="font-bold text-lime-400">{l.action}</span>{" "}
                <span className="text-zinc-400">{l.detail}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
