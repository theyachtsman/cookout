"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { useChainOnly } from "../../lib/chainOnly";
import { AudioMixer } from "../../components/AudioSettings";
import { TelegramConnect } from "../../components/TelegramConnect";
import { SelfExclusion } from "../../components/SelfExclusion";

/**
 * Settings — the one place to tune your account, The Pit Boss (Telegram)
 * notifications, and sound. Reached from the wallet drop-down in the top nav.
 * The Telegram card renders nothing until an operator configures the bot, so
 * this page gracefully collapses to Account + Sound when it's off.
 */
export default function SettingsPage() {
  const { profile, signIn, signOut, refresh } = useSession();
  const chainOnly = useChainOnly();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!profile)
    return (
      <div className="py-24 text-center">
        <div className="text-4xl">⚙️</div>
        <p className="mt-3 text-sm text-zinc-400">Sign in to manage your settings.</p>
        <button
          onClick={() => void signIn()}
          className="mt-4 rounded-lg bg-lime-400 px-6 py-3 font-black text-zinc-950 hover:bg-lime-300"
        >
          Play Now
        </button>
      </div>
    );

  const displayName =
    profile.displayName ?? `${profile.address.slice(0, 6)}…${profile.address.slice(-4)}`;

  const saveName = async () => {
    const next = name.trim();
    if (!next || next === profile.displayName) return;
    setSaving(true);
    try {
      await api("/api/me", { method: "PATCH", body: { displayName: next } });
      setName("");
      void refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="rounded-2xl bg-gradient-to-br from-lime-400/[0.1] via-zinc-900/40 to-zinc-900/40 p-6">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-lime-400">Settings</div>
        <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">
          Tune your Cookout.
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Your account, what The Pit Boss pings you about, and how the game sounds, all in one
          place.
        </p>
      </header>

      {/* Account */}
      <section className="rounded-2xl bg-zinc-900/40 p-5">
        <h2 className="text-sm font-black uppercase tracking-wide text-zinc-300">Account</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Signed in as{" "}
          <span className="font-mono text-zinc-400" title={profile.address}>
            {profile.address.slice(0, 6)}…{profile.address.slice(-4)}
          </span>{" "}
          · Lv{profile.level} {profile.title}
        </p>

        <label className="mt-4 block text-xs font-bold text-zinc-400">Display name</label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            placeholder={displayName}
            className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-lime-400/40"
          />
          <button
            onClick={() => void saveName()}
            disabled={saving || !name.trim() || name.trim() === profile.displayName}
            className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-600">Shown across the Cookout, up to 24 characters.</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/profile"
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-bold text-zinc-300 transition hover:bg-zinc-700"
          >
            👤 Profile &amp; stats
          </Link>
          <Link
            href="/wallet"
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-bold text-zinc-300 transition hover:bg-zinc-700"
          >
            {chainOnly ? "⚡ Cookout Wallet" : "⚡ Cook Out Balance"}
          </Link>
          <Link
            href={`/profile/${profile.address}`}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-bold text-zinc-300 transition hover:bg-zinc-700"
          >
            🌐 Public view
          </Link>
          <button
            onClick={() => signOut()}
            className="ml-auto rounded-lg bg-zinc-800/60 px-3 py-1.5 text-sm font-bold text-zinc-500 transition hover:bg-red-500/15 hover:text-red-300"
          >
            ⏏ Sign out
          </button>
        </div>
      </section>

      {/* The Pit Boss — Telegram companion + notification preferences.
          Renders nothing when the server has no bot configured. */}
      <TelegramConnect />

      {/* Sound */}
      <AudioMixer />

      {/* Responsible play. Last on the page on purpose — findable when wanted,
          not in the way of everything else. */}
      <SelfExclusion />
    </div>
  );
}
