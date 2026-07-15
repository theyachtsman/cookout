import { VOTE_THRESHOLD, VOTING_WINDOW_MS } from "@cookout/shared";
import type { RoundEngine } from "./engine.js";
import type { Store } from "./store.js";

/**
 * Community voting lifecycle (runs every tick): a submission that reaches
 * the vote threshold is auto-shortlisted for the Arena Committee; one whose
 * voting window closes below the threshold is rejected. Both transitions
 * are written to the public audit log.
 */
export function evaluateVoting(store: Store, now = Date.now()): void {
  for (const c of store.concepts.values()) {
    if (c.status !== "submitted") continue;
    if (c.votes >= VOTE_THRESHOLD) {
      c.status = "shortlisted";
      store.logAdmin("auto_shortlist", `concept ${c.id} (${c.symbol}) hit ${VOTE_THRESHOLD} votes`);
    } else if (now - c.createdAt > VOTING_WINDOW_MS) {
      c.status = "rejected";
      store.logAdmin(
        "vote_expired",
        `concept ${c.id} (${c.symbol}) closed at ${c.votes}/${VOTE_THRESHOLD} votes`,
      );
    }
  }
}

/**
 * Demo seeding for local development: a few community submissions and a
 * continuously self-refilling match calendar so there is always a round to
 * pull up to. Disable with SEED=0.
 */
export function seedDemo(store: Store, engine: RoundEngine): void {
  const creator = store.getOrCreateUser("0x00000000000000000000000000000000c0ffee01");
  creator.displayName = "hood_chef";
  const creator2 = store.getOrCreateUser("0x00000000000000000000000000000000c0ffee02");
  creator2.displayName = "midnight_dev";

  const concepts = [
    { name: "Block Party", symbol: "BLOCK", theme: "Neighborhood summer classic", who: creator },
    { name: "Night Shift", symbol: "SHIFT", theme: "For the 3am chart watchers", who: creator2 },
    { name: "Corner Store", symbol: "CORNER", theme: "Everything a dollar, until it isn't", who: creator },
  ];
  for (const c of concepts) {
    const concept = {
      id: store.id(),
      creatorAddress: c.who.address,
      name: c.name,
      symbol: c.symbol,
      theme: c.theme,
      status: "submitted" as const,
      votes: Math.floor(Math.random() * 20),
      createdAt: Date.now(),
    };
    store.concepts.set(concept.id, concept);
  }
}

/**
 * Keeps the calendar alive in demo mode: whenever no round is scheduled or
 * running, promote the top-voted submission and schedule it shortly.
 */
export function autoScheduler(store: Store, engine: RoundEngine): void {
  const active = [...store.rounds.values()].some((r) =>
    ["scheduled", "lobby", "queue_open", "settling", "live", "ended"].includes(r.state),
  );
  if (active) return;
  const next = [...store.concepts.values()]
    .filter((c) => c.status === "submitted" || c.status === "shortlisted")
    .sort((a, b) => b.votes - a.votes)[0];
  if (!next) return;
  next.status = "shortlisted";
  const round = engine.scheduleRound(next, "rookie", Date.now() + 15_000);
  store.logAdmin("auto_schedule", `round ${round.id} (${next.symbol}) via demo auto-scheduler`);
}
