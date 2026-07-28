"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { CoinSocials } from "@cookout/shared";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { ImagePicker } from "./ImagePicker";

/**
 * A pencil button only the coin's creator sees, on every coin card. It opens an
 * editor for the things a dev is allowed to change after launch: socials any
 * time, and the name / theme / pitch / coin image / banner until the coin
 * graduates (after that, socials only). The ticker and supply are never
 * editable. Saving reflects onto the live coin server-side.
 */

const SOCIAL_FIELDS = [
  { key: "x", icon: "𝕏", placeholder: "@handle or x.com/…" },
  { key: "telegram", icon: "✈️", placeholder: "@group or t.me/…" },
  { key: "youtube", icon: "▶️", placeholder: "youtube.com/@…" },
  { key: "instagram", icon: "📸", placeholder: "@handle or instagram.com/…" },
  { key: "website", icon: "🌐", placeholder: "yourcoin.xyz" },
] as const;

export interface EditableCoin {
  conceptId: string;
  creatorAddress: string;
  graduated?: boolean;
  name: string;
  symbol: string;
  theme: string;
  pitch?: string;
  artworkUrl?: string;
  bannerUrl?: string;
  socials?: CoinSocials;
}

const emptySocials = (): Required<Record<keyof CoinSocials, string>> => ({
  x: "",
  telegram: "",
  youtube: "",
  instagram: "",
  website: "",
});

export function EditCoinButton({
  coin,
  onSaved,
  className = "",
}: {
  coin: EditableCoin;
  onSaved?: () => void;
  className?: string;
}) {
  const { profile } = useSession();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [grad, setGrad] = useState(!!coin.graduated);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: coin.name,
    theme: coin.theme,
    pitch: coin.pitch ?? "",
    artworkUrl: coin.artworkUrl ?? "",
    bannerUrl: coin.bannerUrl ?? "",
    socials: { ...emptySocials(), ...(coin.socials ?? {}) },
  });
  useEffect(() => setMounted(true), []);

  const isDev =
    !!profile && profile.address.toLowerCase() === coin.creatorAddress.toLowerCase();
  if (!isDev) return null;

  const openEditor = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setError("");
    setOpen(true);
    setLoading(true);
    // Pull the authoritative current values (a cook-out card, for instance,
    // doesn't carry the pitch), then prefill the form from them.
    api<EditableCoin & { graduated?: boolean }>(`/api/concepts/${coin.conceptId}`)
      .then((c) => {
        setGrad(!!c.graduated);
        setForm({
          name: c.name ?? coin.name,
          theme: c.theme ?? coin.theme,
          pitch: c.pitch ?? "",
          artworkUrl: c.artworkUrl ?? "",
          bannerUrl: c.bannerUrl ?? "",
          socials: { ...emptySocials(), ...(c.socials ?? {}) },
        });
      })
      .catch(() => {
        // Fall back to whatever the card gave us.
        setForm({
          name: coin.name,
          theme: coin.theme,
          pitch: coin.pitch ?? "",
          artworkUrl: coin.artworkUrl ?? "",
          bannerUrl: coin.bannerUrl ?? "",
          socials: { ...emptySocials(), ...(coin.socials ?? {}) },
        });
      })
      .finally(() => setLoading(false));
  };

  const close = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!busy) setOpen(false);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = { socials: form.socials };
      if (!grad) {
        body.name = form.name;
        body.theme = form.theme;
        body.pitch = form.pitch || undefined;
        body.artworkUrl = form.artworkUrl || undefined;
        body.bannerUrl = form.bannerUrl || undefined;
      }
      await api(`/api/concepts/${coin.conceptId}`, { method: "PATCH", body });
      setOpen(false);
      onSaved?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={openEditor}
        title="Edit your coin"
        className={`rounded-full border border-zinc-700 bg-zinc-950/80 px-2 py-0.5 text-[11px] font-bold text-zinc-300 backdrop-blur transition hover:border-lime-400/60 hover:text-lime-300 ${className}`}
      >
        ✎ Edit
      </button>

      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={close}
          >
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-black">
                  Edit ${coin.symbol}
                </h3>
                <span className="font-mono text-xs text-zinc-500">
                  ticker &amp; supply locked
                </span>
              </div>
              {grad ? (
                <p className="mt-1 text-xs text-amber-300/90">
                  This coin graduated, so only its socials can be edited now.
                </p>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">
                  Update the look and the story. The ticker and supply can&apos;t change.
                </p>
              )}

              {!grad && (
                <div className="mt-4 space-y-3">
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Coin name"
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                  />
                  <input
                    value={form.theme}
                    onChange={(e) => setForm({ ...form, theme: e.target.value })}
                    placeholder="Theme (one line)"
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                  />
                  <textarea
                    value={form.pitch}
                    onChange={(e) => setForm({ ...form, pitch: e.target.value })}
                    placeholder="Pitch (optional)"
                    rows={2}
                    className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
                  />
                  <div className="flex flex-wrap items-end gap-6">
                    <ImagePicker
                      label="Coin image"
                      value={form.artworkUrl || undefined}
                      onChange={(dataUrl) => setForm({ ...form, artworkUrl: dataUrl })}
                    />
                    <ImagePicker
                      label="Promo banner (wide, optional)"
                      wide
                      size={1024}
                      value={form.bannerUrl || undefined}
                      onChange={(dataUrl) => setForm({ ...form, bannerUrl: dataUrl })}
                    />
                  </div>
                </div>
              )}

              <div className="mt-4">
                <div className="mb-1.5 text-xs text-zinc-500">Socials</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SOCIAL_FIELDS.map((f) => (
                    <div
                      key={f.key}
                      className="flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-2.5"
                    >
                      <span className="w-5 shrink-0 text-center text-sm">{f.icon}</span>
                      <input
                        placeholder={f.placeholder}
                        value={form.socials[f.key]}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            socials: { ...form.socials, [f.key]: e.target.value },
                          })
                        }
                        className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  onClick={(e) => close(e)}
                  disabled={busy}
                  className="text-sm text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void save()}
                  disabled={busy || loading}
                  className="rounded-xl bg-lime-400 px-6 py-2.5 font-black text-zinc-950 transition hover:bg-lime-300 disabled:opacity-50"
                >
                  {busy ? "Saving…" : loading ? "Loading…" : "Save changes"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
