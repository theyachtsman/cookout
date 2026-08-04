"use client";

import { useCallback, useEffect, useState } from "react";
import type { GoonDialogueCategory, GoonPersona, GoonSettings } from "@cookout/shared";
import { cc } from "../../lib/cc";
import { Panel } from "./CcModules";

/**
 * The Flame Goon Squad — The Pit's AI personalities.
 *
 * Personality knobs bias *selection and frequency*; they never generate text.
 * Everything the Squad says comes from the weighted dialogue pools below, so
 * editing a pool is the only way to change its voice — which keeps the AI
 * predictable and keeps the writing under the team's control.
 */

const CATEGORIES: { key: GoonDialogueCategory; label: string }[] = [
  { key: "greeting", label: "Greeting (match goes live)" },
  { key: "matchCreated", label: "Match created" },
  { key: "bigBuy", label: "Big buy / whale" },
  { key: "bigSell", label: "Big sell" },
  { key: "rug", label: "Rug" },
  { key: "leaderChange", label: "Leader change" },
  { key: "finalMinute", label: "Final minute" },
  { key: "winner", label: "Winner" },
  { key: "upset", label: "Upset" },
  { key: "prediction", label: "Prediction" },
  { key: "ambient", label: "Ambient chatter" },
];

const KNOBS: { key: keyof GoonPersona; label: string; hint: string }[] = [
  { key: "chattiness", label: "Chattiness", hint: "How often they speak at all" },
  { key: "aggression", label: "Aggression", hint: "How confrontational the picks lean" },
  { key: "confidence", label: "Confidence", hint: "How certain they sound" },
  { key: "optimism", label: "Optimism", hint: "Bull vs bear tilt" },
  { key: "sarcasm", label: "Sarcasm", hint: "Dryness" },
  { key: "humor", label: "Humour", hint: "How much they play for laughs" },
];

const RARITY_TONE: Record<string, string> = {
  legendary: "bg-amber-400/20 text-amber-300",
  epic: "bg-lime-400/20 text-lime-300",
  elite: "bg-sky-400/20 text-sky-300",
  henchman: "bg-zinc-800 text-zinc-400",
};

export function GoonsModule() {
  const [settings, setSettings] = useState<GoonSettings | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    cc<{ settings: { goons?: GoonSettings } }>("/api/admin/overview")
      .then((d) => setSettings(d.settings.goons ?? null))
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const save = async (patch: Partial<GoonSettings>, message = "Saved.") => {
    if (!settings) return;
    setError("");
    setNote("");
    try {
      await cc("/api/admin/settings", { body: { goons: { ...settings, ...patch } } });
      setNote(message);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const savePersona = (handle: string, patch: Partial<GoonPersona>) => {
    if (!settings) return;
    save({ personas: settings.personas.map((p) => (p.handle === handle ? { ...p, ...patch } : p)) });
  };

  if (!settings)
    return <Panel title="Flame Goon Squad"><div className="text-sm text-zinc-500">Loading…</div></Panel>;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <Panel
        title="Behaviour"
        subtitle="Players always come first: if a human just spoke, the Squad mostly stays quiet."
        action={
          <button
            onClick={() => save({ enabled: !settings.enabled }, settings.enabled ? "Squad silenced." : "Squad live.")}
            className={`rounded-lg px-4 py-1.5 text-xs font-black ${
              settings.enabled ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {settings.enabled ? "ON" : "OFF"}
          </button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ["chatCooldownSec", "Cooldown (s)", "Minimum gap between any two AI messages in a room", "1"],
              ["namedChancePerEvent", "Named chance", "Legendary/epic reaction chance, 0–1", "0.05"],
              ["henchmanChancePerEvent", "Henchman chance", "Elite/henchman reaction chance, 0–1", "0.05"],
              ["maxPerEvent", "Max per event", "Hard cap on messages for one beat", "1"],
              ["humanQuietSec", "Human quiet (s)", "Stay quiet this long after a human speaks", "1"],
              ["ambientEverySec", "Ambient every (s)", "Idle chatter cadence in The Pit room", "1"],
              ["memoryHours", "Memory (hours)", "How long winners and streaks stay referenceable", "1"],
            ] as const
          ).map(([key, label, hint, step]) => (
            <label key={key} className="block">
              <span className="text-[11px] font-bold text-zinc-300">{label}</span>
              <input
                type="number"
                step={step}
                defaultValue={settings[key] as number}
                onBlur={(e) =>
                  Number(e.target.value) !== settings[key] && save({ [key]: Number(e.target.value) })
                }
                className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 font-mono text-sm outline-none ring-1 ring-white/10"
              />
              <span className="mt-0.5 block text-[10px] leading-snug text-zinc-600">{hint}</span>
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="Roster" subtitle={`${settings.personas.length} personas · ${settings.personas.filter((p) => p.enabled).length} active`}>
        <div className="space-y-2">
          {settings.personas.map((p) => {
            const expanded = open === p.handle;
            return (
              <div key={p.handle} className="rounded-xl bg-zinc-950/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-black text-zinc-100">{p.name}</span>
                  <span className="font-mono text-[11px] text-zinc-600">@{p.handle}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${RARITY_TONE[p.rarity] ?? RARITY_TONE.henchman}`}>
                    {p.rarity}
                  </span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{p.schedule}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{p.bio}</span>
                  <button
                    onClick={() => setOpen(expanded ? null : p.handle)}
                    className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700"
                  >
                    {expanded ? "Close" : "Edit"}
                  </button>
                  <button
                    onClick={() => savePersona(p.handle, { enabled: !p.enabled })}
                    className={`rounded-full px-3 py-1 text-[11px] font-black ${
                      p.enabled ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {p.enabled ? "ON" : "OFF"}
                  </button>
                </div>

                {expanded && (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-[11px] font-bold text-zinc-400">Name</span>
                        <input
                          defaultValue={p.name}
                          onBlur={(e) => e.target.value !== p.name && savePersona(p.handle, { name: e.target.value })}
                          className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-bold text-zinc-400">Catchphrase</span>
                        <input
                          defaultValue={p.catchphrase ?? ""}
                          onBlur={(e) =>
                            e.target.value !== (p.catchphrase ?? "") &&
                            savePersona(p.handle, { catchphrase: e.target.value })
                          }
                          className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="text-[11px] font-bold text-zinc-400">Bio (shown on their profile)</span>
                        <input
                          defaultValue={p.bio}
                          onBlur={(e) => e.target.value !== p.bio && savePersona(p.handle, { bio: e.target.value })}
                          className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-bold text-zinc-400">Schedule</span>
                        <select
                          value={p.schedule}
                          onChange={(e) => savePersona(p.handle, { schedule: e.target.value as GoonPersona["schedule"] })}
                          className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm ring-1 ring-white/10"
                        >
                          {["always", "weekend", "random", "tournament", "manual"].map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[11px] font-bold text-zinc-400">Rarity</span>
                        <select
                          value={p.rarity}
                          onChange={(e) => savePersona(p.handle, { rarity: e.target.value as GoonPersona["rarity"] })}
                          className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm ring-1 ring-white/10"
                        >
                          {["legendary", "epic", "elite", "henchman"].map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div>
                      <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-zinc-500">
                        Personality
                      </div>
                      <div className="text-[10px] text-zinc-600">
                        These bias which lines get picked and how often — they never write text.
                      </div>
                      <div className="mt-1 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                        {KNOBS.map((k) => (
                          <label key={k.key} className="block">
                            <span className="text-[10px] font-bold text-zinc-400">{k.label}</span>
                            <input
                              type="number"
                              step="0.05"
                              min="0"
                              max="1"
                              defaultValue={p[k.key] as number}
                              onBlur={(e) =>
                                Number(e.target.value) !== p[k.key] &&
                                savePersona(p.handle, { [k.key]: Number(e.target.value) })
                              }
                              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1 font-mono text-xs outline-none ring-1 ring-white/10"
                              title={k.hint}
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-zinc-500">
                        Dialogue
                      </div>
                      <div className="text-[10px] text-zinc-600">
                        One line per row. Tokens: {"{player} {rival} {winner} {symbol} {streak}"} are
                        filled from the live event.
                      </div>
                      <div className="mt-1 space-y-2">
                        {CATEGORIES.map((c) => {
                          const lines = p.pools[c.key] ?? [];
                          return (
                            <div key={c.key}>
                              <div className="text-[10px] font-bold text-zinc-400">
                                {c.label}{" "}
                                <span className="font-mono text-zinc-600">({lines.length})</span>
                              </div>
                              <textarea
                                defaultValue={lines.map((l) => l.text).join("\n")}
                                rows={Math.min(6, Math.max(2, lines.length))}
                                onBlur={(e) => {
                                  const next = e.target.value
                                    .split("\n")
                                    .map((t) => t.trim())
                                    .filter(Boolean)
                                    .map((text) => ({ text }));
                                  if (JSON.stringify(next) === JSON.stringify(lines.map((l) => ({ text: l.text }))))
                                    return;
                                  savePersona(p.handle, { pools: { ...p.pools, [c.key]: next } });
                                }}
                                className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-xs leading-snug outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <PreviewBox handle={p.handle} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

/** Ask the server to roll a line for this persona, exactly as the engine would. */
function PreviewBox({ handle }: { handle: string }) {
  const [category, setCategory] = useState<GoonDialogueCategory>("ambient");
  const [line, setLine] = useState("");
  return (
    <div className="rounded-lg bg-zinc-900/60 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold text-zinc-400">Preview a line</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as GoonDialogueCategory)}
          className="rounded bg-zinc-900 px-2 py-1 text-xs ring-1 ring-white/10"
        >
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <button
          onClick={() =>
            void cc<{ line?: string; name?: string }>("/api/admin/goons/preview", {
              body: { handle, category },
            })
              .then((d) => setLine(d.line ? `${d.name}: ${d.line}` : "(no line in this pool)"))
              .catch(() => setLine("preview failed"))
          }
          className="rounded bg-zinc-800 px-2 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700"
        >
          Roll
        </button>
      </div>
      {line && <div className="mt-1 text-xs italic text-lime-300">{line}</div>}
    </div>
  );
}
