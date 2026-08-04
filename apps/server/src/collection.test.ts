import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CARD_RARITIES,
  DEFAULT_DROP_TABLE,
  GOON_ROSTER,
  computeProgress,
  rollRarity,
  setComplete,
  type CardRarity,
} from "@cookout/shared";
import { optionalAuth } from "./auth.js";
import { CollectionError, CollectionService, freshCollectionSettings, mergeCollectionSettings } from "./collection.js";
import { Store } from "./store.js";

const A = "0x00000000000000000000000000000000000000aa";

function setup(burgers = 10_000) {
  const store = new Store();
  const svc = new CollectionService(store);
  const u = store.getOrCreateUser(A);
  u.burgerBalance = burgers;
  return { store, svc, u };
}

/** A roll sequence, so a draw is fully deterministic. */
const rolls = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

test("catalogue: named officers reference the AI account, never a copy", () => {
  const { svc } = setup();
  const officers = svc.catalogue().filter((c) => c.rarity === "legendary" || c.rarity === "epic");
  assert.ok(officers.length > 0, "the roster produced officer cards");
  for (const card of officers) {
    assert.ok(card.aiHandle, `${card.name} points at an AI handle`);
    assert.ok(card.aiAddress?.startsWith("0x900d"), "and at that account's address");
    const persona = GOON_ROSTER.find((p) => p.handle === card.aiHandle);
    assert.ok(persona, "the handle resolves to a real persona");
    assert.equal(card.name, persona!.name, "there is only one Ghost — same name, same account");
  }
  // No two cards may claim the same identity.
  const handles = officers.map((c) => c.aiHandle);
  assert.equal(new Set(handles).size, handles.length, "no duplicate identities");
});

test("catalogue is deterministic — the same roster every boot", () => {
  const a = freshCollectionSettings();
  const b = freshCollectionSettings();
  assert.deepEqual(Object.keys(a.cards).sort(), Object.keys(b.cards).sort());
  const id = Object.keys(a.cards)[0]!;
  assert.deepEqual(a.cards[id], b.cards[id], "card numbers and identities are stable");
});

test("drop table: weights are honoured and a zero-weight rarity never drops", () => {
  // The spec's defaults: 60/25/10/4/1.
  assert.equal(rollRarity(DEFAULT_DROP_TABLE, 0.0), "common");
  assert.equal(rollRarity(DEFAULT_DROP_TABLE, 0.59), "common");
  assert.equal(rollRarity(DEFAULT_DROP_TABLE, 0.61), "uncommon");
  assert.equal(rollRarity(DEFAULT_DROP_TABLE, 0.86), "rare");
  assert.equal(rollRarity(DEFAULT_DROP_TABLE, 0.96), "elite");
  assert.equal(rollRarity(DEFAULT_DROP_TABLE, 0.999), "legendary");
  // Epic carries no default weight, so it can't be rolled.
  const rolled = new Set<CardRarity | null>();
  for (let i = 0; i < 1000; i++) rolled.add(rollRarity(DEFAULT_DROP_TABLE, i / 1000));
  assert.equal(rolled.has("epic"), false, "epic is unreachable on the shipped table");
  // An empty table draws nothing rather than crashing.
  assert.equal(rollRarity([], 0.5), null);
  assert.equal(rollRarity([{ rarity: "common", weight: 0 }], 0.5), null);
});

test("opening a pack debits Burgers once and returns the right number of pulls", () => {
  const { store, svc } = setup(1000);
  const pack = store.settings.collection.packs.find((p) => p.key === "x3")!;
  const before = store.getOrCreateUser(A).burgerBalance!;

  const result = svc.openPack(A, "x3", rolls(0.5, 0.5));
  assert.equal(result.pulls.length, 3);
  assert.equal(result.burgersSpent, pack.cost);
  assert.equal(store.getOrCreateUser(A).burgerBalance, before - pack.cost);
  assert.equal(result.burgerBalance, before - pack.cost);
  assert.equal(svc.collectionOf(A).cratesOpened, 3);
});

test("a player who can't afford a pack gets nothing and is charged nothing", () => {
  const { store, svc } = setup(10);
  assert.throws(() => svc.openPack(A, "x10"), /costs .* BURGERS/);
  assert.equal(store.getOrCreateUser(A).burgerBalance, 10, "balance untouched");
  assert.equal(Object.keys(svc.collectionOf(A).owned).length, 0, "no cards handed out");
  assert.equal(svc.collectionOf(A).cratesOpened, 0);
});

test("bundles change the price, never the odds", () => {
  const { store } = setup();
  const packs = store.settings.collection.packs;
  // Per-crate cost falls with size — that's the whole point of a bundle.
  const perCrate = packs.map((p) => p.cost / p.crates);
  for (let i = 1; i < perCrate.length; i++)
    assert.ok(perCrate[i]! <= perCrate[i - 1]!, "a bigger pack is never worse value");
  // There is exactly one drop table, shared by every pack — nothing about a
  // pack can reach the odds.
  assert.equal(Array.isArray(store.settings.collection.dropTable), true);
  assert.equal(
    Object.keys(packs[0]!).some((k) => /odds|rarity|drop/i.test(k)),
    false,
    "a pack carries no odds of its own",
  );
});

test("duplicates increment quantity and are never destroyed", () => {
  const { svc } = setup();
  // A fixed roll draws the same card every time.
  const first = svc.openPack(A, "x1", rolls(0.0, 0.0));
  assert.equal(first.pulls[0]!.duplicate, false, "the first copy is a new recruit");
  const second = svc.openPack(A, "x1", rolls(0.0, 0.0));
  assert.equal(second.pulls[0]!.card.id, first.pulls[0]!.card.id);
  assert.equal(second.pulls[0]!.duplicate, true);
  assert.equal(second.pulls[0]!.quantityOwned, 2);
  assert.equal(svc.collectionOf(A).owned[first.pulls[0]!.card.id]!.quantity, 2);
});

test("progress reflects the catalogue, and an uncollected card still counts toward the total", () => {
  const { svc } = setup();
  const before = svc.progress(A);
  assert.ok(before.total > 100, "the shipped catalogue is finite and sizeable");
  assert.equal(before.collected, 0);
  assert.equal(before.percent, 0);
  assert.equal(before.missing, before.total, "everything unfound is still known to exist");

  svc.openPack(A, "x1", rolls(0.0, 0.0));
  const after = svc.progress(A);
  assert.equal(after.collected, 1);
  assert.ok(after.score > 0);
  assert.equal(after.total, before.total, "collecting doesn't change the denominator");
});

test("completing a set pays XP and Burgers exactly once", () => {
  const { store, svc } = setup();
  // Build a tiny catalogue so a set can actually be completed.
  const cards = svc.catalogue().filter((c) => c.rarity === "legendary").slice(0, 2);
  store.settings.collection.cards = Object.fromEntries(cards.map((c) => [c.id, c]));
  store.settings.collection.sets = {
    tiny: {
      id: "tiny",
      name: "Tiny Set",
      description: "",
      matchRarity: "legendary",
      xpReward: 500,
      burgerReward: 50,
      repeatable: false,
      season: "S1",
      enabled: true,
    },
  };

  const collection = svc.collectionOf(A);
  for (const c of cards)
    collection.owned[c.id] = { cardId: c.id, quantity: 1, firstAcquiredAt: 0, lastAcquiredAt: 0 };

  const xpBefore = store.getOrCreateUser(A).xp;
  const burgersBefore = store.getOrCreateUser(A).burgerBalance!;
  const paid = svc.settleSets(A);
  assert.equal(paid.length, 1);
  assert.equal(paid[0]!.xp, 500);
  assert.ok(store.getOrCreateUser(A).xp - xpBefore >= 500);
  // At least the set's own reward. The XP it grants can also cross a Burger XP
  // milestone, which legitimately pays more — so this is a floor, not equality.
  const afterFirst = store.getOrCreateUser(A).burgerBalance!;
  assert.ok(afterFirst >= burgersBefore + 50, `expected at least +50, got ${afterFirst - burgersBefore}`);

  // Settling again pays nothing — a one-time set pays once, ever.
  const again = svc.settleSets(A);
  assert.equal(again.length, 0);
  assert.equal(store.getOrCreateUser(A).burgerBalance, afterFirst, "no further payout");
});

test("a repeatable set can pay again; a one-time set can't", () => {
  const { store, svc } = setup();
  const card = svc.catalogue()[0]!;
  store.settings.collection.cards = { [card.id]: card };
  store.settings.collection.sets = {
    s: {
      id: "s",
      name: "Seasonal",
      description: "",
      cardIds: [card.id],
      xpReward: 10,
      burgerReward: 5,
      repeatable: true,
      season: "S1",
      enabled: true,
    },
  };
  svc.collectionOf(A).owned[card.id] = { cardId: card.id, quantity: 1, firstAcquiredAt: 0, lastAcquiredAt: 0 };
  assert.equal(svc.settleSets(A).length, 1);
  assert.equal(svc.settleSets(A).length, 1, "repeatable sets keep paying");
  assert.equal(svc.collectionOf(A).setsClaimed.includes("s"), false, "and are never marked claimed");
});

test("set membership: explicit ids win over match rules", () => {
  const cards = freshCollectionSettings().cards;
  const list = Object.values(cards);
  const one = list[0]!;
  const explicit = {
    id: "x",
    name: "X",
    description: "",
    cardIds: [one.id],
    matchRarity: "legendary" as CardRarity,
    xpReward: 0,
    burgerReward: 0,
    repeatable: false,
    season: "S1",
    enabled: true,
  };
  assert.equal(setComplete(explicit, list, { [one.id]: { cardId: one.id, quantity: 1, firstAcquiredAt: 0, lastAcquiredAt: 0 } }), true);
  // A set with neither ids nor rules matches nothing, rather than everything.
  const empty = { ...explicit, cardIds: undefined, matchRarity: undefined };
  assert.equal(setComplete(empty, list, {}), false);
});

test("a disabled card can't be pulled and leaves the denominator", () => {
  const { store, svc } = setup();
  const before = svc.progress(A).total;
  const first = svc.catalogue()[0]!;
  store.settings.collection.cards[first.id]!.enabled = false;
  assert.equal(svc.progress(A).total, before - 1);
  assert.equal(svc.catalogue().some((c) => c.id === first.id), false);
});

test("the Collection can be closed, and needs the Burger economy on", () => {
  const { store, svc } = setup();
  store.settings.collection.enabled = false;
  assert.throws(() => svc.openPack(A, "x1"), CollectionError);
  store.settings.collection.enabled = true;
  store.settings.burger.enabled = false;
  assert.throws(() => svc.openPack(A, "x1"), /Burger economy/);
});

test("collections and settings survive a snapshot round-trip", () => {
  const { store, svc } = setup();
  svc.openPack(A, "x1", rolls(0.0, 0.0));
  store.settings.collection.dropTable = [{ rarity: "legendary", weight: 1 }];

  const restored = new Store();
  restored.hydrate(JSON.parse(JSON.stringify(store.snapshot())));
  const owned = restored.getOrCreateUser(A).collection!.owned;
  assert.equal(Object.keys(owned).length, 1, "the recruited dossier persists");
  assert.deepEqual(restored.settings.collection.dropTable, [{ rarity: "legendary", weight: 1 }]);
  assert.ok(Object.keys(restored.settings.collection.cards).length > 100, "the catalogue survives");
});

test("merge brings in cards shipped after the snapshot without losing edits", () => {
  const stored = freshCollectionSettings();
  stored.enabled = false;
  const id = Object.keys(stored.cards)[0]!;
  stored.cards[id]!.name = "Renamed";
  delete stored.cards[Object.keys(stored.cards)[1]!];

  const merged = mergeCollectionSettings(stored);
  assert.equal(merged.enabled, false, "the operator's switch survives");
  assert.equal(merged.cards[id]!.name, "Renamed", "so does a renamed card");
  assert.equal(Object.keys(merged.cards).length, Object.keys(freshCollectionSettings().cards).length);
});

test("every rarity in the hierarchy has cards in the shipped catalogue", () => {
  const { svc } = setup();
  const cards = svc.catalogue();
  for (const r of CARD_RARITIES) {
    // Epic is the one tier the default drop table can't reach, but the cards
    // must still exist — an operator only has to give the tier a weight.
    assert.ok(
      cards.some((c) => c.rarity === r.key),
      `${r.key} has at least one card`,
    );
  }
  const progress = computeProgress(cards, [], { owned: {}, setsClaimed: [], cratesOpened: 0, burgersSpent: 0 });
  assert.equal(progress.collected, 0);
  assert.equal(progress.byRarity.legendary.total > 0, true);
});

test("optionalAuth resolves a session without rejecting anonymous callers", async () => {
  const store = new Store();
  const gate = optionalAuth(store);
  const run = (headers: Record<string, string>) =>
    new Promise<string | undefined>((resolve) => {
      const req = { headers } as unknown as Parameters<typeof gate>[0];
      gate(req, {} as never, () => resolve(req.userAddress));
    });

  // Anonymous: allowed through, no address — the catalogue is public.
  assert.equal(await run({}), undefined);
  assert.equal(await run({ authorization: "Bearer nonsense" }), undefined);

  // Signed in: the address is attached, which is what makes the crate page
  // show the caller's Burgers and roster instead of a signed-out zero.
  const token = "tok_" + store.id();
  store.sessions.set(token, { address: A, expiresAt: Date.now() + 60_000 });
  assert.equal(await run({ authorization: `Bearer ${token}` }), A);
});

test("a signed-in collection view reports the caller's Burgers and roster", () => {
  const { store, svc } = setup(750);
  // Simulates what the route does once optionalAuth has run.
  const owned = svc.collectionOf(A).owned;
  assert.equal(Object.keys(owned).length, 0);
  assert.equal(store.getOrCreateUser(A).burgerBalance, 750);

  svc.openPack(A, "x1", rolls(0.0, 0.0));
  assert.equal(Object.keys(svc.collectionOf(A).owned).length, 1);
  assert.ok((store.getOrCreateUser(A).burgerBalance ?? 0) < 750, "the crate was paid for");
  assert.ok(svc.progress(A).collected === 1);
});
