/**
 * The Collection service: catalogue, crates, pulls and set rewards.
 *
 * All collection logic lives here, never on the client. The frontend asks
 * "open a crate" and this decides what came out — which is what makes the
 * cinematic safe to skip and what will let Robinhood Chain minting slot in
 * behind the same call later.
 *
 * The catalogue is finite and deterministic on purpose. "Collection %" and the
 * silhouettes for cards you haven't found only mean something if there is a
 * knowable set of cards; generating a fresh operative on every pull would make
 * both meaningless.
 */
import {
  DEFAULT_DROP_TABLE,
  DEFAULT_PACKS,
  DEFAULT_POOLS,
  GOON_ROSTER,
  cardNumber,
  cardsInSet,
  computeProgress,
  freshPlayerCollection,
  hash01,
  rollRarity,
  setComplete,
  type CardRarity,
  type CollectionCard,
  type CollectionSet,
  type CollectionSettings,
  type CratePull,
  type CrateResult,
  type Address,
} from "@cookout/shared";
import { adminAdjustBurgers } from "./burger.js";
import type { Store } from "./store.js";

export class CollectionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** How many procedural operatives the default catalogue contains. */
const HENCHMAN_COUNT = 120;
const ELITE_COUNT = 40;

/**
 * Build the shipped catalogue.
 *
 * Legendary and Epic cards are seeded from the live Goon Squad roster, so each
 * one references the AI account that already exists rather than inventing a
 * parallel identity. Elite and Henchman cards are generated deterministically
 * from the identity pools — the same seed always yields the same roster, so
 * card numbers stay stable across restarts and redeploys.
 */
export function freshCollectionSettings(): CollectionSettings {
  const cards: Record<string, CollectionCard> = {};
  const pools = { ...DEFAULT_POOLS };
  const season = "S1";

  const pick = <T,>(list: T[], seed: string): T => list[Math.floor(hash01(seed) * list.length) % list.length]!;
  const pickSome = <T,>(list: T[], seed: string, n: number): T[] => {
    const out: T[] = [];
    for (let i = 0; i < n; i++) {
      const v = pick(list, `${seed}:${i}`);
      if (!out.includes(v)) out.push(v);
    }
    return out;
  };

  // ---- named officers, from the AI roster ----
  let legendaryIndex = 0;
  let epicIndex = 0;
  for (const persona of GOON_ROSTER) {
    // Only the named tiers become collectible officers; the rest of the roster
    // stays as chat personalities.
    if (persona.rarity !== "legendary" && persona.rarity !== "epic") continue;
    const rarity: CardRarity = persona.rarity === "legendary" ? "legendary" : "epic";
    const index = rarity === "legendary" ? ++legendaryIndex : ++epicIndex;
    const id = `card_${persona.handle}`;
    cards[id] = {
      id,
      cardNumber: cardNumber(rarity, index),
      name: persona.name,
      callsign: persona.handle.toUpperCase(),
      rarity,
      species: pick(pools.species, `sp:${persona.handle}`),
      division: pick(pools.divisions, `dv:${persona.handle}`),
      role: rarity === "legendary" ? "Command" : "Officer",
      equipment: pickSome(pools.equipment, `eq:${persona.handle}`, 2),
      traits: pickSome(pools.traits, `tr:${persona.handle}`, 3),
      biography: persona.bio,
      lore: persona.catchphrase ?? "",
      description: persona.speechStyle,
      sets: ["set_original", rarity === "legendary" ? "set_founders" : "set_officers"],
      releaseSeason: season,
      enabled: true,
      // The link that keeps identity singular: this dossier depicts that account.
      aiHandle: persona.handle,
      aiAddress: persona.address,
      chain: { mintStatus: "unminted", transferable: false },
    };
  }

  // ---- procedural elites ----
  for (let i = 1; i <= ELITE_COUNT; i++) {
    const seed = `elite:${i}`;
    const species = pick(pools.species, `sp:${seed}`);
    const division = pick(pools.divisions, `dv:${seed}`);
    const role = pick(pools.roles, `rl:${seed}`);
    const id = `card_elite_${i}`;
    cards[id] = {
      id,
      cardNumber: cardNumber("elite", i),
      name: `${species} ${role}`,
      callsign: `${species.slice(0, 2).toUpperCase()}-${String(i).padStart(3, "0")}`,
      rarity: "elite",
      species,
      division,
      role,
      equipment: pickSome(pools.equipment, `eq:${seed}`, 2),
      traits: pickSome(pools.traits, `tr:${seed}`, 2),
      biography: `A vetted ${role.toLowerCase()} out of ${division}. Cleared for independent work.`,
      lore: `Came up through the ${division.toLowerCase()} and never asked to be moved.`,
      description: `${species} operative, ${division}.`,
      sets: ["set_elites", `set_div_${division.replace(/\s+/g, "_").toLowerCase()}`],
      releaseSeason: season,
      enabled: true,
      chain: { mintStatus: "unminted", transferable: false },
    };
  }

  // ---- procedural henchmen, split across the three common tiers ----
  for (let i = 1; i <= HENCHMAN_COUNT; i++) {
    const seed = `hench:${i}`;
    const r = hash01(`rar:${seed}`);
    const rarity: CardRarity = r < 0.6 ? "common" : r < 0.87 ? "uncommon" : "rare";
    const species = pick(pools.species, `sp:${seed}`);
    const division = pick(pools.divisions, `dv:${seed}`);
    const role = pick(pools.roles, `rl:${seed}`);
    const unit = `FGS-H-${String(800 + i)}`;
    const id = `card_hench_${i}`;
    cards[id] = {
      id,
      cardNumber: unit,
      // Henchmen aren't individually named — the unit number is the identity.
      name: unit,
      callsign: unit,
      rarity,
      species,
      division,
      role,
      equipment: pickSome(pools.equipment, `eq:${seed}`, 1),
      traits: pickSome(pools.traits, `tr:${seed}`, 2),
      biography: `Unnamed recruit. ${species} ${role.toLowerCase()} attached to ${division}.`,
      lore: "No file. No history. Shows up, does the work.",
      description: `${species} · ${role} · ${division}`,
      sets: [`set_div_${division.replace(/\s+/g, "_").toLowerCase()}`, `set_species_${species.toLowerCase()}`],
      releaseSeason: season,
      enabled: true,
      chain: { mintStatus: "unminted", transferable: false },
    };
  }

  // ---- sets ----
  const sets: Record<string, CollectionSet> = {};
  const addSet = (s: CollectionSet) => (sets[s.id] = s);
  addSet({
    id: "set_founders",
    name: "Founders",
    description: "Every Legendary member of the Flame Goon Squad.",
    matchRarity: "legendary",
    xpReward: 1000,
    burgerReward: 250,
    repeatable: false,
    season,
    enabled: true,
  });
  addSet({
    id: "set_officers",
    name: "The Officers",
    description: "Every named Epic officer.",
    matchRarity: "epic",
    xpReward: 600,
    burgerReward: 150,
    repeatable: false,
    season,
    enabled: true,
  });
  addSet({
    id: "set_elites",
    name: "Elite Operatives",
    description: "Every Elite operative in the roster.",
    matchRarity: "elite",
    xpReward: 400,
    burgerReward: 100,
    repeatable: false,
    season,
    enabled: true,
  });
  for (const division of DEFAULT_POOLS.divisions)
    addSet({
      id: `set_div_${division.replace(/\s+/g, "_").toLowerCase()}`,
      name: division,
      description: `Every recruit attached to ${division}.`,
      matchDivision: division,
      xpReward: 300,
      burgerReward: 40,
      repeatable: false,
      season,
      enabled: true,
    });
  for (const species of DEFAULT_POOLS.species)
    addSet({
      id: `set_species_${species.toLowerCase()}`,
      name: `${species} Set`,
      description: `Every ${species} in the Squad.`,
      matchSpecies: species,
      xpReward: 200,
      burgerReward: 25,
      repeatable: false,
      season,
      enabled: true,
    });

  return {
    enabled: true,
    cards,
    sets,
    dropTable: DEFAULT_DROP_TABLE.map((e) => ({ ...e })),
    packs: DEFAULT_PACKS.map((p) => ({ ...p })),
    pools,
    season,
  };
}

/** Fill in anything a stored settings object is missing. */
export function mergeCollectionSettings(
  stored: Partial<CollectionSettings> | undefined,
): CollectionSettings {
  const fresh = freshCollectionSettings();
  if (!stored) return fresh;
  return {
    ...fresh,
    ...stored,
    // Cards and sets shipped since the snapshot appear; operator edits survive.
    cards: { ...fresh.cards, ...(stored.cards ?? {}) },
    sets: { ...fresh.sets, ...(stored.sets ?? {}) },
    dropTable: stored.dropTable?.length ? stored.dropTable : fresh.dropTable,
    packs: stored.packs?.length ? stored.packs : fresh.packs,
    pools: { ...fresh.pools, ...(stored.pools ?? {}) },
  };
}

export class CollectionService {
  constructor(private store: Store) {}

  private get settings(): CollectionSettings {
    return this.store.settings.collection;
  }

  /** Every live card, catalogue order. */
  catalogue(): CollectionCard[] {
    return Object.values(this.settings.cards)
      .filter((c) => c.enabled)
      .sort((a, b) => a.cardNumber.localeCompare(b.cardNumber));
  }

  sets(): CollectionSet[] {
    return Object.values(this.settings.sets).filter((s) => s.enabled);
  }

  /** A player's collection, created on first read. */
  collectionOf(address: Address) {
    const u = this.store.getOrCreateUser(address);
    return (u.collection ??= freshPlayerCollection());
  }

  progress(address: Address) {
    return computeProgress(this.catalogue(), this.sets(), this.collectionOf(address));
  }

  /**
   * Buy and open a pack. Burgers are debited first: if the player can't afford
   * it, nothing is drawn and nothing is spent. Bundles change the price and
   * nothing else — the odds are read from the same table however many crates
   * are in the pack.
   */
  openPack(address: Address, packKey: string, roll: () => number = Math.random): CrateResult {
    if (!this.settings.enabled) throw new CollectionError(403, "the Collection is currently closed");
    const pack = this.settings.packs.find((p) => p.key === packKey);
    if (!pack) throw new CollectionError(404, "no such Recruit Crate pack");
    if (!this.store.settings.burger.enabled)
      throw new CollectionError(403, "the Burger economy is switched off");

    const user = this.store.getOrCreateUser(address);
    const balance = user.burgerBalance ?? 0;
    if (balance < pack.cost)
      throw new CollectionError(
        400,
        `that pack costs ${pack.cost} BURGERS — you have ${Math.floor(balance)}`,
      );

    const catalogue = this.catalogue();
    if (catalogue.length === 0) throw new CollectionError(503, "the catalogue is empty");

    // Charge before drawing, so a failure mid-draw can't hand out free cards.
    adminAdjustBurgers(this.store, address, -pack.cost, `Recruit Crate ${pack.label}`);
    const collection = this.collectionOf(address);
    collection.burgersSpent += pack.cost;

    const pulls: CratePull[] = [];
    for (let i = 0; i < pack.crates; i++) {
      pulls.push(this.drawOne(address, catalogue, roll));
      collection.cratesOpened++;
    }

    const completedSets = this.settleSets(address);
    return {
      pulls,
      burgersSpent: pack.cost,
      burgerBalance: this.store.getOrCreateUser(address).burgerBalance ?? 0,
      completedSets,
      progress: this.progress(address),
    };
  }

  /** Draw one card and record it. */
  private drawOne(address: Address, catalogue: CollectionCard[], roll: () => number): CratePull {
    const rarity = rollRarity(this.settings.dropTable, roll());
    // Fall back only when a rarity has weight but no cards — otherwise a
    // misconfigured table would hand out nothing at all.
    let pool = rarity ? catalogue.filter((c) => c.rarity === rarity) : [];
    if (pool.length === 0) pool = catalogue;

    const card = pool[Math.floor(roll() * pool.length) % pool.length]!;
    const collection = this.collectionOf(address);
    const existing = collection.owned[card.id];
    const now = Date.now();
    if (existing) {
      existing.quantity++;
      existing.lastAcquiredAt = now;
    } else {
      collection.owned[card.id] = {
        cardId: card.id,
        quantity: 1,
        firstAcquiredAt: now,
        lastAcquiredAt: now,
      };
    }
    return {
      card,
      duplicate: !!existing,
      quantityOwned: collection.owned[card.id]!.quantity,
    };
  }

  /**
   * Pay out any set the player has just completed. One-time sets are recorded
   * as claimed so they never pay twice; repeatable sets are left unclaimed so a
   * seasonal re-run can pay again.
   */
  settleSets(address: Address): { set: CollectionSet; xp: number; burgers: number }[] {
    const collection = this.collectionOf(address);
    const catalogue = this.catalogue();
    const paid: { set: CollectionSet; xp: number; burgers: number }[] = [];

    for (const set of this.sets()) {
      if (!set.repeatable && collection.setsClaimed.includes(set.id)) continue;
      if (!setComplete(set, catalogue, collection.owned)) continue;
      if (!set.repeatable) collection.setsClaimed.push(set.id);
      if (set.xpReward > 0) this.store.addXp(address, set.xpReward, "ceiling", "collection");
      if (set.burgerReward > 0)
        adminAdjustBurgers(this.store, address, set.burgerReward, `Set complete: ${set.name}`);
      paid.push({ set, xp: set.xpReward, burgers: set.burgerReward });
      this.store.pushActivity(address, "achievement", `completed the ${set.name} collection`);
    }
    return paid;
  }

  /** Set membership + completion for a player, for the Collection tab. */
  setProgress(address: Address) {
    const collection = this.collectionOf(address);
    const catalogue = this.catalogue();
    return this.sets().map((set) => {
      const members = cardsInSet(set, catalogue);
      const owned = members.filter((c) => collection.owned[c.id]).length;
      return {
        set,
        total: members.length,
        owned,
        complete: members.length > 0 && owned === members.length,
        claimed: collection.setsClaimed.includes(set.id),
      };
    });
  }
}
