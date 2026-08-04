import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TELEGRAM_EVENTS,
  freshTelegramSettings,
  isDue,
  mergeTelegramSettings,
  nextDue,
  renderTemplate,
  type ScheduledPost,
} from "@cookout/shared";
import { COMMANDS } from "./telegram/commands.js";
import { Store, TELEGRAM_COMMAND_DEFS } from "./store.js";

const base = (over: Partial<ScheduledPost> = {}): ScheduledPost => ({
  id: "p1",
  name: "Daily reminder",
  text: "hello",
  topic: "announcements",
  cadence: "daily",
  hourUtc: 12,
  minuteUtc: 0,
  enabled: true,
  createdAt: 0,
  ...over,
});

/** 2026-08-04 is a Tuesday (weekday 2). */
const NOON = Date.parse("2026-08-04T12:00:00Z");
const MORNING = Date.parse("2026-08-04T09:00:00Z");

test("the store's command seed matches the bot's real command list", () => {
  // The store can't import the bot without a cycle, so the list is duplicated.
  // If they drift, a new command silently has no Command Center row.
  assert.deepEqual(
    TELEGRAM_COMMAND_DEFS.map((c) => c.command).sort(),
    COMMANDS.map((c) => c.command).sort(),
  );
});

test("defaults: every event has a row and starts enabled", () => {
  const s = freshTelegramSettings(TELEGRAM_COMMAND_DEFS);
  for (const e of TELEGRAM_EVENTS) {
    assert.ok(s.events[e.key], `${e.key} has a settings row`);
    assert.equal(s.events[e.key]!.enabled, true);
    assert.equal(s.events[e.key]!.template, "", "blank template = the bot's built-in copy");
  }
  assert.equal(s.enabled, true);
  assert.equal(Object.keys(s.commands).length, TELEGRAM_COMMAND_DEFS.length);
});

test("merge fills in events added since the snapshot, keeping edits", () => {
  const stored = freshTelegramSettings(TELEGRAM_COMMAND_DEFS);
  stored.groupChatId = "-100123";
  stored.events.live!.enabled = false;
  delete (stored.events as Record<string, unknown>).burnt;

  const merged = mergeTelegramSettings(stored, TELEGRAM_COMMAND_DEFS);
  assert.equal(merged.groupChatId, "-100123", "the operator's edit survives");
  assert.equal(merged.events.live!.enabled, false, "so does a disabled event");
  assert.ok(merged.events.burnt, "a newly-shipped event appears at its default");
  assert.equal(merged.events.burnt!.enabled, true);
});

test("daily posts fire once, then wait for tomorrow", () => {
  const post = base({ hourUtc: 12, minuteUtc: 0 });
  // Before the window: due later today.
  assert.equal(nextDue(post, MORNING), NOON);
  assert.equal(isDue(post, MORNING), false);
  // At the window: due now.
  assert.equal(isDue(post, NOON), true);
  // Once sent, the next one is tomorrow — a restart can't double-post.
  post.lastSentAt = NOON;
  assert.equal(isDue(post, NOON + 1000), false);
  assert.equal(nextDue(post, NOON + 1000), NOON + 86_400_000);
});

test("a missed window doesn't fire a backlog", () => {
  // Sent yesterday; the process was down through today's window.
  const post = base({ hourUtc: 12, lastSentAt: NOON - 86_400_000 });
  const wellPastToday = NOON + 6 * 3_600_000;
  const due = nextDue(post, wellPastToday)!;
  assert.ok(due > wellPastToday, "it waits for the next window rather than firing late");
});

test("weekly posts land on their weekday", () => {
  // Target Friday (5) from a Tuesday.
  const post = base({ cadence: "weekly", weekday: 5, hourUtc: 12 });
  const due = nextDue(post, NOON)!;
  assert.equal(new Date(due).getUTCDay(), 5);
  assert.equal(new Date(due).getUTCHours(), 12);
  assert.ok(due > NOON);
  // Targeting today, before the hour, fires today.
  const today = base({ cadence: "weekly", weekday: 2, hourUtc: 12 });
  assert.equal(nextDue(today, MORNING), NOON);
});

test("monthly posts respect the day, capped at 28", () => {
  const post = base({ cadence: "monthly", dayOfMonth: 1, hourUtc: 12 });
  const due = nextDue(post, NOON)!;
  assert.equal(new Date(due).getUTCDate(), 1);
  assert.ok(due > NOON, "the 1st has passed, so it rolls to next month");
  assert.equal(new Date(due).getUTCMonth(), new Date(NOON).getUTCMonth() + 1);
});

test("one-off posts fire once and never again", () => {
  const post = base({ cadence: "once", runAt: NOON });
  assert.equal(isDue(post, NOON), true);
  post.lastSentAt = NOON;
  assert.equal(nextDue(post, NOON + 1000), null, "a fired one-off is finished");
  // A one-off with no time set never fires.
  assert.equal(nextDue(base({ cadence: "once" }), NOON), null);
});

test("a disabled post never fires", () => {
  assert.equal(nextDue(base({ enabled: false }), NOON), null);
  assert.equal(isDue(base({ enabled: false }), NOON), false);
});

test("templates substitute known placeholders and keep unknown ones visible", () => {
  assert.equal(
    renderTemplate("{coin} is live — pot is {jackpot}", { coin: "$WAGYU", jackpot: "$1,200" }),
    "$WAGYU is live — pot is $1,200",
  );
  assert.equal(renderTemplate("Hello {nope}", {}), "Hello {nope}", "a typo stays visible");
});

test("event gating: the master switch and the per-event toggle both apply", () => {
  const store = new Store();
  assert.equal(store.telegramEventEnabled("live"), true);
  store.settings.telegram.events.live!.enabled = false;
  assert.equal(store.telegramEventEnabled("live"), false);
  assert.equal(store.telegramEventEnabled("burnt"), true, "other events are unaffected");
  store.settings.telegram.events.live!.enabled = true;
  store.settings.telegram.enabled = false;
  assert.equal(store.telegramEventEnabled("live"), false, "the master switch silences everything");
});

test("the delivery log records outcomes and stays bounded", () => {
  const store = new Store();
  store.logTelegram({ kind: "sent", target: "trading", source: "live", text: "hi" });
  store.logTelegram({ kind: "failed", target: "trading", source: "live", error: "chat not found" });
  assert.equal(store.telegramLog.length, 2);
  assert.equal(store.telegramLog.at(-1)!.error, "chat not found");
  for (let i = 0; i < 1200; i++) store.logTelegram({ kind: "sent", target: "t" });
  assert.equal(store.telegramLog.length, 1000);
});

test("telegram settings and log survive a snapshot round-trip", () => {
  const store = new Store();
  store.settings.telegram.groupChatId = "-100999";
  store.settings.telegram.events.live!.enabled = false;
  store.settings.telegram.scheduled.push(base({ id: "s1", name: "Weekly jackpot" }));
  store.logTelegram({ kind: "sent", target: "general" });

  const restored = new Store();
  restored.hydrate(JSON.parse(JSON.stringify(store.snapshot())));
  assert.equal(restored.settings.telegram.groupChatId, "-100999");
  assert.equal(restored.settings.telegram.events.live!.enabled, false);
  assert.equal(restored.settings.telegram.scheduled.length, 1);
  assert.equal(restored.telegramLog.length, 1);
});
