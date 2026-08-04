"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CARD_RARITIES,
  RARITY_MAP,
  type CardRarity,
  type CollectionCard,
  type CollectionSettings,
} from "@cookout/shared";
import { cc } from "../../lib/cc";
import { Panel } from "./CcModules";
import { AssetPicker } from "./MediaLibrary";

/**
 * The Collection Manager — cards, sets, drop odds and crate pricing.
 *
 * Two guards worth knowing about, both enforced server-side:
 *  - a card owned by players can't be deleted, only disabled, because deleting
 *    it would silently shrink their collections and move their percentage;
 *  - a rarity that has cards but no drop weight is called out, since it can
 *    never be pulled. That's a legitimate configuration but almost never the
 *    intent, and it's invisible otherwise.
 */

interface Data {
  settings: CollectionSettings;
  counts: Record<string, number>;
  totalCards: number;
  unreachableRarities: CardRarity[];
}

export function CollectionManagerModule() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<"cards" | "odds" | "sets" | "packs">("cards");
  const [editing, setEditing] = useState<CollectionCard | null>(null);
  const [q, setQ] = useState("");
  const [rarity, setRarity] = useState<CardRarity | "">("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    cc<Data>("/api/cc/collection")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError("");
    setNote("");
    try {
      await fn();
      setNote(message);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cards = useMemo(() => {
    if (!data) return [];
    const needle = q.toLowerCase();
    return Object.values(data.settings.cards)
      .filter((c) => (!rarity || c.rarity === rarity) && (!needle || `${c.cardNumber} ${c.name}`.toLowerCase().includes(needle)))
      .sort((a, b) => a.cardNumber.localeCompare(b.cardNumber))
      .slice(0, 200);
  }, [data, q, rarity]);

  if (!data) return <Panel title="Collection"><div className="text-sm text-zinc-500">Loading…</div></Panel>;
  const s = data.settings;

  return (
    <div className="space-y-4">
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {note && <div className="rounded-xl bg-lime-500/10 p-3 text-sm text-lime-300">{note}</div>}

      {data.unreachableRarities.length > 0 && (
        <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">
          <b>
            {data.unreachableRarities.map((r) => RARITY_MAP[r].label).join(", ")} can never drop.
          </b>{" "}
          Those tiers have cards but no weight in the drop table, so no crate can ever produce one.
          Give them a weight under Drop odds, or leave it if that&apos;s deliberate.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-zinc-950/95 p-2 ring-1 ring-white/10">
        {(
          [
            ["cards", `Cards (${data.totalCards})`],
            ["odds", "Drop odds"],
            ["sets", `Sets (${Object.keys(s.sets).length})`],
            ["packs", "Crate packs"],
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
        <button
          onClick={() => act(() => cc("/api/cc/collection", { method: "PATCH", body: { enabled: !s.enabled } }), s.enabled ? "Collection closed." : "Collection open.")}
          className={`ml-auto rounded-lg px-4 py-1.5 text-xs font-black ${
            s.enabled ? "bg-lime-400 text-zinc-950" : "bg-amber-400 text-zinc-950"
          }`}
        >
          {s.enabled ? "OPEN" : "CLOSED"}
        </button>
      </div>

      {tab === "cards" && (
        <Panel
          title="Cards"
          subtitle={CARD_RARITIES.map((r) => `${r.label} ${data.counts[r.key] ?? 0}`).join(" · ")}
          action={
            <div className="flex gap-2">
              <select
                value={rarity}
                onChange={(e) => setRarity(e.target.value as CardRarity | "")}
                className="rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
              >
                <option value="">All rarities</option>
                {CARD_RARITIES.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10"
              />
              <button
                onClick={() =>
                  setEditing({
                    id: "",
                    cardNumber: "",
                    name: "",
                    callsign: "",
                    rarity: "common",
                    species: "",
                    division: "",
                    role: "",
                    equipment: [],
                    traits: [],
                    biography: "",
                    lore: "",
                    description: "",
                    sets: [],
                    releaseSeason: s.season,
                    enabled: true,
                    chain: { mintStatus: "unminted", transferable: false },
                  })
                }
                className="rounded-lg bg-lime-400 px-3 py-1.5 text-xs font-black text-zinc-950 hover:bg-lime-300"
              >
                + New card
              </button>
            </div>
          }
        >
          <div className="max-h-[32rem] space-y-1 overflow-y-auto">
            {cards.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950/50 px-2 py-1.5 text-xs">
                <span className="w-24 shrink-0 font-mono text-[10px] text-zinc-500">{c.cardNumber}</span>
                <span className="min-w-0 flex-1 truncate font-bold text-zinc-100">{c.name}</span>
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase"
                  style={{ background: `${RARITY_MAP[c.rarity].color}22`, color: RARITY_MAP[c.rarity].color }}
                >
                  {RARITY_MAP[c.rarity].label}
                </span>
                {c.aiHandle && (
                  <span className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 text-[9px] font-bold text-fuchsia-300">
                    @{c.aiHandle}
                  </span>
                )}
                <span className="hidden truncate text-[10px] text-zinc-600 sm:inline">{c.division}</span>
                <button
                  onClick={() => setEditing(c)}
                  className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700"
                >
                  Edit
                </button>
                <button
                  onClick={() =>
                    act(
                      () => cc("/api/cc/collection/cards", { body: { ...c, enabled: !c.enabled } }),
                      c.enabled ? "Card disabled." : "Card enabled.",
                    )
                  }
                  className={`rounded px-2 py-0.5 text-[10px] font-black ${
                    c.enabled ? "bg-lime-400/20 text-lime-300" : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {c.enabled ? "ON" : "OFF"}
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === "odds" && (
        <Panel
          title="Drop odds"
          subtitle="Relative weights — they needn't sum to 100. Bundles never change these; every crate rolls this table."
        >
          <div className="space-y-2">
            {CARD_RARITIES.map((r) => {
              const entry = s.dropTable.find((d) => d.rarity === r.key);
              const total = s.dropTable.reduce((sum, d) => sum + d.weight, 0) || 1;
              const pct = ((entry?.weight ?? 0) / total) * 100;
              return (
                <div key={r.key} className="flex flex-wrap items-center gap-3 rounded-xl bg-zinc-950/50 p-3">
                  <span className="w-24 shrink-0 font-black" style={{ color: r.color }}>
                    {r.label}
                  </span>
                  <span className="w-16 shrink-0 text-[10px] text-zinc-600">
                    {data.counts[r.key] ?? 0} cards
                  </span>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    defaultValue={entry?.weight ?? 0}
                    onBlur={(e) => {
                      const weight = Number(e.target.value);
                      if (weight === (entry?.weight ?? 0)) return;
                      const table = CARD_RARITIES.map((x) => ({
                        rarity: x.key,
                        weight: x.key === r.key ? weight : (s.dropTable.find((d) => d.rarity === x.key)?.weight ?? 0),
                      })).filter((d) => d.weight > 0);
                      void act(
                        () => cc("/api/cc/collection", { method: "PATCH", body: { dropTable: table } }),
                        "Odds updated.",
                      );
                    }}
                    className="w-24 rounded-lg bg-zinc-900 px-2 py-1.5 font-mono text-sm outline-none ring-1 ring-white/10"
                  />
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color }} />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-xs text-zinc-400">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {tab === "sets" && (
        <Panel title="Collection sets" subtitle="Completion pays XP and BURGERS. One-time sets pay once, ever.">
          <div className="max-h-[32rem] space-y-1 overflow-y-auto">
            {Object.values(s.sets).map((set) => (
              <div key={set.id} className="grid items-center gap-2 rounded-lg bg-zinc-950/50 p-2 text-xs sm:grid-cols-[1fr_6rem_6rem_5rem_4rem]">
                <div className="min-w-0">
                  <div className="truncate font-bold text-zinc-100">{set.name}</div>
                  <div className="truncate font-mono text-[10px] text-zinc-600">
                    {set.matchRarity ?? set.matchDivision ?? set.matchSpecies ?? `${set.cardIds?.length ?? 0} cards`}
                  </div>
                </div>
                <label className="block">
                  <span className="text-[9px] uppercase text-zinc-600">XP</span>
                  <input
                    type="number"
                    defaultValue={set.xpReward}
                    onBlur={(e) =>
                      Number(e.target.value) !== set.xpReward &&
                      act(() => cc("/api/cc/collection/sets", { body: { ...set, xpReward: Number(e.target.value) } }), "Set updated.")
                    }
                    className="w-full rounded bg-zinc-900 px-1.5 py-1 font-mono text-xs ring-1 ring-white/10"
                  />
                </label>
                <label className="block">
                  <span className="text-[9px] uppercase text-zinc-600">BURGERS</span>
                  <input
                    type="number"
                    defaultValue={set.burgerReward}
                    onBlur={(e) =>
                      Number(e.target.value) !== set.burgerReward &&
                      act(() => cc("/api/cc/collection/sets", { body: { ...set, burgerReward: Number(e.target.value) } }), "Set updated.")
                    }
                    className="w-full rounded bg-zinc-900 px-1.5 py-1 font-mono text-xs ring-1 ring-white/10"
                  />
                </label>
                <button
                  onClick={() => act(() => cc("/api/cc/collection/sets", { body: { ...set, repeatable: !set.repeatable } }), "Set updated.")}
                  className={`rounded px-2 py-1 text-[10px] font-bold ${
                    set.repeatable ? "bg-sky-400/20 text-sky-300" : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {set.repeatable ? "Repeatable" : "One-time"}
                </button>
                <button
                  onClick={() => act(() => cc("/api/cc/collection/sets", { body: { ...set, enabled: !set.enabled } }), "Set updated.")}
                  className={`rounded px-2 py-1 text-[10px] font-black ${
                    set.enabled ? "bg-lime-400/20 text-lime-300" : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {set.enabled ? "ON" : "OFF"}
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {tab === "packs" && (
        <Panel title="Recruit Crate packs" subtitle="Bundles are a Burger saving only — they must never alter the odds.">
          <div className="space-y-2">
            {s.packs.map((pack, i) => (
              <div key={pack.key} className="grid items-end gap-2 rounded-xl bg-zinc-950/50 p-3 sm:grid-cols-[1fr_6rem_6rem_6rem]">
                <div className="text-sm font-black text-zinc-100">{pack.label}</div>
                {(["crates", "cost"] as const).map((field) => (
                  <label key={field} className="block">
                    <span className="text-[10px] uppercase text-zinc-600">{field}</span>
                    <input
                      type="number"
                      min={field === "crates" ? 1 : 0}
                      defaultValue={pack[field]}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value === pack[field]) return;
                        const packs = [...s.packs];
                        packs[i] = { ...pack, [field]: value };
                        void act(() => cc("/api/cc/collection", { method: "PATCH", body: { packs } }), "Packs updated.");
                      }}
                      className="w-full rounded bg-zinc-900 px-2 py-1.5 font-mono text-sm ring-1 ring-white/10"
                    />
                  </label>
                ))}
                <div className="text-[11px] text-zinc-500">
                  {(pack.cost / pack.crates).toFixed(0)} 🍔 per crate
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {editing && (
        <CardEditor
          card={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNote("Card saved.");
            load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function CardEditor({
  card,
  onClose,
  onSaved,
  onError,
}: {
  card: CollectionCard;
  onClose: () => void;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [form, setForm] = useState<CollectionCard>({ ...card });
  const set = (patch: Partial<CollectionCard>) => setForm({ ...form, ...patch });

  const field = (label: string, key: keyof CollectionCard, multiline = false) => (
    <label className="block">
      <span className="text-[11px] font-bold text-zinc-400">{label}</span>
      {multiline ? (
        <textarea
          rows={3}
          value={String(form[key] ?? "")}
          onChange={(e) => set({ [key]: e.target.value } as Partial<CollectionCard>)}
          className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10"
        />
      ) : (
        <input
          value={String(form[key] ?? "")}
          onChange={(e) => set({ [key]: e.target.value } as Partial<CollectionCard>)}
          className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10"
        />
      )}
    </label>
  );

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-4">
      <div onClick={onClose} className="fixed inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="relative my-8 w-full max-w-2xl space-y-3 rounded-2xl bg-zinc-950 p-5 ring-1 ring-white/10">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-black text-zinc-50">{card.id ? "Edit card" : "New card"}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
            ✕
          </button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {field("Name", "name")}
          {field("Callsign", "callsign")}
          {field("Card number", "cardNumber")}
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Rarity</span>
            <select
              value={form.rarity}
              onChange={(e) => set({ rarity: e.target.value as CardRarity })}
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm ring-1 ring-white/10"
            >
              {CARD_RARITIES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {field("Species", "species")}
          {field("Division", "division")}
          {field("Role", "role")}
          {field("Release season", "releaseSeason")}
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Equipment (comma separated)</span>
            <input
              value={form.equipment.join(", ")}
              onChange={(e) => set({ equipment: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-bold text-zinc-400">Traits (comma separated)</span>
            <input
              value={form.traits.join(", ")}
              onChange={(e) => set({ traits: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
              className="mt-0.5 w-full rounded-lg bg-zinc-900 px-2 py-1.5 text-sm outline-none ring-1 ring-white/10"
            />
          </label>
        </div>

        {field("Biography", "biography", true)}
        {field("Lore", "lore", true)}
        {field("Description", "description")}

        <div className="grid gap-2 sm:grid-cols-2">
          <AssetPicker
            label="Portrait"
            kind="image"
            value={form.portraitAssetId ?? ""}
            onPick={(id) => set({ portraitAssetId: id || undefined })}
          />
          <AssetPicker
            label="Dossier art"
            kind="image"
            value={form.dossierAssetId ?? ""}
            onPick={(id) => set({ dossierAssetId: id || undefined })}
          />
        </div>

        {form.aiHandle && (
          <div className="rounded-xl bg-fuchsia-500/10 p-3 text-[11px] text-fuchsia-200">
            This dossier depicts the System AI account{" "}
            <span className="font-mono font-bold">@{form.aiHandle}</span>. There is only one{" "}
            {form.name} — editing the card changes the dossier, not the character&apos;s account.
            Manage the account itself under the Flame Goon Squad module.
          </div>
        )}

        <div className="rounded-xl bg-zinc-900/60 p-3 text-[11px] text-zinc-500">
          Blockchain fields are carried but disabled during the paper beta. Mint status:{" "}
          <span className="font-mono text-zinc-400">{form.chain.mintStatus ?? "unminted"}</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() =>
              void cc("/api/cc/collection/cards", { body: form })
                .then(onSaved)
                .catch((e) => onError((e as Error).message))
            }
            className="rounded-lg bg-lime-400 px-4 py-2 text-sm font-black text-zinc-950 hover:bg-lime-300"
          >
            Save card
          </button>
          {card.id && (
            <button
              onClick={() => {
                if (!confirm(`Delete ${form.name}? Cards owned by players can't be deleted — disable them instead.`))
                  return;
                void cc(`/api/cc/collection/cards/${card.id}`, { method: "DELETE" })
                  .then(onSaved)
                  .catch((e) => onError((e as Error).message));
              }}
              className="ml-auto rounded-lg bg-red-500/15 px-4 py-2 text-sm font-black text-red-300 hover:bg-red-500/25"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
