"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameSettings } from "@cookout/shared";
import { cc } from "../../lib/cc";
import { Panel } from "./CcModules";

/**
 * Game Configuration — the gameplay values that used to be constants.
 *
 * Everything is edited by dotted path and saved as one patch, so the server
 * validates the whole change before applying any of it. Each field shows the
 * compiled default and can be reset to it individually, which makes an
 * experiment safe to walk back without hunting through the audit log.
 */

interface GameConfigData {
  settings: GameSettings;
  defaults: GameSettings;
  catalog: {
    modes: { key: string; name: string; tagline: string }[];
    missions: { id: string; name: string; description: string; period: string; metric: string }[];
    achievements: { id: string; name: string; description: string }[];
    xpEvents: string[];
  };
}

type Draft = Record<string, unknown>;

export function GameConfigModule() {
  const [data, setData] = useState<GameConfigData | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [tab, setTab] = useState<"trading" | "modes" | "xp" | "quests" | "achievements">("trading");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    cc<GameConfigData>("/api/cc/game")
      .then((d) => {
        setData(d);
        setDraft({});
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const dirty = Object.keys(draft).length;

  const save = async () => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await cc("/api/cc/game", { method: "PATCH", body: draft });
      setNote(`Saved ${dirty} change${dirty === 1 ? "" : "s"}. Live from the next round.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <Panel title="Game Configuration"><div className="text-sm text-red-300">{error}</div></Panel>;
  if (!data) return <Panel title="Game Configuration"><div className="text-sm text-zinc-500">Loading…</div></Panel>;

  const read = (path: string): unknown =>
    path in draft ? draft[path] : readPath(data.settings, path);
  const defaultOf = (path: string) => readPath(data.defaults, path);
  const set = (path: string, value: unknown) => {
    setDraft((d) => {
      const next = { ...d };
      // Typing a value back to what's stored isn't a change — drop it so the
      // patch only ever carries real edits.
      if (JSON.stringify(value) === JSON.stringify(readPath(data.settings, path))) delete next[path];
      else next[path] = value;
      return next;
    });
  };

  const ctx = { read, defaultOf, set, draft, data };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-zinc-950/95 p-2 ring-1 ring-white/10 backdrop-blur">
        {(
          [
            ["trading", "Trading & Tiers"],
            ["modes", "Game Modes"],
            ["xp", "XP & Progression"],
            ["quests", "Quests"],
            ["achievements", "Achievements"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${
              tab === k ? "bg-lime-400 text-zinc-950" : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {dirty > 0 && (
            <>
              <span className="text-xs font-bold text-amber-300">{dirty} unsaved</span>
              <button
                onClick={() => setDraft({})}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-bold text-zinc-300 hover:bg-zinc-700"
              >
                Discard
              </button>
            </>
          )}
          <button
            onClick={() => void save()}
            disabled={busy || dirty === 0}
            className="rounded-lg bg-lime-400 px-4 py-1.5 text-xs font-black text-zinc-950 transition hover:bg-lime-300 disabled:opacity-30"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {tab === "trading" && <TradingTab {...ctx} />}
      {tab === "modes" && <ModesTab {...ctx} />}
      {tab === "xp" && <XpTab {...ctx} />}
      {tab === "quests" && <QuestsTab {...ctx} />}
      {tab === "achievements" && <AchievementsTab {...ctx} />}

      <Panel title="Reset everything" subtitle="Put every gameplay value back to the shipped defaults">
        <button
          onClick={() => {
            if (!confirm("Reset ALL gameplay configuration to the compiled defaults?")) return;
            void cc("/api/cc/game/reset", { body: {} })
              .then(() => {
                setNote("Reset to defaults.");
                load();
              })
              .catch((e) => setError((e as Error).message));
          }}
          className="rounded-lg bg-red-500/15 px-3 py-2 text-sm font-black text-red-300 hover:bg-red-500/25"
        >
          Reset all to defaults
        </button>
      </Panel>
    </div>
  );
}

interface Ctx {
  read: (path: string) => unknown;
  defaultOf: (path: string) => unknown;
  set: (path: string, value: unknown) => void;
  draft: Draft;
  data: GameConfigData;
}

/** One editable value, with its default and a per-field reset. */
function Field({
  ctx,
  path,
  label,
  hint,
  step = "any",
}: {
  ctx: Ctx;
  path: string;
  label: string;
  hint?: string;
  step?: string;
}) {
  const value = ctx.read(path);
  const def = ctx.defaultOf(path);
  const changed = path in ctx.draft;
  const differs = JSON.stringify(value) !== JSON.stringify(def);
  return (
    <label className="block">
      <span className="mb-0.5 flex items-baseline gap-1.5">
        <span className="text-[11px] font-bold text-zinc-300">{label}</span>
        {changed && <span className="text-[10px] font-black text-amber-300">•</span>}
        {differs && (
          <button
            onClick={() => ctx.set(path, def)}
            title={`Default: ${JSON.stringify(def)}`}
            className="ml-auto text-[10px] text-zinc-600 hover:text-lime-300"
          >
            reset ({String(def)})
          </button>
        )}
      </span>
      <input
        type="number"
        step={step}
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => ctx.set(path, e.target.value === "" ? null : Number(e.target.value))}
        className={`w-full rounded-lg bg-zinc-900 px-2.5 py-1.5 font-mono text-sm outline-none ring-1 transition ${
          changed ? "ring-amber-400/60" : "ring-white/10 focus:ring-lime-400/40"
        }`}
      />
      {hint && <span className="mt-0.5 block text-[10px] leading-snug text-zinc-600">{hint}</span>}
    </label>
  );
}

function Toggle({ ctx, path, label }: { ctx: Ctx; path: string; label: string }) {
  const on = !!ctx.read(path);
  const changed = path in ctx.draft;
  return (
    <button
      onClick={() => ctx.set(path, !on)}
      className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-bold transition ${
        changed ? "bg-amber-400/10 ring-1 ring-amber-400/50" : "bg-zinc-900 ring-1 ring-white/10"
      }`}
    >
      <span className="text-zinc-300">{label}</span>
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${on ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"}`}>
        {on ? "ON" : "OFF"}
      </span>
    </button>
  );
}

const TIER_FIELDS: [keyof GameSettings["tiers"]["rookie"], string, string][] = [
  ["tradeFeeBps", "Trade fee (bps)", "Taken on every continuous trade"],
  ["auctionFeeBps", "Auction fee (bps)", "Taken on Fair Open fills"],
  ["maxDurationSeconds", "Round length (s)", "Overridden by the mode's minutes when set"],
  ["lobbySeconds", "Lobby (s)", "Before the queue opens"],
  ["queueSeconds", "Queue (s)", "How long the Fair Open accepts intents"],
  ["auctionMaxRaise", "Fair Open cap", "Overridden by the mode's pull-up cap"],
  ["initialEthLiquidity", "Seed liquidity (pETH)", ""],
  ["initialTokenLiquidity", "Seed tokens", ""],
  ["totalSupply", "Total supply", ""],
  ["maxPositionEth", "Queue position cap", "0 = uncapped"],
  ["liveMaxPositionEth", "Live position cap", "0 = uncapped"],
  ["devSellLockSeconds", "Dev sell lock (s)", "0 = no lock"],
  ["graduationMinHolders", "Graduation: holders", ""],
  ["graduationMinVolume", "Graduation: volume", ""],
  ["mcapTarget", "Mcap end target", "0 = disabled"],
  ["lowVolumeThreshold", "Low-volume threshold", "0 = never ends on quiet"],
  ["lowVolumeWindowSeconds", "Low-volume window (s)", ""],
];

function TradingTab(ctx: Ctx) {
  return (
    <div className="space-y-4">
      <Panel title="Bonding" subtitle="What it takes for a coin to serve up">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            ctx={ctx}
            path="bondTargetUsd"
            label="Bond target (USD)"
            hint="Converted to a pETH market cap at the live ETH price and frozen per round"
          />
        </div>
      </Panel>
      {(["rookie", "standard", "degen"] as const).map((tier) => (
        <Panel key={tier} title={`${tier} tier`} subtitle="Applies to the next round scheduled at this tier">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {TIER_FIELDS.map(([key, label, hint]) => (
              <Field key={key} ctx={ctx} path={`tiers.${tier}.${key}`} label={label} hint={hint} />
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

function ModesTab(ctx: Ctx) {
  return (
    <div className="space-y-4">
      {ctx.data.catalog.modes.map((m) => (
        <Panel key={m.key} title={m.name} subtitle={m.tagline}>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Field
              ctx={ctx}
              path={`modes.${m.key}.minutes`}
              label="Match minutes"
              hint="Blank = no timer (Endurance)"
            />
            <Field ctx={ctx} path={`modes.${m.key}.pullUpCap`} label="Pull-up cap (pETH)" />
            <Field ctx={ctx} path={`modes.${m.key}.unlockLevel`} label="Unlock level" step="1" />
            <div className="flex flex-col justify-end gap-2">
              <Toggle ctx={ctx} path={`modes.${m.key}.rugRules`} label="Rug rules" />
              <Toggle ctx={ctx} path={`modes.${m.key}.disabled`} label="Hidden / disabled" />
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}

function XpTab(ctx: Ctx) {
  const events = useMemo(() => [...ctx.data.catalog.xpEvents].sort(), [ctx.data.catalog.xpEvents]);
  const podium = (ctx.read("podiumXp") as number[]) ?? [];
  return (
    <div className="space-y-4">
      <Panel title="XP per event" subtitle="What each gameplay moment pays">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {events.map((e) => (
            <Field key={e} ctx={ctx} path={`xp.${e}`} label={e.replace(/_/g, " ")} step="1" />
          ))}
        </div>
      </Panel>
      <Panel title="Round podium" subtitle="Zero-sum — only three players earn it per round">
        <div className="grid gap-3 sm:grid-cols-3">
          {podium.map((_, i) => (
            <Field key={i} ctx={ctx} path={`podiumXp.${i}`} label={`${["1st", "2nd", "3rd"][i] ?? `#${i + 1}`} place`} step="1" />
          ))}
        </div>
      </Panel>
      <Panel title="Trade XP curve" subtitle="Trade n pays round(base · decay^(n-1)), capped per round and per day">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field ctx={ctx} path="tradeXp.base" label="Base" />
          <Field ctx={ctx} path="tradeXp.decay" label="Decay (0–1)" step="0.05" />
          <Field ctx={ctx} path="tradeXp.roundCap" label="Per-round cap" step="1" />
          <Field ctx={ctx} path="tradeXp.dailyCap" label="Per-day cap" step="1" />
        </div>
      </Panel>
      <Panel title="Achievement XP by rarity" subtitle="One-time payout when a badge unlocks">
        <div className="grid gap-3 sm:grid-cols-4">
          {(["common", "rare", "epic", "legendary"] as const).map((r) => (
            <Field key={r} ctx={ctx} path={`achievementXp.${r}`} label={r} step="1" />
          ))}
        </div>
      </Panel>
      <Panel title="Quest set bonuses">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field ctx={ctx} path="dailySetBonusXp" label="Daily set bonus" step="1" />
          <Field ctx={ctx} path="weeklySetBonusXp" label="Weekly set bonus" step="1" />
          <Field
            ctx={ctx}
            path="dailyActiveCount"
            label="Dailies live per day"
            step="1"
            hint="How many of the daily pool rotate in each day"
          />
        </div>
      </Panel>
    </div>
  );
}

function QuestsTab(ctx: Ctx) {
  const [period, setPeriod] = useState<"daily" | "weekly">("daily");
  const list = ctx.data.catalog.missions.filter((m) => m.period === period);
  return (
    <Panel
      title="Quests"
      subtitle="Targets and payouts are live; switching one off removes it from the board"
      action={
        <div className="flex gap-1">
          {(["daily", "weekly"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-3 py-1 text-xs font-black ${
                period === p ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      }
    >
      <div className="space-y-2">
        {list.map((m) => (
          <div key={m.id} className="grid items-end gap-3 rounded-xl bg-zinc-950/50 p-3 sm:grid-cols-[1fr_7rem_7rem_7rem]">
            <div className="min-w-0">
              <div className="text-sm font-black text-zinc-100">{m.name}</div>
              <div className="text-[11px] text-zinc-500">{m.description}</div>
              <div className="font-mono text-[10px] text-zinc-600">
                {m.id} · {m.metric}
              </div>
            </div>
            <Field ctx={ctx} path={`missions.${m.id}.target`} label="Target" step="1" />
            <Field ctx={ctx} path={`missions.${m.id}.xp`} label="XP" step="1" />
            <Toggle ctx={ctx} path={`missions.${m.id}.enabled`} label="Enabled" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AchievementsTab(ctx: Ctx) {
  const RARITIES = ["common", "rare", "epic", "legendary"] as const;
  return (
    <Panel
      title="Achievements"
      subtitle="Rarity sets the XP payout. Switching one off stops new grants — nobody loses one they already earned."
    >
      <div className="space-y-2">
        {ctx.data.catalog.achievements.map((a) => {
          const path = `achievements.${a.id}.rarity`;
          const rarity = String(ctx.read(path) ?? "common");
          const changed = path in ctx.draft;
          return (
            <div key={a.id} className="grid items-center gap-3 rounded-xl bg-zinc-950/50 p-3 sm:grid-cols-[1fr_10rem_7rem]">
              <div className="min-w-0">
                <div className="text-sm font-black text-zinc-100">{a.name}</div>
                <div className="text-[11px] text-zinc-500">{a.description}</div>
                <div className="font-mono text-[10px] text-zinc-600">{a.id}</div>
              </div>
              <select
                value={rarity}
                onChange={(e) => ctx.set(path, e.target.value)}
                className={`rounded-lg bg-zinc-900 px-2.5 py-1.5 text-sm ring-1 ${
                  changed ? "ring-amber-400/60" : "ring-white/10"
                }`}
              >
                {RARITIES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <Toggle ctx={ctx} path={`achievements.${a.id}.enabled`} label="Enabled" />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
