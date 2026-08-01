import assert from "node:assert/strict";
import { test } from "node:test";
import { PIT_ROOM, isGoon } from "@cookout/shared";
import { Store } from "./store.js";
import { GoonSwarm } from "./goons.js";

/** Collect chat + overlays a swarm broadcasts, for assertions. */
function harness() {
  const store = new Store();
  const chat: { room: string; text: string; from: string }[] = [];
  const overlays: { room: string; text: string }[] = [];
  const broadcast = (room: string, ev: { type: string; [k: string]: unknown }) => {
    if (ev.type === "chat") {
      const m = ev.message as { text: string; userAddress: string };
      chat.push({ room, text: m.text, from: m.userAddress });
    } else if (ev.type === "goon_overlay") {
      overlays.push({ room, text: (ev.overlay as { text: string }).text });
    }
  };
  // Make the Squad talkative + instant so the probabilistic engine reliably fires.
  const swarm = new GoonSwarm(store, broadcast as never);
  const g = store.settings.goons;
  g.chatCooldownSec = 0;
  g.namedChancePerEvent = 1;
  g.henchmanChancePerEvent = 1;
  g.humanQuietSec = 20;
  return { store, chat, overlays, swarm };
}

test("Goon registration: every persona is a real, handle-indexed account", () => {
  const { store } = harness();
  const ghost = store.goonByHandle("ghost");
  assert.ok(ghost, "ghost resolves by handle");
  assert.equal(ghost!.isAI, true);
  assert.ok(isGoon(ghost!.address), "uses a 0x900d system address");
  assert.equal(ghost!.displayName, "Ghost");
});

test("Goon reactions come from Goon accounts and land in the Pit room", () => {
  const { chat, swarm } = harness();
  // Fire a marquee winner beat many times; at max chance at least one persona speaks.
  for (let i = 0; i < 20; i++) {
    swarm.onMoment({ kind: "winner", roomId: PIT_ROOM, winner: "Alice", now: Date.now() + i });
  }
  assert.ok(chat.length > 0, "the Squad reacted");
  assert.ok(chat.every((c) => isGoon(c.from)), "only Goon accounts speak");
  assert.ok(chat.every((c) => c.room === PIT_ROOM));
});

test("Goon Pit-only guard: never speaks in a non-Pit room", () => {
  const { store, chat, swarm } = harness();
  // "global" is not a Pit round → say() must refuse.
  for (let i = 0; i < 30; i++) swarm.onMoment({ kind: "winner", roomId: "global", winner: "A", now: i });
  assert.equal(chat.length, 0, "nothing posted to a non-Pit room");
  void store;
});

test("Goon players-first: a recent human message suppresses ambient chatter", () => {
  const { store, chat, swarm } = harness();
  const now = Date.now();
  // A human just spoke in the Pit room.
  store.chat.set(PIT_ROOM, [
    { id: "h", roundId: PIT_ROOM, userAddress: "0x1111111111111111111111111111111111111111", text: "hi", at: now },
  ]);
  swarm.onMoment({ kind: "ambient", roomId: PIT_ROOM, now: now + 1000 });
  assert.equal(chat.length, 0, "ambient stays quiet right after a human speaks");
});

test("Goon cooldown: no two AI messages within the cooldown window", () => {
  const { store, chat, swarm } = harness();
  store.settings.goons.chatCooldownSec = 30;
  const now = Date.now();
  swarm.onMoment({ kind: "winner", roomId: PIT_ROOM, winner: "A", now });
  const after = chat.length;
  swarm.onMoment({ kind: "winner", roomId: PIT_ROOM, winner: "B", now: now + 5_000 });
  assert.equal(chat.length, after, "second beat inside cooldown is dropped");
});

test("Goon memory: winners accrue a streak", () => {
  const { store, swarm } = harness();
  swarm.onMoment({ kind: "winner", roomId: PIT_ROOM, winner: "Champ", now: Date.now() });
  assert.equal(store.goonMemory.streaks["Champ"], 1);
  swarm.onMoment({ kind: "winner", roomId: PIT_ROOM, winner: "Champ", now: Date.now() + 60_000 });
  assert.equal(store.goonMemory.streaks["Champ"], 2);
});
