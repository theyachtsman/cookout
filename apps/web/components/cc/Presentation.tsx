"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BRANDING_SLOTS,
  DEFAULT_BRAND_COLORS,
  SOUND_CUES,
  THEME_ASSET_SLOTS,
  themeWindowLabel,
  type AudioSettings,
  type BrandColors,
  type BrandingSettings,
  type Theme,
  type ThemeSettings,
} from "@cookout/shared";
import { cc } from "../../lib/cc";
import { Panel } from "./CcModules";
import { AssetPicker, assetUrl } from "./MediaLibrary";
import type { MediaAsset } from "@cookout/shared";

const COLOR_LABELS: Record<keyof BrandColors, string> = {
  accent: "Accent",
  accentText: "Accent text",
  background: "Background",
  surface: "Surface",
  positive: "Positive / up",
  negative: "Negative / down",
  warning: "Warning",
};

/** Colour swatch + hex entry, with a reset to the shipped default. */
function ColorRow({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  const shown = value || fallback;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-zinc-950/50 p-2">
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(shown) ? shown : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
      />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-bold text-zinc-300">{label}</div>
        <input
          value={value}
          placeholder={fallback}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent font-mono text-[11px] text-zinc-400 outline-none"
        />
      </div>
      {value && value !== fallback && (
        <button onClick={() => onChange(fallback)} className="text-[10px] text-zinc-600 hover:text-lime-300">
          reset
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ branding

export function BrandingModule() {
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    cc<{ branding: BrandingSettings }>("/api/cc/branding")
      .then((d) => setBranding(d.branding))
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const patch = async (body: Record<string, unknown>) => {
    setError("");
    setNote("");
    try {
      const d = await cc<{ branding: BrandingSettings }>("/api/cc/branding", { method: "PATCH", body });
      setBranding(d.branding);
      setNote("Saved. Players pick it up on their next load.");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!branding) return <Panel title="Branding"><div className="text-sm text-zinc-500">Loading…</div></Panel>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <Panel title="Identity">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Site name</span>
            <input
              defaultValue={branding.siteName}
              onBlur={(e) => e.target.value !== branding.siteName && void patch({ siteName: e.target.value })}
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Tagline</span>
            <input
              defaultValue={branding.tagline}
              onBlur={(e) => e.target.value !== branding.tagline && void patch({ tagline: e.target.value })}
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
            />
          </label>
        </div>
      </Panel>

      <Panel title="Assets" subtitle="Each slot falls back to the shipped default when empty">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BRANDING_SLOTS.map((slot) => (
            <AssetPicker
              key={slot.key}
              label={slot.label}
              hint={`${slot.description} · ${slot.recommended}`}
              kind="image"
              value={branding.assets[slot.key] ?? ""}
              onPick={(id) => void patch({ assets: { [slot.key]: id } })}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Brand colours" subtitle="Applied as CSS custom properties across the site">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(COLOR_LABELS) as (keyof BrandColors)[]).map((key) => (
            <ColorRow
              key={key}
              label={COLOR_LABELS[key]}
              value={branding.colors[key]}
              fallback={DEFAULT_BRAND_COLORS[key]}
              onChange={(v) => void patch({ colors: { [key]: v } })}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}

// -------------------------------------------------------------- theme studio

interface ThemeData {
  settings: ThemeSettings;
  active: Theme | null;
}

export function ThemesModule() {
  const [data, setData] = useState<ThemeData | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [newName, setNewName] = useState("");

  const load = useCallback(() => {
    cc<ThemeData>("/api/cc/themes")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>, message?: string) => {
    setError("");
    setNote("");
    try {
      await fn();
      if (message) setNote(message);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!data) return <Panel title="Theme Studio"><div className="text-sm text-zinc-500">Loading…</div></Panel>;
  const themes = Object.values(data.settings.themes).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <Panel
        title="Theming"
        subtitle={
          data.active
            ? `Live: ${data.active.name}`
            : data.settings.enabled
              ? "On, but nothing is scheduled right now — the default look applies"
              : "Off — the default look applies"
        }
        action={
          <button
            onClick={() =>
              void act(
                () => cc("/api/cc/themes/activate", { body: { enabled: !data.settings.enabled } }),
                data.settings.enabled ? "Theming turned off." : "Theming turned on.",
              )
            }
            className={`rounded-lg px-4 py-1.5 text-xs font-black ${
              data.settings.enabled ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {data.settings.enabled ? "ON" : "OFF"}
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New theme name…"
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
          />
          <button
            onClick={() => {
              if (!newName.trim()) return;
              void act(() => cc("/api/cc/themes", { body: { name: newName } }), "Theme created.");
              setNewName("");
            }}
            className="rounded-lg bg-lime-400 px-3 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
          >
            + Create theme
          </button>
          {data.settings.activeThemeId && (
            <button
              onClick={() => void act(() => cc("/api/cc/themes/activate", { body: { id: "" } }), "Pin cleared — the schedule is back in charge.")}
              className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold text-zinc-300 hover:bg-zinc-700"
            >
              Clear pinned theme
            </button>
          )}
        </div>
      </Panel>

      {themes.length === 0 ? (
        <Panel title="Themes">
          <div className="rounded-xl bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">
            No themes yet. Create one above — Halloween, Christmas, Summer BBQ, an anniversary.
          </div>
        </Panel>
      ) : (
        themes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            pinned={data.settings.activeThemeId === theme.id}
            live={data.active?.id === theme.id}
            expanded={editing === theme.id}
            onToggle={() => setEditing(editing === theme.id ? null : theme.id)}
            onAct={act}
          />
        ))
      )}
    </div>
  );
}

function ThemeCard({
  theme,
  pinned,
  live,
  expanded,
  onToggle,
  onAct,
}: {
  theme: Theme;
  pinned: boolean;
  live: boolean;
  expanded: boolean;
  onToggle: () => void;
  onAct: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
}) {
  const patch = (body: Record<string, unknown>, message?: string) =>
    onAct(() => cc(`/api/cc/themes/${theme.id}`, { method: "PATCH", body }), message);
  const toDateInput = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

  return (
    <Panel
      title={theme.name}
      subtitle={`${themeWindowLabel(theme)}${theme.description ? ` · ${theme.description}` : ""}`}
      action={
        <div className="flex flex-wrap gap-1.5">
          {live && (
            <span className="rounded-full bg-lime-400/20 px-2 py-1 text-[10px] font-black uppercase text-lime-300">
              Live
            </span>
          )}
          {pinned && (
            <span className="rounded-full bg-amber-400/20 px-2 py-1 text-[10px] font-black uppercase text-amber-300">
              Pinned
            </span>
          )}
          <button
            onClick={() =>
              void onAct(
                () => cc("/api/cc/themes/activate", { body: { id: pinned ? "" : theme.id, enabled: true } }),
                pinned ? "Unpinned." : `${theme.name} pinned live.`,
              )
            }
            className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700"
          >
            {pinned ? "Unpin" : "Go live now"}
          </button>
          <button onClick={onToggle} className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700">
            {expanded ? "Close" : "Edit"}
          </button>
        </div>
      }
    >
      {expanded && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-bold text-zinc-400">Name</span>
              <input
                defaultValue={theme.name}
                onBlur={(e) => e.target.value !== theme.name && void patch({ name: e.target.value })}
                className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-zinc-400">Description</span>
              <input
                defaultValue={theme.description}
                onBlur={(e) => e.target.value !== theme.description && void patch({ description: e.target.value })}
                className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-zinc-400">Starts</span>
              <input
                type="date"
                defaultValue={toDateInput(theme.startsAt)}
                onChange={(e) =>
                  void patch({ startsAt: e.target.value ? new Date(e.target.value).getTime() : null })
                }
                className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-zinc-400">Ends</span>
              <input
                type="date"
                defaultValue={toDateInput(theme.endsAt)}
                onChange={(e) =>
                  void patch({ endsAt: e.target.value ? new Date(e.target.value).getTime() : null })
                }
                className="mt-0.5 w-full rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
              />
            </label>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-zinc-500">Colours</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(COLOR_LABELS) as (keyof BrandColors)[]).map((key) => (
                <ColorRow
                  key={key}
                  label={COLOR_LABELS[key]}
                  value={theme.colors[key]}
                  fallback={DEFAULT_BRAND_COLORS[key]}
                  onChange={(v) => void patch({ colors: { [key]: v } })}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-zinc-500">Art</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {THEME_ASSET_SLOTS.map((slot) => (
                <AssetPicker
                  key={slot.key}
                  label={slot.label}
                  hint={slot.description}
                  kind="image"
                  value={theme.assets[slot.key] ?? ""}
                  onPick={(id) => void patch({ assets: { [slot.key]: id } })}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-zinc-500">Effects</div>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="block">
                <span className="text-[11px] font-bold text-zinc-400">Particles</span>
                <select
                  value={theme.effects.particles}
                  onChange={(e) => void patch({ effects: { particles: e.target.value } })}
                  className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-2 text-sm ring-1 ring-white/10"
                >
                  {["none", "snow", "leaves", "embers", "confetti", "rain"].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] font-bold text-zinc-400">Intensity</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  defaultValue={theme.effects.particleIntensity}
                  onBlur={(e) => void patch({ effects: { particleIntensity: Number(e.target.value) } })}
                  className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-2 font-mono text-sm outline-none ring-1 ring-white/10"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-bold text-zinc-400">Corner scale</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="2"
                  defaultValue={theme.effects.radiusScale}
                  onBlur={(e) => void patch({ effects: { radiusScale: Number(e.target.value) } })}
                  className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-2 font-mono text-sm outline-none ring-1 ring-white/10"
                />
              </label>
              <button
                onClick={() => void patch({ effects: { glow: !theme.effects.glow } })}
                className={`mt-4 rounded-lg px-3 py-2 text-xs font-black ${
                  theme.effects.glow ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400"
                }`}
              >
                Glow {theme.effects.glow ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-white/5 pt-3">
            <button
              onClick={() =>
                void onAct(
                  () => cc("/api/cc/themes", { body: { name: `${theme.name} copy`, duplicateOf: theme.id } }),
                  "Duplicated.",
                )
              }
              className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold text-zinc-200 hover:bg-zinc-700"
            >
              Duplicate
            </button>
            <button
              onClick={() => void patch({ archived: !theme.archived }, theme.archived ? "Restored." : "Archived.")}
              className="rounded-lg bg-zinc-800 px-3 py-2 text-sm font-bold text-zinc-200 hover:bg-zinc-700"
            >
              {theme.archived ? "Restore" : "Archive"}
            </button>
            <button
              onClick={() => {
                if (!confirm(`Delete the theme "${theme.name}"? This can't be undone.`)) return;
                void onAct(() => cc(`/api/cc/themes/${theme.id}`, { method: "DELETE" }), "Deleted.");
              }}
              className="ml-auto rounded-lg bg-red-500/15 px-3 py-2 text-sm font-black text-red-300 hover:bg-red-500/25"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------- audio manager

export function AudioModule() {
  const [audio, setAudio] = useState<AudioSettings | null>(null);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    cc<{ audio: AudioSettings }>("/api/cc/audio")
      .then((d) => setAudio(d.audio))
      .catch((e) => setError((e as Error).message));
    cc<{ assets: MediaAsset[] }>("/api/cc/media?kind=audio")
      .then((d) => setAssets(d.assets))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const patch = async (body: Record<string, unknown>, message?: string) => {
    setError("");
    setNote("");
    try {
      const d = await cc<{ audio: AudioSettings }>("/api/cc/audio", { method: "PATCH", body });
      setAudio(d.audio);
      if (message) setNote(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!audio) return <Panel title="Audio Manager"><div className="text-sm text-zinc-500">Loading…</div></Panel>;
  const groups = [...new Set(SOUND_CUES.map((c) => c.group))];

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <Panel
        title="Volumes"
        subtitle="Multipliers on top of each player's own audio setting — they can always turn it down further"
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-300">Master</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              defaultValue={audio.masterVolume}
              onMouseUp={(e) => void patch({ masterVolume: Number((e.target as HTMLInputElement).value) })}
              className="w-full"
            />
            <span className="font-mono text-[10px] text-zinc-500">{Math.round(audio.masterVolume * 100)}%</span>
          </label>
          {groups.map((g) => (
            <label key={g} className="block">
              <span className="text-[11px] font-bold text-zinc-300">{g}</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                defaultValue={audio.groupVolume[g] ?? 1}
                onMouseUp={(e) =>
                  void patch({ groupVolume: { [g]: Number((e.target as HTMLInputElement).value) } })
                }
                className="w-full"
              />
              <span className="font-mono text-[10px] text-zinc-500">
                {Math.round((audio.groupVolume[g] ?? 1) * 100)}%
              </span>
            </label>
          ))}
        </div>
      </Panel>

      {assets.length === 0 && (
        <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">
          No audio in the Media Library yet. Upload MP3, WAV or OGG files there and they&apos;ll appear
          here to assign.
        </div>
      )}

      {groups.map((group) => (
        <Panel key={group} title={group} subtitle="A cue with nothing assigned keeps its built-in sound">
          <div className="space-y-2">
            {SOUND_CUES.filter((c) => c.group === group).map((cue) => {
              const assigned = assets.find((a) => a.id === audio.cues[cue.key]);
              return (
                <div key={cue.key} className="flex flex-wrap items-center gap-3 rounded-xl bg-zinc-950/50 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-black text-zinc-100">{cue.label}</div>
                    <div className="text-[11px] text-zinc-500">{cue.description}</div>
                    <div className="font-mono text-[10px] text-zinc-600">{cue.key}</div>
                  </div>
                  {assigned && (
                    <audio controls src={assetUrl(assigned)} className="h-8 max-w-[12rem]" preload="none" />
                  )}
                  <select
                    value={audio.cues[cue.key] ?? ""}
                    onChange={(e) => void patch({ cues: { [cue.key]: e.target.value } })}
                    className="w-44 shrink-0 rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
                  >
                    <option value="">Built-in sound</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.originalName}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </Panel>
      ))}
    </div>
  );
}
