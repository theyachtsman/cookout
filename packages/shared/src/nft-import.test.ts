import assert from "node:assert/strict";
import { test } from "node:test";
import { planNftImport, type CollectionCard, type NftManifestEntry } from "./collection.js";

const card = (id: string, name: string, cardNumber: string, tokenId?: string) =>
  ({ id, name, cardNumber, chain: tokenId ? { tokenId } : {} }) as CollectionCard;

const cards = [
  card("a", "Ghost", "FGS-L-001"),
  card("b", "Blaze", "FGS-L-002"),
  card("c", "Ash", "FGS-E-001"),
];

test("matches on name, case and spacing insensitively", () => {
  const plan = planNftImport(
    [{ tokenId: 7, name: "  ghost  ", image: "ipfs://x" }],
    cards,
    { matchBy: "name" },
  );
  assert.equal(plan.matched.length, 1);
  assert.deepEqual(
    { cardId: plan.matched[0]!.cardId, tokenId: plan.matched[0]!.tokenId },
    { cardId: "a", tokenId: "7" },
  );
  assert.equal(plan.matched[0]!.imageUrl, "ipfs://x");
});

test("order matching pairs by position, for generated collections", () => {
  const plan = planNftImport(
    [{ tokenId: 1 }, { tokenId: 2 }, { tokenId: 3 }, { tokenId: 4 }],
    cards,
    { matchBy: "order" },
  );
  assert.deepEqual(plan.matched.map((m) => m.cardId), ["a", "b", "c"]);
  // The fourth has no card, and says so rather than being dropped.
  assert.equal(plan.unmatched.length, 1);
  assert.match(plan.unmatched[0]!.reason, /more tokens than cards/);
});

test("says when a card is being moved to a different token", () => {
  // Silently rebinding puts different artwork on a dossier players already
  // own; the operator knows which token is which and this does not.
  const bound = [card("a", "Ghost", "FGS-L-001", "11")];
  const plan = planNftImport([{ tokenId: 22, name: "Ghost" }], bound, { matchBy: "name" });
  assert.equal(plan.matched[0]!.rebind, "11");

  // Re-importing the same pairing is not a rebind.
  const same = planNftImport([{ tokenId: 11, name: "Ghost" }], bound, { matchBy: "name" });
  assert.equal(same.matched[0]!.rebind, undefined);
});

test("refuses to point two tokens at one card", () => {
  const plan = planNftImport(
    [{ tokenId: 1, name: "Ghost" }, { tokenId: 2, name: "GHOST" }],
    cards,
    { matchBy: "name" },
  );
  assert.equal(plan.matched.length, 1, "the first wins");
  assert.match(plan.unmatched[0]!.reason, /already claimed/);
});

test("reports entries it cannot place, and cards left unbound", () => {
  const plan = planNftImport(
    [{ tokenId: 1, name: "Ghost" }, { tokenId: 2, name: "Nobody" }, { tokenId: "", name: "X" }],
    cards,
    { matchBy: "name" },
  );
  assert.equal(plan.matched.length, 1);
  assert.deepEqual(
    plan.unmatched.map((u) => u.reason),
    ['no card matches "Nobody"', "no tokenId"],
  );
  // Two cards got nothing — worth knowing before the crate can drop them.
  assert.deepEqual(plan.unboundCards.map((c) => c.cardId), ["b", "c"]);
});

test("matches on catalogue number when names differ from the mint", () => {
  const plan = planNftImport([{ tokenId: 9, name: "FGS-E-001" }], cards, { matchBy: "cardNumber" });
  assert.equal(plan.matched[0]!.cardId, "c");
});
