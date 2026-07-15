import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MISSIONS, unlockedCosmetics } from "@cookout/shared";
import { FilePersistence } from "./persistence.js";
import { Store } from "./store.js";

const A = "0x00000000000000000000000000000000000000aa";

test("missions: activity tracking completes missions and awards XP once", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  const now = Date.UTC(2026, 6, 14, 12);

  const before = u.xp;
  store.trackActivity(A, "predictions", 1, now);
  const d = MISSIONS.find((m) => m.id === "d_predict_1")!;
  assert.equal(u.xp, before + d.xp, "daily prediction mission completed");

  // Same period: no double award.
  store.trackActivity(A, "predictions", 1, now + 1000);
  assert.equal(u.xp, before + d.xp);

  // Next day: daily resets, weekly still counting.
  const nextDay = now + 26 * 3600 * 1000;
  store.trackActivity(A, "predictions", 1, nextDay);
  assert.equal(u.xp, before + 2 * d.xp, "new day, mission completes again");

  const status = store.missionStatus(A, nextDay);
  const weekly = status.find((m) => m.id === "w_predict_5")!;
  assert.equal(weekly.progress, 3, "weekly counts across days");
  assert.equal(weekly.completed, false);

  store.trackActivity(A, "predictions", 2, nextDay + 1000);
  const w = MISSIONS.find((m) => m.id === "w_predict_5")!;
  assert.equal(u.xp, before + 2 * d.xp + w.xp, "weekly challenge completed");
});

test("cosmetics: unlocks by level and achievement, equip validated shape", () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  assert.equal(unlockedCosmetics(u).length, 0, "level 1, nothing unlocked");
  u.level = 20;
  const byLevel = unlockedCosmetics(u).map((c) => c.id);
  assert.ok(byLevel.includes("b_flame") && byLevel.includes("c_emerald"));
  assert.ok(!byLevel.includes("b_diamond"));
  u.achievements.push("diamond_hands");
  assert.ok(unlockedCosmetics(u).some((c) => c.id === "b_diamond"));
});

test("snapshot → hydrate roundtrip via FilePersistence", async () => {
  const store = new Store();
  const u = store.getOrCreateUser(A);
  u.displayName = "roundtrip";
  store.addXp(A, 500);
  store.trackActivity(A, "trades", 7);
  u.equipped.badge = "b_flame";
  const concept = {
    id: store.id(),
    creatorAddress: A,
    name: "Persist",
    symbol: "SAVE",
    theme: "durability",
    status: "submitted" as const,
    votes: 3,
    createdAt: 1,
  };
  store.concepts.set(concept.id, concept);
  store.conceptVoters.set(concept.id, new Set([A]));
  store.logAdmin("test", "entry");

  const file = join(mkdtempSync(join(tmpdir(), "cookout-")), "state.json");
  const p = new FilePersistence(file);
  await p.save(store.snapshot());

  const store2 = new Store();
  const loaded = await new FilePersistence(file).load();
  assert.ok(loaded);
  store2.hydrate(loaded);
  const u2 = store2.getOrCreateUser(A);
  assert.equal(u2.displayName, "roundtrip");
  assert.equal(u2.xp, u.xp);
  assert.equal(u2.equipped.badge, "b_flame");
  assert.equal(store2.concepts.get(concept.id)!.symbol, "SAVE");
  assert.ok(store2.conceptVoters.get(concept.id)!.has(A));
  assert.equal(store2.adminLog.length, 1);
  const status = store2.missionStatus(A);
  assert.equal(status.find((m) => m.id === "d_trade_10")!.progress, 7, "activity survives restart");
});
