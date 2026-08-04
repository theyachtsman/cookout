"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BURGER_REVENUE_DESTS,
  PIT_DURATIONS,
  type BurgerAnalytics,
  type BurgerSettings,
  type PitBonusType,
} from "@cookout/shared";
import { cc, type CcSession } from "../../lib/cc";
import { Panel } from "./CcModules";

/**
 * Economy — the BURGERS currency and the Pit's money.
 *
 * Every number here is live: the settings object is what the running engine
 * reads, so a change applies to the next award or the next Pit match rather
 * than the next deploy. Nothing is destructive, and the two genuinely
 * dangerous controls (manual grants, revenue split) are called out as such.
 */

interface PitSettingsShape {
  tradingFee: number;
  pitFeeBps: number;
  feeSplit: { platform: number; jackpot: number; creator: number; treasury: number };
  startingStack: number;
  lobbySeconds: number;
  queueMaxSeconds: number;
  maxConcurrent: number;
  carryover: boolean;
  aggression: number;
  difficulty: number;
  durations: string[];
  minBet: number;
  maxBet: number;
  mainAllocationBps: number;
  houseAllocationBps: number;
  doubleDownBonus: number;
  doubleDownType: PitBonusType;
  trialRequiredPnlBps: number;
  trialMinUsd: number;
  trialMaxUsd: number;
  trialLobbySeconds: number;
}

interface Overview {
  settings: { burger?: BurgerSettings; pit?: PitSettingsShape };
}

const n = (v: number, dp = 0) =>
  v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

function NumberRow({
  label,
  value,
  hint,
  step = "any",
  onSave,
}: {
  label: string;
  value: number;
  hint?: string;
  step?: string;
  onSave: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold text-zinc-300">{label}</span>
      <input
        type="number"
        step={step}
        defaultValue={value}
        onBlur={(e) => Number(e.target.value) !== value && onSave(Number(e.target.value))}
        className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2.5 py-1.5 font-mono text-sm outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
      />
      {hint && <span className="mt-0.5 block text-[10px] leading-snug text-zinc-600">{hint}</span>}
    </label>
  );
}

export function EconomyModule({ session }: { session: CcSession }) {
  const [burger, setBurger] = useState<BurgerSettings | null>(null);
  const [pit, setPit] = useState<PitSettingsShape | null>(null);
  const [analytics, setAnalytics] = useState<BurgerAnalytics | null>(null);
  const [tab, setTab] = useState<"burgers" | "pit" | "grants">("burgers");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    cc<Overview>("/api/admin/overview")
      .then((d) => {
        setBurger(d.settings.burger ?? null);
        setPit(d.settings.pit ?? null);
      })
      .catch((e) => setError((e as Error).message));
    cc<{ analytics: BurgerAnalytics }>("/api/admin/burger/analytics")
      .then((d) => setAnalytics(d.analytics))
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  const save = async (patch: Record<string, unknown>, message = "Saved.") => {
    setError("");
    setNote("");
    try {
      await cc("/api/admin/settings", { body: patch });
      setNote(message);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const saveBurger = (patch: Partial<BurgerSettings>) =>
    burger && save({ burger: { ...burger, ...patch } });
  const savePit = (patch: Partial<PitSettingsShape>) => pit && save({ pit: { ...pit, ...patch } });

  const canGrant = session.permissions.includes("users.economy");

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-zinc-950/95 p-2 ring-1 ring-white/10">
        {(
          [
            ["burgers", "🍔 BURGERS"],
            ["pit", "🕳️ Pit economy"],
            ["grants", "Manual grants"],
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
      </div>

      {tab === "burgers" && burger && (
        <>
          {analytics && (
            <Panel title="Economy health" subtitle="Circulating supply against what's been earned and bought">
              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  ["Circulating", n(analytics.circulating), "text-orange-300"],
                  ["Holders", n(analytics.holders), "text-zinc-100"],
                  ["Avg per player", n(analytics.avgPerPlayer, 1), "text-zinc-100"],
                  ["Earned/day", n(analytics.avgEarnedPerDay, 1), "text-lime-300"],
                  ["Total earned", n(analytics.totalEarned), "text-zinc-100"],
                  ["Total purchased", n(analytics.totalPurchased), "text-zinc-100"],
                  ["Total spent", n(analytics.totalSpent), "text-zinc-100"],
                  [
                    "Sink ratio",
                    analytics.sinkRatio ? `${(analytics.sinkRatio * 100).toFixed(0)}%` : "—",
                    "text-amber-300",
                  ],
                ].map(([label, value, tone]) => (
                  <div key={label as string} className="rounded-xl bg-zinc-950/60 p-3">
                    <div className="text-[10px] uppercase text-zinc-500">{label}</div>
                    <div className={`font-mono text-lg font-black ${tone}`}>{value}</div>
                  </div>
                ))}
              </div>
              {analytics.topEarners.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-[11px] font-bold text-zinc-400">Top earners</div>
                  <div className="space-y-1">
                    {analytics.topEarners.slice(0, 5).map((e) => (
                      <div key={e.address} className="flex items-center gap-2 rounded bg-zinc-950/50 px-2 py-1 text-xs">
                        <span className="min-w-0 flex-1 truncate text-zinc-300">
                          {e.displayName ?? `${e.address.slice(0, 10)}…`}
                        </span>
                        <span className="font-mono font-black text-orange-300">{n(e.earned)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          )}

          <Panel
            title="Currency"
            subtitle="Switching BURGERS off stops all awards immediately; balances are untouched"
            action={
              <button
                onClick={() => saveBurger({ enabled: !burger.enabled })}
                className={`rounded-lg px-4 py-1.5 text-xs font-black ${
                  burger.enabled ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {burger.enabled ? "ON" : "OFF"}
              </button>
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberRow
                label="BURGERS per pETH purchased"
                value={burger.burgersPerEth}
                hint="Minted per 1 pETH of Cook Out balance spent"
                onSave={(v) => saveBurger({ burgersPerEth: v })}
              />
            </div>
          </Panel>

          <Panel title="Reward rules" subtitle="What each action pays, and how often it can pay it">
            <div className="space-y-2">
              {burger.rules.map((rule, i) => (
                <div key={rule.source} className="grid items-end gap-2 rounded-xl bg-zinc-950/50 p-3 sm:grid-cols-[1fr_6rem_7rem_6rem]">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-zinc-100">{rule.label}</div>
                    <div className="font-mono text-[10px] text-zinc-600">{rule.source}</div>
                  </div>
                  <NumberRow
                    label="Amount"
                    value={rule.amount}
                    onSave={(v) => {
                      const rules = [...burger.rules];
                      rules[i] = { ...rule, amount: v };
                      saveBurger({ rules });
                    }}
                  />
                  <NumberRow
                    label="Cooldown (s)"
                    value={rule.cooldownSec}
                    step="1"
                    onSave={(v) => {
                      const rules = [...burger.rules];
                      rules[i] = { ...rule, cooldownSec: v };
                      saveBurger({ rules });
                    }}
                  />
                  <button
                    onClick={() => {
                      const rules = [...burger.rules];
                      rules[i] = { ...rule, enabled: !rule.enabled };
                      saveBurger({ rules });
                    }}
                    className={`rounded-lg px-3 py-1.5 text-xs font-black ${
                      rule.enabled ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {rule.enabled ? "ON" : "OFF"}
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="XP milestones" subtitle="One-off BURGERS for reaching a level">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {burger.xpMilestones.map((m, i) => (
                <div key={m.level} className="rounded-xl bg-zinc-950/50 p-2">
                  <NumberRow
                    label={`Level ${m.level}`}
                    value={m.amount}
                    onSave={(v) => {
                      const xpMilestones = [...burger.xpMilestones];
                      xpMilestones[i] = { ...m, amount: v };
                      saveBurger({ xpMilestones });
                    }}
                  />
                  <button
                    onClick={() => {
                      const xpMilestones = [...burger.xpMilestones];
                      xpMilestones[i] = { ...m, enabled: !m.enabled };
                      saveBurger({ xpMilestones });
                    }}
                    className={`mt-1 w-full rounded px-2 py-1 text-[10px] font-black ${
                      m.enabled ? "bg-lime-400/20 text-lime-300" : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {m.enabled ? "ON" : "OFF"}
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="One-time milestones" subtitle="First match, first launch, first graduation…">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {burger.oneTimeMilestones.map((m, i) => (
                <div key={m.id} className="rounded-xl bg-zinc-950/50 p-2">
                  <NumberRow
                    label={m.label}
                    value={m.amount}
                    onSave={(v) => {
                      const oneTimeMilestones = [...burger.oneTimeMilestones];
                      oneTimeMilestones[i] = { ...m, amount: v };
                      saveBurger({ oneTimeMilestones });
                    }}
                  />
                  <button
                    onClick={() => {
                      const oneTimeMilestones = [...burger.oneTimeMilestones];
                      oneTimeMilestones[i] = { ...m, enabled: !m.enabled };
                      saveBurger({ oneTimeMilestones });
                    }}
                    className={`mt-1 w-full rounded px-2 py-1 text-[10px] font-black ${
                      m.enabled ? "bg-lime-400/20 text-lime-300" : "bg-zinc-800 text-zinc-500"
                    }`}
                  >
                    {m.enabled ? "ON" : "OFF"}
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Purchase revenue split"
            subtitle="Where money spent on BURGERS goes. Fractions are normalised on use, so they needn't sum to exactly 1."
          >
            <div className="grid gap-3 sm:grid-cols-5">
              {BURGER_REVENUE_DESTS.map((dest) => (
                <NumberRow
                  key={dest.key}
                  label={dest.label}
                  value={burger.revenueAllocation[dest.key] ?? 0}
                  step="0.05"
                  onSave={(v) =>
                    saveBurger({ revenueAllocation: { ...burger.revenueAllocation, [dest.key]: v } })
                  }
                />
              ))}
            </div>
          </Panel>
        </>
      )}

      {tab === "pit" && pit && (
        <>
          <Panel title="Pit fees & pools">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <NumberRow label="Trading buy-in (pETH)" value={pit.tradingFee} onSave={(v) => savePit({ tradingFee: v })} />
              <NumberRow
                label="Pit fee (bps)"
                value={pit.pitFeeBps}
                step="1"
                hint="Skimmed off the pools at settlement"
                onSave={(v) => savePit({ pitFeeBps: v })}
              />
              <NumberRow label="Starting stack (pETH)" value={pit.startingStack} onSave={(v) => savePit({ startingStack: v })} />
              <NumberRow label="Max concurrent matches" value={pit.maxConcurrent} step="1" onSave={(v) => savePit({ maxConcurrent: v })} />
              <NumberRow label="Lobby countdown (s)" value={pit.lobbySeconds} step="1" onSave={(v) => savePit({ lobbySeconds: v })} />
              <NumberRow label="Queue window (s)" value={pit.queueMaxSeconds} step="1" onSave={(v) => savePit({ queueMaxSeconds: v })} />
            </div>
          </Panel>

          <Panel title="Fee split" subtitle="How the Pit fee is routed (fractions summing to 1)">
            <div className="grid gap-3 sm:grid-cols-4">
              {(["platform", "jackpot", "creator", "treasury"] as const).map((k) => (
                <NumberRow
                  key={k}
                  label={k}
                  value={pit.feeSplit[k]}
                  step="0.05"
                  onSave={(v) => savePit({ feeSplit: { ...pit.feeSplit, [k]: v } })}
                />
              ))}
            </div>
          </Panel>

          <Panel title="Prediction market">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <NumberRow label="Min bet (pETH)" value={pit.minBet} onSave={(v) => savePit({ minBet: v })} />
              <NumberRow label="Max bet (pETH)" value={pit.maxBet} onSave={(v) => savePit({ maxBet: v })} />
              <NumberRow
                label="Main pool (bps)"
                value={pit.mainAllocationBps}
                step="1"
                onSave={(v) => savePit({ mainAllocationBps: v })}
              />
              <NumberRow
                label="House Special (bps)"
                value={pit.houseAllocationBps}
                step="1"
                onSave={(v) => savePit({ houseAllocationBps: v })}
              />
              <NumberRow
                label="Double Down bonus"
                value={pit.doubleDownBonus}
                step="0.05"
                onSave={(v) => savePit({ doubleDownBonus: v })}
              />
            </div>
          </Panel>

          <Panel title="Flame Trial">
            <div className="grid gap-3 sm:grid-cols-4">
              <NumberRow
                label="Required PnL (bps)"
                value={pit.trialRequiredPnlBps}
                step="1"
                onSave={(v) => savePit({ trialRequiredPnlBps: v })}
              />
              <NumberRow label="Min stake (USD)" value={pit.trialMinUsd} onSave={(v) => savePit({ trialMinUsd: v })} />
              <NumberRow label="Max stake (USD)" value={pit.trialMaxUsd} onSave={(v) => savePit({ trialMaxUsd: v })} />
              <NumberRow
                label="Solo countdown (s)"
                value={pit.trialLobbySeconds}
                step="1"
                onSave={(v) => savePit({ trialLobbySeconds: v })}
              />
            </div>
          </Panel>

          <Panel title="Swarm AI" subtitle="How the Goon Squad's market behaves, 0–1">
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberRow
                label="Aggression"
                value={pit.aggression}
                step="0.05"
                hint="Trade size and cadence"
                onSave={(v) => savePit({ aggression: v })}
              />
              <NumberRow
                label="Difficulty"
                value={pit.difficulty}
                step="0.05"
                hint="Biases the market story against traders"
                onSave={(v) => savePit({ difficulty: v })}
              />
              <div>
                <span className="text-[11px] font-bold text-zinc-300">Durations offered</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {PIT_DURATIONS.map((d) => {
                    const on = pit.durations.includes(d.key);
                    return (
                      <button
                        key={d.key}
                        onClick={() =>
                          savePit({
                            durations: on
                              ? pit.durations.filter((x) => x !== d.key)
                              : [...pit.durations, d.key],
                          })
                        }
                        className={`rounded px-2 py-1 text-[11px] font-bold ${
                          on ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {d.icon} {d.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Panel>
        </>
      )}

      {tab === "grants" && (
        <Panel
          title="Manual BURGERS grant"
          subtitle="Goes straight onto a player's balance and is recorded in the audit log with your reason"
        >
          {!canGrant ? (
            <div className="rounded-xl bg-zinc-950/50 p-4 text-sm text-zinc-400">
              Granting balances needs the <span className="font-mono">users.economy</span> permission,
              which your role doesn&apos;t hold.
            </div>
          ) : (
            <GrantForm onDone={(m) => setNote(m)} onError={setError} />
          )}
        </Panel>
      )}
    </div>
  );
}

function GrantForm({ onDone, onError }: { onDone: (m: string) => void; onError: (m: string) => void }) {
  const [form, setForm] = useState({ address: "", amount: "", reason: "" });
  return (
    <div className="grid gap-2 sm:max-w-lg">
      <input
        value={form.address}
        onChange={(e) => setForm({ ...form, address: e.target.value })}
        placeholder="0x… player address"
        className="rounded-lg bg-zinc-900 px-3 py-2 font-mono text-sm outline-none ring-1 ring-white/10"
      />
      <input
        value={form.amount}
        onChange={(e) => setForm({ ...form, amount: e.target.value })}
        placeholder="Amount (negative to deduct)"
        className="rounded-lg bg-zinc-900 px-3 py-2 font-mono text-sm outline-none ring-1 ring-white/10"
      />
      <input
        value={form.reason}
        onChange={(e) => setForm({ ...form, reason: e.target.value })}
        placeholder="Reason (required)"
        className="rounded-lg bg-zinc-900 px-3 py-2 text-sm outline-none ring-1 ring-white/10"
      />
      <button
        onClick={() => {
          if (!form.address || !form.amount || !form.reason) {
            onError("Address, amount and reason are all required.");
            return;
          }
          void cc(`/api/cc/players/${form.address.trim().toLowerCase()}/adjust`, {
            body: { burgers: Number(form.amount), reason: form.reason },
          })
            .then(() => {
              onDone(`Granted ${form.amount} BURGERS.`);
              setForm({ address: "", amount: "", reason: "" });
            })
            .catch((e) => onError((e as Error).message));
        }}
        className="w-fit rounded-lg bg-lime-400 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
      >
        Apply grant
      </button>
    </div>
  );
}
