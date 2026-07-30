"use client";

import { useEffect, useRef, useState } from "react";
import { NOTIFY_CATEGORIES, type NotifyCategory } from "@cookout/shared";
import { api } from "../lib/api";

/**
 * Profile card for the Telegram companion (The Pit Boss): connect / disconnect,
 * claim a Founding Member number, and tune what the bot pings you about. Renders
 * nothing when the server has no bot configured, so it's invisible until the
 * operator sets TELEGRAM_BOT_TOKEN.
 */
interface TgStatus {
  configured: boolean;
  linked: boolean;
  username: string | null;
  linkedAt: number | null;
  prefs: Record<NotifyCategory, boolean>;
  founderNumber: number | null;
  groupInvite: string | null;
}

export function TelegramConnect() {
  const [st, setSt] = useState<TgStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [err, setErr] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = () =>
    api<TgStatus>("/api/me/telegram")
      .then(setSt)
      .catch(() => {});

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (!st || !st.configured) return null;

  const connect = async () => {
    setBusy(true);
    setErr("");
    try {
      const { url } = await api<{ url: string }>("/api/me/telegram/link", { method: "POST" });
      window.open(url, "_blank", "noopener");
      // Poll for the link to land (they tap Start over in Telegram).
      setWaiting(true);
      let tries = 0;
      pollRef.current = setInterval(async () => {
        tries += 1;
        const s = await api<TgStatus>("/api/me/telegram").catch(() => null);
        if (s?.linked || tries > 40) {
          if (pollRef.current) clearInterval(pollRef.current);
          setWaiting(false);
          if (s) setSt(s);
        }
      }, 3000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      const s = await api<TgStatus>("/api/me/telegram", { method: "DELETE" });
      setSt(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (key: NotifyCategory) => {
    const next = !st.prefs[key];
    setSt({ ...st, prefs: { ...st.prefs, [key]: next } }); // optimistic
    await api("/api/me/telegram/prefs", { method: "PATCH", body: { prefs: { [key]: next } } }).catch(
      () => void load(),
    );
  };

  const claimFounder = async () => {
    setBusy(true);
    setErr("");
    try {
      const { founderNumber } = await api<{ founderNumber: number }>("/api/me/founder", {
        method: "POST",
      });
      setSt((s) => (s ? { ...s, founderNumber } : s));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const groups = [
    { key: "you" as const, label: "About you" },
    { key: "community" as const, label: "The Cookout" },
  ];

  return (
    <section className="rounded-2xl bg-gradient-to-br from-sky-500/[0.1] to-sky-500/[0.02] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black uppercase tracking-wide text-sky-300">
            📣 The Pit Boss · Telegram
          </h2>
          <p className="mt-0.5 text-xs text-zinc-400">
            Your companion for The Cookout. Get pinged when something&apos;s cooking.
          </p>
        </div>
        {st.founderNumber ? (
          <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-300">
            🥇 Founding Member #{st.founderNumber}
          </span>
        ) : (
          <button
            onClick={() => void claimFounder()}
            disabled={busy}
            className="rounded-full bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-300 transition hover:bg-amber-400/20 disabled:opacity-50"
          >
            🥇 Claim Founding Member
          </button>
        )}
      </div>

      {err && <div className="mt-3 text-xs text-red-400">{err}</div>}

      {!st.linked ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void connect()}
            disabled={busy || waiting}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-black text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {waiting ? "Waiting for Telegram…" : "Connect Telegram"}
          </button>
          {waiting && (
            <span className="text-xs text-zinc-400">
              Opened Telegram — tap <b className="text-zinc-200">Start</b>, then come back.
            </span>
          )}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-950/40 px-3 py-2">
            <span className="text-sm text-zinc-300">
              ✅ Connected{st.username ? ` as @${st.username}` : ""}
            </span>
            <button
              onClick={() => void disconnect()}
              disabled={busy}
              className="text-xs font-bold text-zinc-500 hover:text-red-300 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>

          {st.groupInvite && (
            <a
              href={st.groupInvite}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-black text-white hover:bg-sky-400"
            >
              🔥 Join the Cook Out group on Telegram
            </a>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                  {g.label}
                </div>
                <div className="space-y-1.5">
                  {NOTIFY_CATEGORIES.filter((c) => c.group === g.key).map((c) => (
                    <button
                      key={c.key}
                      onClick={() => void toggle(c.key)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-800/40"
                    >
                      <span>
                        <span className="block text-xs font-bold text-zinc-200">{c.label}</span>
                        <span className="block text-[10px] text-zinc-500">{c.desc}</span>
                      </span>
                      <span
                        className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                          st.prefs[c.key] ? "bg-sky-500" : "bg-zinc-700"
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                            st.prefs[c.key] ? "left-[18px]" : "left-0.5"
                          }`}
                        />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
