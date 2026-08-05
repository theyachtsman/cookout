import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

/**
 * Every registered copy key must actually be read by something.
 *
 * This guards the failure mode that produced it: a key was declared, so it
 * appeared in the Command Center's copy editor and could be edited and saved —
 * but no component ever read it, so the site never changed. From the operator's
 * side that's indistinguishable from a broken save, and nothing else catches
 * it. The scan is crude on purpose; a false positive here is a five-second fix,
 * a false negative is an hour of confusion.
 */
test("no copy key is registered without something reading it", () => {
  const root = new URL("../../../", import.meta.url).pathname;
  const used = new Set<string>();

  const scan = (dir: string, exts: string[], patterns: RegExp[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full, exts, patterns);
        continue;
      }
      if (!exts.some((e) => entry.name.endsWith(e))) continue;
      const text = readFileSync(full, "utf8");
      for (const re of patterns)
        for (const m of text.matchAll(re)) {
          // A template like `mode.${x}.name` becomes the pattern mode.*.name.
          used.add(m[1]!.replace(/\$\{[^}]*\}/g, "*"));
        }
    }
  };

  // Client: t("…") / lines("…") / fmt("…") and their template forms, plus the
  // `copyKey: "…"` indirection used where a table of links carries its own key.
  scan(join(root, "apps/web"), [".tsx", ".ts"], [
    /\b(?:t|lines|fmt)\(\s*[`"]([^`"]+)[`"]/g,
    /\bcopyKey:\s*[`"]([^`"]+)[`"]/g,
  ]);
  // Server: store.text("…") and copyText(map, "…").
  scan(join(root, "apps/server/src"), [".ts"], [
    /\.text\(\s*[`"]([^`"]+)[`"]/g,
    /copyText\([^,]+,\s*[`"]([^`"]+)[`"]/g,
  ]);

  const covered = (key: string) =>
    used.has(key) ||
    [...used].some(
      (u) => u.includes("*") && new RegExp(`^${u.replace(/\./g, "\\.").replace(/\*/g, "[^.]+")}$`).test(key),
    );

  const dead = COPY_ENTRIES.map((e) => e.key).filter((k) => !covered(k));
  assert.deepEqual(
    dead,
    [],
    `these copy keys are editable in the Command Center but nothing renders them:\n  ${dead.join("\n  ")}`,
  );
});

/**
 * The wallet page renders one of two components depending on whether the site
 * is chain-only (dev.*) or paper (www). $BURG is off-chain and exists in both,
 * but only the paper variant ever offered a way to reach it — so on dev the
 * Burger balance and its ledger were simply unreachable. Both variants now go
 * through the shared tab strip; this keeps it that way.
 */
test("both wallet variants expose the Burger balance", () => {
  const src = readFileSync(
    join(import.meta.dirname, "../../../apps/web/app/wallet/page.tsx"),
    "utf8",
  );
  for (const variant of ["PaperWalletPage", "ChainWalletPage"]) {
    const start = src.indexOf(`function ${variant}(`);
    assert.ok(start > 0, `${variant} not found`);
    const next = src.indexOf("\nfunction ", start + 1);
    const body = src.slice(start, next === -1 ? undefined : next);
    assert.ok(body.includes("<WalletTabs"), `${variant} is missing the Burger tab`);
    assert.ok(body.includes("<BurgerWallet />"), `${variant} never renders the Burger wallet`);
  }
});
