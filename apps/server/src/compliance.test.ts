import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Request } from "express";
import { ComplianceService, locationOf } from "./compliance.js";
import { Store } from "./store.js";

const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as Request;
const ME = "0xabc0000000000000000000000000000000000009" as const;

test("location comes from the edge, not from anything the client can set", () => {
  assert.deepEqual(locationOf(req({ "cf-ipcountry": "gb", "cf-region-code": "eng" })), {
    country: "GB",
    region: "ENG",
  });
  // Cloudflare uses XX for unknown and T1 for Tor; neither is a country.
  assert.equal(locationOf(req({ "cf-ipcountry": "XX" })).country, undefined);
  assert.equal(locationOf(req({ "cf-ipcountry": "T1" })).country, undefined);
  assert.equal(locationOf(req()).country, undefined);
});

test("the gate is open until an operator turns it on", () => {
  const c = new ComplianceService(new Store());
  assert.equal(c.settings().enabled, false);
  assert.equal(c.check(req({ "cf-ipcountry": "KP" }), ME).allowed, true);
});

test("a blocked region is refused once enabled", () => {
  const c = new ComplianceService(new Store());
  c.save({ enabled: true, termsVersion: 0 });
  assert.equal(c.check(req({ "cf-ipcountry": "IR" }), ME).reason, "blocked_region");
  assert.equal(c.check(req({ "cf-ipcountry": "GB" }), ME).allowed, true);
});

test("accepting terms records where they were and what age they claimed", () => {
  const store = new Store();
  const c = new ComplianceService(store);
  c.save({ enabled: true });

  assert.equal(c.check(req({ "cf-ipcountry": "GB" }), ME).reason, "terms_not_accepted");
  const record = c.acceptTerms(ME, req({ "cf-ipcountry": "GB" }), 21);
  assert.equal(record.country, "GB");
  assert.equal(record.ageAttested, 21);
  assert.equal(c.check(req({ "cf-ipcountry": "GB" }), ME).allowed, true);

  // Bumping the version re-prompts without erasing the earlier acceptance.
  c.save({ termsVersion: 2 });
  assert.equal(c.check(req({ "cf-ipcountry": "GB" }), ME).reason, "terms_not_accepted");
  assert.equal(store.getOrCreateUser(ME).termsAccepted?.version, 1);
});

test("self-exclusion can be extended but never shortened", () => {
  const store = new Store();
  const c = new ComplianceService(store);
  c.save({ enabled: true });
  c.acceptTerms(ME, req(), 30);

  const week = c.selfExclude(ME, 7);
  assert.equal(c.check(req(), ME).reason, "self_excluded");

  // Asking for a shorter one must not become an early release — that is the
  // whole failure mode the control exists to prevent.
  const shorter = c.selfExclude(ME, 1);
  assert.equal(shorter, week, "a shorter exclusion cannot cut a longer one short");
  assert.ok(c.selfExclude(ME, 30) > week, "but it can be extended");
});

test("self-exclusion only accepts the offered durations", () => {
  const c = new ComplianceService(new Store());
  assert.throws(() => c.selfExclude(ME, 3), /choose one of/);
});

test("there is no way for staff to lift a self-exclusion", () => {
  // A staff-liftable exclusion is not an exclusion. Guard the absence.
  const src = readFileSync(join(import.meta.dirname, "compliance.ts"), "utf8");
  assert.ok(!/unExclude|liftExclusion|clearExclusion/.test(src));
  const cc = readFileSync(join(import.meta.dirname, "command-center.ts"), "utf8");
  assert.ok(!/excludedUntil\s*=/.test(cc), "no Command Center route may write the expiry");
});

test("self-exclusion drops live sessions, or the current tab stays signed in", () => {
  const store = new Store();
  store.sessions.set("tok", { address: ME, expiresAt: Date.now() + 60_000 } as never);
  store.revokeSessionsFor(ME);
  assert.equal(store.sessionAddress("tok"), undefined);
});

