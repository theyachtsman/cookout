import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACHIEVEMENTS,
  COPY_DEFAULTS,
  COPY_ENTRIES,
  COPY_MAP,
  GAME_MODES,
  MISSIONS,
  copyFormat,
  copyLines,
  copyText,
  resolveCopy,
} from "@cookout/shared";
import { Store } from "./store.js";

test("the registry covers the structured content it claims to", () => {
  for (const m of GAME_MODES) {
    assert.equal(COPY_MAP[`mode.${m.key}.name`]?.defaultText, m.name);
    assert.equal(COPY_MAP[`mode.${m.key}.tagline`]?.defaultText, m.tagline);
    assert.equal(COPY_MAP[`mode.${m.key}.blurb`]?.defaultText, m.blurb);
  }
  for (const m of MISSIONS) {
    assert.equal(COPY_MAP[`mission.${m.id}.name`]?.defaultText, m.name);
    assert.equal(COPY_MAP[`mission.${m.id}.description`]?.defaultText, m.description);
  }
  for (const a of ACHIEVEMENTS) {
    assert.equal(COPY_MAP[`achievement.${a.id}.name`]?.defaultText, a.name);
    assert.equal(COPY_MAP[`achievement.${a.id}.description`]?.defaultText, a.description);
  }
});

test("keys are unique — a duplicate would silently shadow another string", () => {
  const seen = new Set<string>();
  for (const e of COPY_ENTRIES) {
    assert.equal(seen.has(e.key), false, `duplicate copy key: ${e.key}`);
    seen.add(e.key);
  }
  assert.equal(Object.keys(COPY_DEFAULTS).length, COPY_ENTRIES.length);
});

test("every entry has a non-empty default and a group", () => {
  for (const e of COPY_ENTRIES) {
    assert.ok(e.defaultText.length > 0, `${e.key} has no default`);
    assert.ok(e.group.length > 0, `${e.key} has no group`);
    assert.ok(e.label.length > 0, `${e.key} has no label`);
  }
});

test("resolve: overrides apply, unknown keys are ignored", () => {
  const resolved = resolveCopy({
    "landing.hero.headline": "Rewritten headline",
    "not.a.real.key": "should be dropped",
  });
  assert.equal(resolved["landing.hero.headline"], "Rewritten headline");
  assert.equal(resolved["not.a.real.key"], undefined, "a stale key can't leak into the site");
  // Everything untouched keeps its default.
  assert.equal(resolved["landing.fair.title"], COPY_DEFAULTS["landing.fair.title"]);
  assert.equal(Object.keys(resolved).length, COPY_ENTRIES.length);
});

test("lookup falls back to the default, then to the key", () => {
  assert.equal(copyText({}, "landing.fair.title"), COPY_DEFAULTS["landing.fair.title"]);
  assert.equal(copyText(undefined, "landing.fair.title"), COPY_DEFAULTS["landing.fair.title"]);
  assert.equal(copyText({}, "totally.unknown"), "totally.unknown", "visible rather than blank");
});

test("multiline entries split into lines, blanks dropped", () => {
  const lines = copyLines({ "landing.ticker": "one\n\n  two  \nthree" }, "landing.ticker");
  assert.deepEqual(lines, ["one", "two", "three"]);
  assert.ok(copyLines({}, "landing.ticker").length > 0, "the default ticker has lines");
});

test("placeholders are substituted, unknown ones left intact", () => {
  assert.equal(copyFormat("Follow {handle} today", { handle: "@hoodcookout" }), "Follow @hoodcookout today");
  assert.equal(copyFormat("Hello {missing}", {}), "Hello {missing}");
});

test("the store resolves copy and quests read their editable names", () => {
  const store = new Store();
  const now = Date.parse("2026-08-04T12:00:00Z");
  assert.equal(store.text("landing.hero.headline"), COPY_DEFAULTS["landing.hero.headline"]);

  const quest = store.missionDefs("daily", now)[0]!;
  store.settings.copy[`mission.${quest.id}.name`] = "Renamed Quest";
  store.settings.copy[`mission.${quest.id}.description`] = "A new description";
  const after = store.missionDefs("daily", now).find((m) => m.id === quest.id)!;
  assert.equal(after.name, "Renamed Quest");
  assert.equal(after.description, "A new description");
  // The player-facing status board shows it too.
  const status = store.missionStatus("0xaa", now).find((m) => m.id === quest.id)!;
  assert.equal(status.name, "Renamed Quest");
});

test("copy overrides survive a snapshot round-trip", () => {
  const store = new Store();
  store.settings.copy["landing.hero.headline"] = "Custom headline";
  const restored = new Store();
  restored.hydrate(JSON.parse(JSON.stringify(store.snapshot())));
  assert.equal(restored.text("landing.hero.headline"), "Custom headline");
  assert.equal(
    restored.text("landing.fair.title"),
    COPY_DEFAULTS["landing.fair.title"],
    "untouched strings still come from the defaults",
  );
});
