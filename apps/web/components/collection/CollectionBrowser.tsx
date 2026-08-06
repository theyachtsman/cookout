"use client";

import { useMemo, useState } from "react";
import { CARD_RARITIES, RARITY_MAP, type CardRarity, type CollectionCard } from "@cookout/shared";
import { apiUrl } from "../../lib/api";
import { MintRecruit } from "./MintRecruit";

/**
 * The collection browser and dossier viewer.
 *
 * Cards you don't own still appear, as silhouettes carrying only their
 * catalogue number and rarity. That's deliberate: a collection is only a goal
 * if you can see the shape of what's missing.
 */

export interface BrowserCard extends Partial<CollectionCard> {
  id: string;
  cardNumber: string;
  rarity: CardRarity;
  sets: string[];
  owned: boolean;
  quantity?: number;
  acquiredAt?: number;
}

type SortKey = "number" | "rarity" | "recent" | "name";

const RARITY_ORDER: Record<CardRarity, number> = {
  legendary: 0,
  epic: 1,
  elite: 2,
  rare: 3,
  uncommon: 4,
  common: 5,
};

export function CollectionBrowser({
  cards,
  emptyNote,
}: {
  cards: BrowserCard[];
  emptyNote?: string;
}) {
  const [q, setQ] = useState("");
  const [rarity, setRarity] = useState<CardRarity | "">("");
  const [division, setDivision] = useState("");
  const [species, setSpecies] = useState("");
  const [show, setShow] = useState<"all" | "owned" | "missing" | "duplicates">("all");
  const [sort, setSort] = useState<SortKey>("number");
  const [open, setOpen] = useState<BrowserCard | null>(null);

  const divisions = useMemo(
    () => [...new Set(cards.map((c) => c.division).filter(Boolean))].sort() as string[],
    [cards],
  );
  const speciesList = useMemo(
    () => [...new Set(cards.map((c) => c.species).filter(Boolean))].sort() as string[],
    [cards],
  );

  const visible = useMemo(() => {
    const needle = q.toLowerCase();
    const filtered = cards.filter((c) => {
      if (rarity && c.rarity !== rarity) return false;
      if (division && c.division !== division) return false;
      if (species && c.species !== species) return false;
      if (show === "owned" && !c.owned) return false;
      if (show === "missing" && c.owned) return false;
      if (show === "duplicates" && (c.quantity ?? 0) < 2) return false;
      if (!needle) return true;
      // An unowned card can only be searched by what it reveals.
      return `${c.cardNumber} ${c.name ?? ""} ${c.callsign ?? ""} ${c.division ?? ""} ${c.species ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
    return filtered.sort((a, b) => {
      if (sort === "rarity") return RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity];
      if (sort === "recent") return (b.acquiredAt ?? 0) - (a.acquiredAt ?? 0);
      if (sort === "name") return (a.name ?? a.cardNumber).localeCompare(b.name ?? b.cardNumber);
      return a.cardNumber.localeCompare(b.cardNumber);
    });
  }, [cards, q, rarity, division, species, show, sort]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, number, callsign…"
          className="min-w-[12rem] flex-1 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs outline-none ring-1 ring-white/10 focus:ring-lime-400/40"
        />
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
        {divisions.length > 0 && (
          <select
            value={division}
            onChange={(e) => setDivision(e.target.value)}
            className="rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
          >
            <option value="">All divisions</option>
            {divisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        {speciesList.length > 0 && (
          <select
            value={species}
            onChange={(e) => setSpecies(e.target.value)}
            className="rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
          >
            <option value="">All species</option>
            {speciesList.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-lg bg-zinc-900 px-2 py-1.5 text-xs ring-1 ring-white/10"
        >
          <option value="number">Card number</option>
          <option value="rarity">Rarity</option>
          <option value="recent">Recently acquired</option>
          <option value="name">Name</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-1">
        {(
          [
            ["all", "All"],
            ["owned", "Collected"],
            ["missing", "Missing"],
            ["duplicates", "Duplicates"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setShow(k)}
            className={`rounded-full px-3 py-1 text-[11px] font-black transition ${
              show === k ? "bg-lime-400 text-zinc-950" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center text-[11px] text-zinc-600">{visible.length} shown</span>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
          {emptyNote ?? "Nothing matches those filters."}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {visible.map((c) => (
            <CardTile key={c.id} card={c} onOpen={() => c.owned && setOpen(c)} />
          ))}
        </div>
      )}

      {open && <DossierViewer card={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * Where a card's artwork comes from.
 *
 * A bound NFT's own image wins over the Media Library asset: once a card
 * points at a real token, that token's art is the truth, and showing anything
 * else would put a picture on the dossier the player's NFT does not have.
 * ipfs:// is rewritten to a gateway, because browsers cannot fetch it.
 */
function cardArt(card: { portraitAssetId?: string; dossierAssetId?: string; chain?: { imageUrl?: string } }, prefer: "portrait" | "dossier" = "portrait"): string | null {
  const nft = card.chain?.imageUrl;
  if (nft) return nft.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${nft.slice(7)}` : nft;
  const asset = prefer === "dossier" ? (card.dossierAssetId ?? card.portraitAssetId) : card.portraitAssetId;
  return asset ? `${apiUrl()}/media/${asset}` : null;
}

function CardTile({ card, onOpen }: { card: BrowserCard; onOpen: () => void }) {
  const rarity = RARITY_MAP[card.rarity];
  if (!card.owned)
    // The silhouette: you know it exists and roughly what it's worth. Nothing else.
    return (
      <div
        className="flex aspect-[3/4] flex-col items-center justify-center rounded-xl bg-zinc-900/40 p-2 text-center ring-1 ring-white/5"
        title="Not yet recruited"
      >
        <div className="text-3xl opacity-20 grayscale">🕵️</div>
        <div className="mt-1 font-mono text-[10px] text-zinc-600">{card.cardNumber}</div>
        <div
          className="mt-1 rounded px-1.5 py-0.5 text-[9px] font-black uppercase opacity-50"
          style={{ background: `${rarity.color}18`, color: rarity.color }}
        >
          {rarity.label}
        </div>
        <div className="mt-1 text-[9px] uppercase tracking-wide text-zinc-700">Unknown</div>
      </div>
    );

  return (
    <button
      onClick={onOpen}
      className="group flex aspect-[3/4] flex-col overflow-hidden rounded-xl bg-zinc-950 p-2 text-left ring-1 transition hover:-translate-y-0.5"
      style={{ borderColor: rarity.color, boxShadow: `inset 0 0 0 2px ${rarity.color}55` }}
    >
      <div className="flex-1 overflow-hidden rounded-lg bg-zinc-900/60">
        {cardArt(card) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cardArt(card)!}
            alt={card.name ?? ""}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl">🔥</div>
        )}
      </div>
      <div className="mt-1 min-w-0">
        <div className="truncate text-[11px] font-black text-zinc-100">{card.name}</div>
        <div className="flex items-center gap-1">
          <span className="truncate font-mono text-[9px] text-zinc-600">{card.cardNumber}</span>
          {(card.quantity ?? 1) > 1 && (
            <span className="ml-auto rounded bg-zinc-800 px-1 text-[9px] font-bold text-zinc-400">
              ×{card.quantity}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/** The full dossier: a classified personnel file. */
export function DossierViewer({ card, onClose }: { card: BrowserCard; onClose: () => void }) {
  const rarity = RARITY_MAP[card.rarity];
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto p-4">
      <div onClick={onClose} className="fixed inset-0 bg-black/80 backdrop-blur-sm" />
      <div
        className="relative my-8 w-full max-w-md rounded-2xl bg-zinc-950 p-1"
        style={{ border: `2px solid ${rarity.color}`, boxShadow: `0 0 60px -12px ${rarity.color}` }}
      >
        <div className="rounded-xl bg-zinc-900/60 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">
                Flame Goon Squad · Personnel File
              </div>
              <div className="truncate text-xl font-black text-zinc-50">{card.name}</div>
              <div className="font-mono text-[11px] text-zinc-500">
                {card.cardNumber} · {card.callsign}
              </div>
            </div>
            <button onClick={onClose} className="shrink-0 text-zinc-500 hover:text-zinc-200">
              ✕
            </button>
          </div>

          <div
            className="mt-3 aspect-video overflow-hidden rounded-lg bg-zinc-950/60"
            onClick={() => setFlipped((f) => !f)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && setFlipped((f) => !f)}
          >
            {flipped ? (
              <div className="h-full overflow-y-auto p-3 text-xs leading-snug text-zinc-400">
                {card.lore || "No further records."}
              </div>
            ) : cardArt(card, "dossier") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cardArt(card, "dossier")!}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-5xl">🔥</div>
            )}
          </div>
          <div className="mt-1 text-center text-[10px] text-zinc-700">
            {flipped ? "Click to return to the photo" : "Click to read the file"}
          </div>

          {/* Only on a recruit they actually have — minting is the second step
              after the pull, never a substitute for it. */}
          {card.owned && (
            <div className="mt-3">
              <MintRecruit
                cardId={card.id}
                cardName={card.name ?? card.cardNumber}
                quantity={card.quantity ?? 1}
              />
            </div>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            {[
              ["Species", card.species],
              ["Division", card.division],
              ["Role", card.role],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-zinc-950/60 p-2">
                <div className="text-[9px] uppercase text-zinc-600">{k}</div>
                <div className="truncate font-bold text-zinc-200">{v || "—"}</div>
              </div>
            ))}
          </div>

          {(card.equipment?.length || card.traits?.length) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {card.equipment?.map((e) => (
                <span key={e} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                  {e}
                </span>
              ))}
              {card.traits?.map((t) => (
                <span key={t} className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {t}
                </span>
              ))}
            </div>
          )}

          {card.biography && <p className="mt-3 text-xs leading-snug text-zinc-400">{card.biography}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2 text-[10px]">
            <span
              className="rounded px-1.5 py-0.5 font-black uppercase"
              style={{ background: `${rarity.color}22`, color: rarity.color }}
            >
              {rarity.label}
            </span>
            {(card.quantity ?? 1) > 1 && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-bold text-zinc-400">
                ×{card.quantity} owned
              </span>
            )}
            {card.releaseSeason && <span className="text-zinc-600">Season {card.releaseSeason}</span>}
            {/* The ownership layer, waiting on mainnet. */}
            <span className="ml-auto text-zinc-700" title="Blockchain minting is disabled during the paper beta">
              {card.chain?.mintStatus === "minted" ? `Token #${card.chain.tokenId}` : "Unminted · paper beta"}
            </span>
          </div>

          {card.aiHandle && (
            <a
              href={`/profile/${card.aiHandle}`}
              className="mt-3 block rounded-lg bg-zinc-800/60 px-2 py-1.5 text-center text-[11px] font-bold text-lime-300 hover:bg-zinc-800"
            >
              View {card.name}&apos;s profile →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
