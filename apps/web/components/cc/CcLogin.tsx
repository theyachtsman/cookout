"use client";

import { useEffect, useState } from "react";
import { cc, setCcAdminKey, setCcToken } from "../../lib/cc";

/**
 * The Command Center sign-in. Three doors, in order of preference:
 *  1. a staff account (username + password, plus a 2FA code when enrolled);
 *  2. first-run bootstrap, which mints the first Owner and needs the server's
 *     admin key — so the founding account is created by whoever runs the box;
 *  3. the shared admin key on its own, kept as break-glass.
 */
export function CcLogin({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<"login" | "bootstrap" | "key">("login");
  const [needsOwner, setNeedsOwner] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", totp: "", displayName: "", adminKey: "" });
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    cc<{ needsOwner: boolean }>("/api/cc/bootstrap")
      .then((d) => {
        setNeedsOwner(d.needsOwner);
        if (d.needsOwner) setMode("bootstrap");
      })
      .catch(() => {});
  }, []);

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${(await import("../../lib/api")).apiUrl()}/api/cc/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: form.username,
          password: form.password,
          totp: form.totp || undefined,
        }),
      });
      const data = (await res.json()) as { token?: string; error?: string; totpRequired?: boolean };
      if (data.totpRequired) {
        setNeedsTotp(true);
        setError("Enter the 6-digit code from your authenticator app.");
        return;
      }
      if (!res.ok || !data.token) throw new Error(data.error ?? "sign-in failed");
      setCcAdminKey(null); // a real account supersedes any stored break-glass key
      setCcToken(data.token);
      onSignedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bootstrap = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${(await import("../../lib/api")).apiUrl()}/api/cc/bootstrap`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": form.adminKey },
        body: JSON.stringify({
          username: form.username,
          password: form.password,
          displayName: form.displayName || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "could not create the owner account");
      setMode("login");
      setNeedsOwner(false);
      setError("Owner created. Sign in with it now.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const useKey = async () => {
    setBusy(true);
    setError("");
    setCcAdminKey(form.adminKey);
    try {
      await cc("/api/cc/me");
      onSignedIn();
    } catch (e) {
      setCcAdminKey(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const field = (
    label: string,
    key: keyof typeof form,
    type = "text",
    placeholder = "",
    autoComplete?: string,
  ) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-zinc-500">{label}</span>
      <input
        type={type}
        value={form[key]}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || busy) return;
          if (mode === "login") void signIn();
          else if (mode === "bootstrap") void bootstrap();
          else void useKey();
        }}
        className="w-full rounded-xl bg-zinc-900/70 px-3 py-2.5 text-sm outline-none ring-1 ring-white/10 focus:ring-lime-400/50"
      />
    </label>
  );

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center">
      <div className="rounded-3xl bg-zinc-950 p-6 ring-1 ring-white/10">
        <div className="text-[11px] font-black uppercase tracking-[0.25em] text-lime-300">The Cookout</div>
        <h1 className="mt-1 text-2xl font-black text-zinc-50">Command Center</h1>
        <p className="mt-1 text-xs text-zinc-500">
          Internal operations. Authorized team members only — every action in here is logged.
        </p>

        <div className="mt-5 space-y-3">
          {mode === "login" && (
            <>
              {field("Username", "username", "text", "", "username")}
              {field("Password", "password", "password", "", "current-password")}
              {needsTotp && field("Two-factor code", "totp", "text", "123456", "one-time-code")}
              <button
                onClick={() => void signIn()}
                disabled={busy}
                className="w-full rounded-xl bg-lime-400 py-2.5 text-sm font-black text-zinc-950 transition hover:bg-lime-300 disabled:opacity-40"
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </>
          )}

          {mode === "bootstrap" && (
            <>
              <div className="rounded-xl bg-amber-500/10 p-3 text-[11px] leading-snug text-amber-200">
                {needsOwner
                  ? "No owner account exists yet. Create the first one — this needs the server's ADMIN_KEY, so only someone with access to the box can do it."
                  : "An owner already exists. Sign in instead."}
              </div>
              {field("Username", "username", "text", "", "username")}
              {field("Display name (optional)", "displayName")}
              {field("Password", "password", "password", "at least 12 characters", "new-password")}
              {field("Server ADMIN_KEY", "adminKey", "password")}
              <button
                onClick={() => void bootstrap()}
                disabled={busy || !needsOwner}
                className="w-full rounded-xl bg-lime-400 py-2.5 text-sm font-black text-zinc-950 transition hover:bg-lime-300 disabled:opacity-40"
              >
                {busy ? "Creating…" : "Create owner account"}
              </button>
            </>
          )}

          {mode === "key" && (
            <>
              <div className="rounded-xl bg-zinc-900/60 p-3 text-[11px] leading-snug text-zinc-400">
                Break-glass access with the server&apos;s shared key. It behaves as an Owner and is
                audited as <span className="font-mono text-zinc-300">admin-key</span>. Prefer a real
                account so actions are attributable to a person.
              </div>
              {field("Server ADMIN_KEY", "adminKey", "password")}
              <button
                onClick={() => void useKey()}
                disabled={busy}
                className="w-full rounded-xl bg-zinc-800 py-2.5 text-sm font-black text-zinc-100 transition hover:bg-zinc-700 disabled:opacity-40"
              >
                {busy ? "Checking…" : "Use admin key"}
              </button>
            </>
          )}

          {error && <div className="text-center text-xs text-amber-300">{error}</div>}

          <div className="flex justify-center gap-3 pt-1 text-[11px] text-zinc-500">
            {mode !== "login" && (
              <button onClick={() => setMode("login")} className="hover:text-zinc-300">
                Sign in with an account
              </button>
            )}
            {mode !== "bootstrap" && needsOwner && (
              <button onClick={() => setMode("bootstrap")} className="hover:text-zinc-300">
                Create the first owner
              </button>
            )}
            {mode !== "key" && (
              <button onClick={() => setMode("key")} className="hover:text-zinc-300">
                Use the admin key
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
