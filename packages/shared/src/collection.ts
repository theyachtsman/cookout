/**
 * The Flame Goon Squad Collection — recruits, crates, sets and progression.
 *
 * This is a collectible *progression* system, not an NFT drop. The Squad
 * already exists in The Cookout: Ghost, Reaper and the rest are live AI
 * accounts with profiles, and a Legendary card is a dossier *for that account*,
 * not a second identity. Recruiting Ghost adds Ghost's dossier to your roster.
 *
 * Everything is data-driven. Cards live in settings and are edited from the
 * Command Center; the frontend never decides what you pulled. Blockchain fields
 * are carried on every card and left empty through the paper beta, so enabling
 * Robinhood Chain minting later is a matter of filling them in rather than
 * reshaping the system.
 */

/**
 * Rarity doubles as the collection hierarchy.
 *  common / uncommon / rare — Henchmen, procedural, unnamed;
 *  elite                    — procedurally assembled named operatives;
 *  epic                     — named officers, backed by an AI account;
 *  legendary                — unique characters, backed by an AI account.
 */
export type CardRarity = "common" | "uncommon" | "rare" | "elite" | "epic" | "legendary";

export const CARD_RARITIES: {
  key: CardRarity;
  label: string;
  /** Dossier border colour, as the spec's reveal calls for. */
  color: string;
  tier: "henchman" | "elite" | "officer";
}[] = [
  { key: "common", label: "Common", color: "#a1a1aa", tier: "henchman" },
  { key: "uncommon", label: "Uncommon", color: "#4ade80", tier: "henchman" },
  { key: "rare", label: "Rare", color: "#60a5fa", tier: "henchman" },
  { key: "elite", label: "Elite", color: "#c084fc", tier: "elite" },
  { key: "epic", label: "Epic", color: "#fb923c", tier: "officer" },
  { key: "legendary", label: "Legendary", color: "#fbbf24", tier: "officer" },
];

export const RARITY_MAP: Record<CardRarity, (typeof CARD_RARITIES)[number]> = Object.fromEntries(
  CARD_RARITIES.map((r) => [r.key, r]),
) as Record<CardRarity, (typeof CARD_RARITIES)[number]>;

/** Blockchain fields, carried from day one and unused through the paper beta. */
export interface CardChainInfo {
  contractAddress?: string;
  tokenId?: string;
  metadataUri?: string;
  mintStatus?: "unminted" | "pending" | "minted";
  owner?: string;
  transferable?: boolean;
}

export interface CollectionCard {
  id: string;
  /** Human-facing catalogue number, e.g. "FGS-L-001" or "FGS-H-842". */
  cardNumber: string;
  name: string;
  callsign: string;
  rarity: CardRarity;
  species: string;
  division: string;
  role: string;
  equipment: string[];
  traits: string[];
  biography: string;
  lore: string;
  description: string;
  /** Media Library asset ids. Empty = the generated placeholder is used. */
  portraitAssetId?: string;
  dossierAssetId?: string;
  /** Sets this card counts toward. A card may belong to several. */
  sets: string[];
  releaseSeason: string;
  /** Disabled cards never drop and are hidden from the catalogue. */
  enabled: boolean;
  /**
   * The System AI account this dossier depicts, for Legendary and Epic. There
   * is only one Ghost: the card points at that account rather than copying it.
   */
  aiHandle?: string;
  aiAddress?: string;
  chain: CardChainInfo;
}

export interface CollectionSet {
  id: string;
  name: string;
  description: string;
  /** Explicit card ids, or a rule that selects them. */
  cardIds?: string[];
  matchRarity?: CardRarity;
  matchSpecies?: string;
  matchDivision?: string;
  matchRole?: string;
  /** Completion rewards. */
  xpReward: number;
  burgerReward: number;
  /** Seasonal sets can be re-run; one-time sets pay once, ever. */
  repeatable: boolean;
  season: string;
  enabled: boolean;
}

/** One line of the configurable rarity table. */
export interface DropTableEntry {
  rarity: CardRarity;
  /** Relative weight. The spec's defaults read as percentages. */
  weight: number;
}

/** A crate bundle. Savings only — bundles must never change the odds. */
export interface CratePack {
  key: string;
  label: string;
  crates: number;
  /** Burger cost for the whole pack. */
  cost: number;
}

export interface CollectionSettings {
  enabled: boolean;
  /** The card catalogue, keyed by id. */
  cards: Record<string, CollectionCard>;
  sets: Record<string, CollectionSet>;
  dropTable: DropTableEntry[];
  packs: CratePack[];
  /** Identity pools the procedural generator draws from. */
  pools: {
    species: string[];
    divisions: string[];
    roles: string[];
    equipment: string[];
    traits: string[];
  };
  /** Current season label, stamped onto new cards. */
  season: string;
}

/** One card a player owns, with how many they've pulled. */
export interface OwnedCard {
  cardId: string;
  quantity: number;
  firstAcquiredAt: number;
  lastAcquiredAt: number;
}

/** A player's collection, stored on their account. */
export interface PlayerCollection {
  owned: Record<string, OwnedCard>;
  /** Set ids already paid out, so a one-time reward pays once. */
  setsClaimed: string[];
  cratesOpened: number;
  burgersSpent: number;
}

export function freshPlayerCollection(): PlayerCollection {
  return { owned: {}, setsClaimed: [], cratesOpened: 0, burgersSpent: 0 };
}

/** What a single crate opening produced. */
export interface CratePull {
  card: CollectionCard;
  /** False when this is the first copy — drives the "NEW RECRUIT" moment. */
  duplicate: boolean;
  quantityOwned: number;
}

/** The result of opening one pack, including anything it completed. */
export interface CrateResult {
  pulls: CratePull[];
  burgersSpent: number;
  burgerBalance: number;
  completedSets: { set: CollectionSet; xp: number; burgers: number }[];
  progress: CollectionProgress;
}

export interface CollectionProgress {
  total: number;
  collected: number;
  missing: number;
  percent: number;
  /** Weighted score: rarer cards are worth more. */
  score: number;
  byRarity: Record<CardRarity, { total: number; collected: number }>;
  duplicates: number;
  setsCompleted: number;
  setsTotal: number;
}

/** Collection score weighting per rarity — what a card is "worth". */
export const RARITY_SCORE: Record<CardRarity, number> = {
  common: 1,
  uncommon: 3,
  rare: 8,
  elite: 25,
  epic: 60,
  legendary: 150,
};

// ------------------------------------------------------------ default config

/**
 * The spec's opening odds. Note that Epic carries no weight here — the drop
 * table in the brief lists Common/Uncommon/Rare Henchman, Elite and Legendary
 * only. Epic cards therefore can't drop until an operator gives the tier a
 * weight, which the Command Center warns about rather than silently papering
 * over.
 */
export const DEFAULT_DROP_TABLE: DropTableEntry[] = [
  { rarity: "common", weight: 60 },
  { rarity: "uncommon", weight: 25 },
  { rarity: "rare", weight: 10 },
  { rarity: "elite", weight: 4 },
  { rarity: "legendary", weight: 1 },
];

/** Bundles give a Burger saving and nothing else. */
export const DEFAULT_PACKS: CratePack[] = [
  { key: "x1", label: "Recruit Crate", crates: 1, cost: 100 },
  { key: "x3", label: "Recruit Crate ×3", crates: 3, cost: 285 },
  { key: "x5", label: "Recruit Crate ×5", crates: 5, cost: 460 },
  { key: "x10", label: "Recruit Crate ×10", crates: 10, cost: 880 },
];

export const DEFAULT_POOLS = {
  species: ["Rat", "Wolf", "Crow", "Snake", "Hound", "Roach", "Moth", "Toad", "Boar", "Gator"],
  divisions: [
    "Sewer Division",
    "Predator Division",
    "Inferno Division",
    "Recon Division",
    "Support Division",
    "Grill Division",
  ],
  roles: ["Runner", "Lookout", "Enforcer", "Fixer", "Scout", "Torch", "Quartermaster", "Cutter"],
  equipment: [
    "Gas Mask",
    "Crowbar",
    "Burner Phone",
    "Zippo",
    "Bolt Cutters",
    "Night Optics",
    "Flare Gun",
    "Ledger",
    "Kevlar Apron",
    "Scanner",
  ],
  traits: [
    "Paranoid",
    "Loyal",
    "Twitchy",
    "Patient",
    "Reckless",
    "Quiet",
    "Greedy",
    "Superstitious",
    "Methodical",
    "Hot-headed",
  ],
};

// ---------------------------------------------------------------- helpers

/** Does a card belong to a set? Explicit ids first, then the match rules. */
export function cardInSet(card: CollectionCard, set: CollectionSet): boolean {
  if (set.cardIds?.length) return set.cardIds.includes(card.id);
  if (set.matchRarity && card.rarity !== set.matchRarity) return false;
  if (set.matchSpecies && card.species !== set.matchSpecies) return false;
  if (set.matchDivision && card.division !== set.matchDivision) return false;
  if (set.matchRole && card.role !== set.matchRole) return false;
  // A set with no rules and no ids would match everything; treat it as empty.
  return !!(set.matchRarity || set.matchSpecies || set.matchDivision || set.matchRole);
}

/** Every card in a set, from the live catalogue. */
export function cardsInSet(set: CollectionSet, cards: CollectionCard[]): CollectionCard[] {
  return cards.filter((c) => c.enabled && cardInSet(c, set));
}

/** Is a set fully owned? */
export function setComplete(
  set: CollectionSet,
  cards: CollectionCard[],
  owned: Record<string, OwnedCard>,
): boolean {
  const members = cardsInSet(set, cards);
  return members.length > 0 && members.every((c) => owned[c.id]);
}

/** Compute a player's progress against the live catalogue. */
export function computeProgress(
  cards: CollectionCard[],
  sets: CollectionSet[],
  collection: PlayerCollection,
): CollectionProgress {
  const live = cards.filter((c) => c.enabled);
  const byRarity = Object.fromEntries(
    CARD_RARITIES.map((r) => [r.key, { total: 0, collected: 0 }]),
  ) as CollectionProgress["byRarity"];

  let collected = 0;
  let score = 0;
  let duplicates = 0;
  for (const card of live) {
    byRarity[card.rarity].total++;
    const own = collection.owned[card.id];
    if (own) {
      collected++;
      byRarity[card.rarity].collected++;
      score += RARITY_SCORE[card.rarity];
      duplicates += Math.max(0, own.quantity - 1);
    }
  }

  const liveSets = sets.filter((s) => s.enabled);
  return {
    total: live.length,
    collected,
    missing: live.length - collected,
    percent: live.length ? Math.round((collected / live.length) * 1000) / 10 : 0,
    score,
    byRarity,
    duplicates,
    setsCompleted: liveSets.filter((s) => setComplete(s, live, collection.owned)).length,
    setsTotal: liveSets.length,
  };
}

/**
 * Pick a rarity from the drop table. Weights are relative, so a table that
 * doesn't sum to 100 still behaves sensibly. `roll` is injectable so the pull
 * can be tested deterministically.
 */
export function rollRarity(table: DropTableEntry[], roll = Math.random()): CardRarity | null {
  const usable = table.filter((e) => e.weight > 0);
  const total = usable.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return null;
  let x = roll * total;
  for (const entry of usable) {
    x -= entry.weight;
    if (x < 0) return entry.rarity;
  }
  return usable.at(-1)!.rarity;
}

/** A stable, readable catalogue number. */
export function cardNumber(rarity: CardRarity, index: number): string {
  const tier = RARITY_MAP[rarity].tier;
  const letter = tier === "officer" ? (rarity === "legendary" ? "L" : "E") : tier === "elite" ? "X" : "H";
  return `FGS-${letter}-${String(index).padStart(3, "0")}`;
}

/** Deterministic 0..1 hash, so a generated roster is stable across restarts. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100_000) / 100_000;
}
