"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FEATURE_FLAGS,
  PERMISSIONS,
  ROLES,
  ROLE_MAP,
  type AuditEntry,
  type FeatureFlagDef,
  type Permission,
  type StaffAccount,
  type StaffRole,
} from "@cookout/shared";
import { cc, type CcSession } from "../../lib/cc";

/** Shared chrome so every Command Center module reads the same. */
export function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-zinc-900/40 p-5 ring-1 ring-white/5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-200">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone = "text-zinc-100", hint }: { label: string; value: string | number; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-zinc-950/60 p-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-black ${tone}`}>{value}</div>
      {hint && <div className="text-[10px] text-zinc-600">{hint}</div>}
    </div>
  );
}

const ago = (at: number) => {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
};

// ---------------------------------------------------------------- dashboard

interface DashboardData {
  platform: Record<string, number | boolean>;
  infrastructure: Record<string, number | string | boolean>;
  flags: Record<string, boolean>;
  recentActivity: AuditEntry[];
}

export function DashboardModule({ onGo }: { onGo: (module: string) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () =>
      cc<DashboardData>("/api/cc/dashboard")
        .then(setData)
        .catch((e) => setError((e as Error).message));
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);

  if (error) return <Panel title="Dashboard"><div className="text-sm text-red-300">{error}</div></Panel>;
  if (!data) return <Panel title="Dashboard"><div className="text-sm text-zinc-500">Loading…</div></Panel>;

  const p = data.platform as Record<string, number>;
  const i = data.infrastructure;
  const usd = (eth: number) => `$${(eth * (p.ethUsd ?? 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="space-y-5">
      <Panel title="Platform" subtitle="Live, refreshed every 10 seconds">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Players" value={p.players} hint={`+${p.newPlayers24h} in 24h`} />
          <Stat label="Active sessions" value={p.activeSessions} tone="text-lime-300" />
          <Stat label="Live matches" value={p.liveMatches} hint={`${p.activeMatches} active`} tone="text-emerald-300" />
          <Stat label="Live Pit matches" value={p.pitMatches} tone="text-fuchsia-300" />
          <Stat label="Volume 24h" value={p.volume24hEth.toFixed(2)} hint={usd(p.volume24hEth)} />
          <Stat label="Jackpot" value={p.jackpotEth.toFixed(4)} hint={usd(p.jackpotEth)} tone="text-amber-300" />
          <Stat label="BURGERS held" value={Math.round(p.burgersOutstanding).toLocaleString()} tone="text-orange-300" />
          <Stat label="BURGERS earned" value={Math.round(p.burgersEarned).toLocaleString()} />
        </div>
      </Panel>

      <Panel title="Infrastructure">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="API uptime" value={`${Math.floor(Number(i.uptimeSeconds) / 3600)}h ${Math.floor((Number(i.uptimeSeconds) % 3600) / 60)}m`} tone="text-lime-300" />
          <Stat label="Heap" value={`${i.memoryMb} MB`} />
          <Stat label="Database" value={String(i.persistence)} tone={i.persistence === "postgres" ? "text-lime-300" : "text-amber-300"} />
          <Stat label="Telegram bot" value={i.telegram ? "online" : "off"} tone={i.telegram ? "text-lime-300" : "text-zinc-500"} />
          <Stat label="Bot swarm" value={i.bots ? "on" : "off"} tone={i.bots ? "text-lime-300" : "text-zinc-500"} />
          <Stat label="Auto-schedule" value={i.autoSchedule ? "on" : "off"} tone={i.autoSchedule ? "text-lime-300" : "text-zinc-500"} />
          <Stat label="Staff signed in" value={Number(i.staffSessions)} />
          <Stat
            label="Features off"
            value={Object.values(data.flags).filter((v) => !v).length}
            tone="text-amber-300"
          />
        </div>
      </Panel>

      <Panel
        title="Recent activity"
        subtitle="The last things the team did"
        action={
          <button onClick={() => onGo("audit")} className="text-xs font-bold text-lime-300 hover:underline">
            Full audit log →
          </button>
        }
      >
        {data.recentActivity.length === 0 ? (
          <div className="text-sm text-zinc-500">Nothing yet.</div>
        ) : (
          <div className="space-y-1">
            {data.recentActivity.map((e) => (
              <div key={e.id} className="flex flex-wrap items-baseline gap-2 rounded-lg bg-zinc-950/50 px-3 py-1.5 text-xs">
                <span className="font-mono text-zinc-500">{ago(e.at)}</span>
                <span className="font-bold text-zinc-200">{e.actorName}</span>
                <span className="text-lime-300">{e.action}</span>
                {e.target && <span className="truncate text-zinc-400">{e.target}</span>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------ feature flags

export function FlagsModule() {
  const [values, setValues] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    cc<{ values: Record<string, boolean> }>("/api/cc/flags")
      .then((d) => setValues(d.values))
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const toggle = async (flag: FeatureFlagDef) => {
    setBusy(flag.key);
    setError("");
    try {
      const next = !values[flag.key];
      const d = await cc<{ values: Record<string, boolean> }>("/api/cc/flags", {
        method: "PATCH",
        body: { [flag.key]: next },
      });
      setValues(d.values);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const groups = [...new Set(FEATURE_FLAGS.map((f) => f.group))];
  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {groups.map((group) => (
        <Panel key={group} title={group} subtitle="Changes apply immediately — no deploy">
          <div className="space-y-2">
            {FEATURE_FLAGS.filter((f) => f.group === group).map((f) => {
              const on = values[f.key] ?? f.defaultValue;
              return (
                <div key={f.key} className="flex items-center gap-3 rounded-xl bg-zinc-950/50 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black text-zinc-100">{f.label}</div>
                    <div className="text-[11px] text-zinc-500">{f.description}</div>
                  </div>
                  <button
                    onClick={() => void toggle(f)}
                    disabled={busy === f.key}
                    className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-black transition disabled:opacity-40 ${
                      on ? "bg-lime-400 text-zinc-950 hover:bg-lime-300" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    }`}
                  >
                    {busy === f.key ? "…" : on ? "ON" : "OFF"}
                  </button>
                </div>
              );
            })}
          </div>
        </Panel>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- audit

export function AuditModule() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (moduleFilter) params.set("module", moduleFilter);
      cc<{ entries: AuditEntry[]; total: number }>(`/api/cc/audit?${params}`)
        .then((d) => {
          setEntries(d.entries);
          setTotal(d.total);
        })
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q, moduleFilter]);

  const modules = [...new Set(entries.map((e) => e.module))];
  return (
    <Panel
      title="Audit log"
      subtitle={`Every administrative action, newest first · ${total} recorded`}
      action={
        <div className="flex gap-2">
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
          >
            <option value="">All modules</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search actor, action, target…"
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
          />
        </div>
      }
    >
      {entries.length === 0 ? (
        <div className="text-sm text-zinc-500">Nothing matches.</div>
      ) : (
        <div className="space-y-1">
          {entries.map((e) => {
            const expanded = open === e.id;
            const hasDiff = e.before !== undefined || e.after !== undefined;
            return (
              <div key={e.id} className="rounded-lg bg-zinc-950/50">
                <button
                  onClick={() => setOpen(expanded ? null : e.id)}
                  className="flex w-full flex-wrap items-baseline gap-2 px-3 py-2 text-left text-xs"
                >
                  <span className="w-20 shrink-0 font-mono text-zinc-600">{ago(e.at)}</span>
                  <span className="w-24 shrink-0 truncate font-bold text-zinc-200">{e.actorName}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
                    {e.module}
                  </span>
                  <span className="font-bold text-lime-300">{e.action}</span>
                  {e.target && <span className="min-w-0 truncate text-zinc-400">{e.target}</span>}
                  {hasDiff && <span className="ml-auto text-zinc-600">{expanded ? "▾" : "▸"}</span>}
                </button>
                {expanded && (
                  <div className="grid gap-2 px-3 pb-3 text-[11px] sm:grid-cols-2">
                    <div>
                      <div className="mb-1 font-bold uppercase text-zinc-500">Before</div>
                      <pre className="overflow-x-auto rounded bg-zinc-900/80 p-2 text-red-200">
                        {JSON.stringify(e.before ?? null, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <div className="mb-1 font-bold uppercase text-zinc-500">After</div>
                      <pre className="overflow-x-auto rounded bg-zinc-900/80 p-2 text-lime-200">
                        {JSON.stringify(e.after ?? null, null, 2)}
                      </pre>
                    </div>
                    <div className="text-zinc-600 sm:col-span-2">
                      {new Date(e.at).toLocaleString()}
                      {e.ip && ` · ${e.ip}`}
                      {e.actorRole && ` · ${e.actorRole}`}
                      {e.note && ` · ${e.note}`}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// -------------------------------------------------------------------- team

export function TeamModule({ session }: { session: CcSession }) {
  const [accounts, setAccounts] = useState<StaffAccount[]>([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StaffAccount | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "moderator" as StaffRole });

  const load = useCallback(() => {
    cc<{ accounts: StaffAccount[] }>("/api/cc/staff")
      .then((d) => setAccounts(d.accounts))
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const canManage = session.permissions.includes("staff.manage");
  const myRole = session.account.role;
  const assignable = ROLE_MAP[myRole]?.canManage ?? [];

  const create = async () => {
    setError("");
    try {
      await cc("/api/cc/staff", { body: form });
      setCreating(false);
      setForm({ username: "", displayName: "", password: "", role: "moderator" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError("");
    try {
      await cc(`/api/cc/staff/${id}`, { method: "PATCH", body });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      <Panel
        title="Team"
        subtitle="Staff accounts and what each of them can do"
        action={
          canManage && (
            <button
              onClick={() => setCreating((v) => !v)}
              className="rounded-lg bg-lime-400 px-3 py-1.5 text-xs font-black text-zinc-950 hover:bg-lime-300"
            >
              {creating ? "Cancel" : "+ New account"}
            </button>
          )
        }
      >
        {creating && (
          <div className="mb-4 grid gap-2 rounded-xl bg-zinc-950/60 p-3 sm:grid-cols-2">
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="username"
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
            />
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="display name (optional)"
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
            />
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="password (12+ characters)"
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
            />
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as StaffRole })}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm ring-1 ring-white/10"
            >
              {ROLES.filter((r) => assignable.includes(r.key)).map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <div className="text-[11px] leading-snug text-zinc-500 sm:col-span-2">
              {ROLE_MAP[form.role]?.description}
            </div>
            <button
              onClick={() => void create()}
              className="rounded-lg bg-lime-400 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300 sm:col-span-2"
            >
              Create account
            </button>
          </div>
        )}

        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className="rounded-xl bg-zinc-950/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-black text-zinc-100">{a.displayName ?? a.username}</span>
                <span className="font-mono text-[11px] text-zinc-500">@{a.username}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${
                    a.role === "owner"
                      ? "bg-amber-400/20 text-amber-300"
                      : a.role === "admin"
                        ? "bg-lime-400/20 text-lime-300"
                        : "bg-zinc-800 text-zinc-400"
                  }`}
                >
                  {ROLE_MAP[a.role]?.label ?? a.role}
                </span>
                {a.twoFactorEnabled && (
                  <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">2FA</span>
                )}
                {a.disabled && (
                  <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300">disabled</span>
                )}
                <span className="ml-auto text-[11px] text-zinc-600">
                  {a.lastLoginAt ? `last in ${ago(a.lastLoginAt)}` : "never signed in"}
                </span>
              </div>
              {canManage && (
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <button
                    onClick={() => setEditing(editing?.id === a.id ? null : a)}
                    className="rounded bg-zinc-800 px-2 py-1 font-bold text-zinc-300 hover:bg-zinc-700"
                  >
                    Permissions
                  </button>
                  <button
                    onClick={() => void patch(a.id, { disabled: !a.disabled })}
                    className="rounded bg-zinc-800 px-2 py-1 font-bold text-zinc-300 hover:bg-zinc-700"
                  >
                    {a.disabled ? "Enable" : "Disable"}
                  </button>
                  <button
                    onClick={() => {
                      const password = prompt(`New password for @${a.username} (12+ characters)`);
                      if (password)
                        void cc(`/api/cc/staff/${a.id}/password`, { body: { password } })
                          .then(load)
                          .catch((e) => setError((e as Error).message));
                    }}
                    className="rounded bg-zinc-800 px-2 py-1 font-bold text-zinc-300 hover:bg-zinc-700"
                  >
                    Reset password
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete @${a.username}? This can't be undone.`))
                        void cc(`/api/cc/staff/${a.id}`, { method: "DELETE" })
                          .then(load)
                          .catch((e) => setError((e as Error).message));
                    }}
                    className="rounded bg-red-500/15 px-2 py-1 font-bold text-red-300 hover:bg-red-500/25"
                  >
                    Delete
                  </button>
                </div>
              )}
              {editing?.id === a.id && (
                <PermissionEditor
                  account={a}
                  onSave={(extra, denied) => {
                    void patch(a.id, { extraPermissions: extra, deniedPermissions: denied }).then(() =>
                      setEditing(null),
                    );
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Roles" subtitle="What each role can do out of the box">
        <div className="space-y-2">
          {ROLES.map((r) => (
            <div key={r.key} className="rounded-xl bg-zinc-950/50 p-3">
              <div className="text-sm font-black text-zinc-100">{r.label}</div>
              <div className="text-[11px] text-zinc-500">{r.description}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(r.key === "owner" ? ["everything"] : r.permissions).map((p) => (
                  <span key={p} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/** Per-account grants and denials on top of the role. */
function PermissionEditor({
  account,
  onSave,
}: {
  account: StaffAccount;
  onSave: (extra: Permission[], denied: Permission[]) => void;
}) {
  const base = useMemo(() => new Set(ROLE_MAP[account.role]?.permissions ?? []), [account.role]);
  const [extra, setExtra] = useState<Permission[]>(account.extraPermissions ?? []);
  const [denied, setDenied] = useState<Permission[]>(account.deniedPermissions ?? []);

  const cycle = (p: Permission) => {
    // Three states, in order: role default → granted → denied → back.
    if (denied.includes(p)) {
      setDenied(denied.filter((x) => x !== p));
      setExtra(extra.filter((x) => x !== p));
    } else if (extra.includes(p)) {
      setExtra(extra.filter((x) => x !== p));
      setDenied([...denied, p]);
    } else if (base.has(p)) {
      setDenied([...denied, p]);
    } else {
      setExtra([...extra, p]);
    }
  };

  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];
  return (
    <div className="mt-3 rounded-xl bg-zinc-900/60 p-3">
      {account.role === "owner" ? (
        <div className="text-[11px] text-amber-300">
          Owners always hold every permission — that&apos;s what stops the platform locking itself out.
        </div>
      ) : (
        <>
          <div className="mb-2 text-[11px] text-zinc-500">
            Click to cycle: <span className="text-zinc-400">role default</span> →{" "}
            <span className="text-lime-300">granted</span> → <span className="text-red-300">denied</span>. A
            denial always beats a grant.
          </div>
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-zinc-600">{g}</div>
              <div className="flex flex-wrap gap-1">
                {PERMISSIONS.filter((p) => p.group === g).map((p) => {
                  const isDenied = denied.includes(p.key);
                  const isExtra = extra.includes(p.key);
                  const fromRole = base.has(p.key) && !isDenied;
                  return (
                    <button
                      key={p.key}
                      title={p.description}
                      onClick={() => cycle(p.key)}
                      className={`rounded px-2 py-1 font-mono text-[10px] font-bold transition ${
                        isDenied
                          ? "bg-red-500/20 text-red-300 line-through"
                          : isExtra
                            ? "bg-lime-400/20 text-lime-300"
                            : fromRole
                              ? "bg-zinc-800 text-zinc-300"
                              : "bg-zinc-900 text-zinc-600"
                      }`}
                    >
                      {p.key}
                      {p.sensitive && " ⚠"}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            onClick={() => onSave(extra, denied)}
            className="mt-1 rounded-lg bg-lime-400 px-3 py-1.5 text-xs font-black text-zinc-950 hover:bg-lime-300"
          >
            Save permissions
          </button>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ account

export function AccountModule({ session, onChanged }: { session: CcSession; onChanged: () => void }) {
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [enrol, setEnrol] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState("");

  if (session.viaKey)
    return (
      <Panel title="Your account">
        <div className="text-sm text-amber-300">
          You&apos;re signed in with the shared admin key, not a staff account. Create a personal
          account in Team so your actions are attributable — the key has no password or 2FA of its own.
        </div>
      </Panel>
    );

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <Panel title="Your account" subtitle={`@${session.account.username} · ${ROLE_MAP[session.account.role]?.label}`}>
        <div className="grid gap-2 sm:max-w-sm">
          <input
            type="password"
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            placeholder="current password"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
          />
          <input
            type="password"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            placeholder="new password (12+ characters)"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
          />
          <button
            onClick={() => {
              setError("");
              setNote("");
              void cc("/api/cc/me/password", {
                body: { currentPassword: pw.current, newPassword: pw.next },
              })
                .then(() => {
                  setNote("Password changed. Your other sessions were signed out.");
                  setPw({ current: "", next: "" });
                  onChanged();
                })
                .catch((e) => setError((e as Error).message));
            }}
            className="rounded-lg bg-lime-400 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
          >
            Change password
          </button>
        </div>
      </Panel>

      <Panel
        title="Two-factor authentication"
        subtitle={session.account.twoFactorEnabled ? "Enabled on this account" : "Strongly recommended"}
      >
        {session.account.twoFactorEnabled ? (
          <button
            onClick={() => {
              const password = prompt("Confirm your password to turn 2FA off");
              if (!password) return;
              void cc("/api/cc/me/2fa/disable", { body: { password } })
                .then(() => {
                  setNote("Two-factor disabled.");
                  onChanged();
                })
                .catch((e) => setError((e as Error).message));
            }}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold text-zinc-200 hover:bg-zinc-700"
          >
            Disable 2FA
          </button>
        ) : enrol ? (
          <div className="space-y-2 sm:max-w-md">
            <div className="text-xs text-zinc-400">
              Add this secret to your authenticator app, then confirm with the code it shows.
            </div>
            <code className="block break-all rounded-lg bg-zinc-900 p-2 font-mono text-xs text-lime-300">
              {enrol.secret}
            </code>
            <code className="block break-all rounded-lg bg-zinc-900 p-2 font-mono text-[10px] text-zinc-500">
              {enrol.uri}
            </code>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="w-32 rounded-lg bg-zinc-900 px-3 py-2 font-mono text-sm outline-none ring-1 ring-white/10"
              />
              <button
                onClick={() =>
                  void cc("/api/cc/me/2fa/confirm", { body: { code } })
                    .then(() => {
                      setEnrol(null);
                      setNote("Two-factor enabled.");
                      onChanged();
                    })
                    .catch((e) => setError((e as Error).message))
                }
                className="rounded-lg bg-lime-400 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
              >
                Confirm
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() =>
              void cc<{ secret: string; uri: string }>("/api/cc/me/2fa/start", { body: {} })
                .then(setEnrol)
                .catch((e) => setError((e as Error).message))
            }
            className="rounded-lg bg-lime-400 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
          >
            Set up 2FA
          </button>
        )}
      </Panel>
    </div>
  );
}

// ----------------------------------------------------------------- backups

export function BackupsModule() {
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [text, setText] = useState("");

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}
      <Panel
        title="Configuration export"
        subtitle="Game settings, feature flags and the team roster (no password hashes)"
      >
        <button
          onClick={() =>
            void cc<Record<string, unknown>>("/api/cc/backup/export")
              .then((d) => {
                const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `cookout-config-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(a.href);
                setNote("Exported.");
              })
              .catch((e) => setError((e as Error).message))
          }
          className="rounded-lg bg-lime-400 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
        >
          Download configuration
        </button>
      </Panel>

      <Panel
        title="Configuration import"
        subtitle="Restores settings and flags. Staff accounts are never imported — recreate those by hand."
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Paste an exported configuration JSON…"
          className="w-full rounded-xl bg-zinc-900 p-3 font-mono text-xs outline-none ring-1 ring-white/10"
        />
        <button
          onClick={() => {
            setError("");
            setNote("");
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              setError("That isn't valid JSON.");
              return;
            }
            if (!confirm("Overwrite the live settings and flags with this file?")) return;
            void cc("/api/cc/backup/import", { body: parsed })
              .then(() => setNote("Configuration restored."))
              .catch((e) => setError((e as Error).message));
          }}
          className="mt-2 rounded-lg bg-amber-400 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-amber-300"
        >
          Restore configuration
        </button>
      </Panel>
    </div>
  );
}

/** Placeholder for modules whose backend is still the legacy admin surface. */
export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <Panel title={title}>
      <div className="rounded-xl bg-zinc-950/50 p-4 text-sm text-zinc-400">{note}</div>
    </Panel>
  );
}
