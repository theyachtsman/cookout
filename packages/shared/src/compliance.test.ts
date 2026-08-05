import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateCompliance,
  freshComplianceSettings,
  mergeComplianceSettings,
} from "./compliance.js";

const on = () => ({ ...freshComplianceSettings(), enabled: true, termsVersion: 1 });
const accepted = { acceptedTerms: 1 };

test("disabled settings let everyone through", () => {
  const s = freshComplianceSettings();
  assert.equal(s.enabled, false, "must be off until real funds");
  assert.equal(evaluateCompliance(s, { country: "KP" }).allowed, true);
});

test("blocks comprehensively sanctioned jurisdictions once enabled", () => {
  const d = evaluateCompliance(on(), { country: "ir", ...accepted });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "blocked_region");
});

test("blocks a sub-national region without blocking its country", () => {
  const s = { ...on(), blockedRegions: ["US-NY"] };
  assert.equal(evaluateCompliance(s, { country: "US", region: "NY", ...accepted }).allowed, false);
  assert.equal(evaluateCompliance(s, { country: "US", region: "TX", ...accepted }).allowed, true);
});

test("an unknown region is allowed by default and blockable on request", () => {
  // Failing closed is right for a licensing gate but wrong as a default: it
  // would lock out every legitimate visitor behind a privacy proxy.
  assert.equal(evaluateCompliance(on(), { ...accepted }).allowed, true);
  const strict = { ...on(), blockUnknownRegion: true };
  assert.equal(evaluateCompliance(strict, { ...accepted }).reason, "unknown_region");
});

test("denied addresses are matched regardless of case", () => {
  const s = { ...on(), deniedAddresses: ["0xAbC0000000000000000000000000000000000001"] };
  const d = evaluateCompliance(s, { address: "0xabc0000000000000000000000000000000000001", ...accepted });
  assert.equal(d.reason, "sanctioned_address");
});

test("sanctions and region outrank terms, so a block is never phrased as a fixable step", () => {
  // Telling a sanctioned visitor to "accept the terms" reads as a workaround.
  const s = { ...on(), deniedAddresses: ["0xbad"] };
  assert.equal(evaluateCompliance(s, { address: "0xbad" }).reason, "sanctioned_address");
  assert.equal(evaluateCompliance(on(), { country: "KP" }).reason, "blocked_region");
});

test("self-exclusion holds until it expires and cannot be waived by re-accepting", () => {
  const now = 1_000_000;
  const s = on();
  const d = evaluateCompliance(s, { excludedUntil: now + 5_000, ...accepted }, now);
  assert.equal(d.reason, "self_excluded");
  assert.equal(d.until, now + 5_000);
  assert.equal(evaluateCompliance(s, { excludedUntil: now - 1, ...accepted }, now).allowed, true);
});

test("bumping the terms version re-prompts everyone", () => {
  const s = { ...on(), termsVersion: 2 };
  assert.equal(evaluateCompliance(s, { acceptedTerms: 1 }).reason, "terms_not_accepted");
  assert.equal(evaluateCompliance(s, { acceptedTerms: 2 }).allowed, true);
});

test("merging keeps operator edits and adds new fields at defaults", () => {
  const merged = mergeComplianceSettings({ enabled: true, blockedCountries: ["US"] });
  assert.equal(merged.enabled, true);
  assert.deepEqual(merged.blockedCountries, ["US"]);
  assert.equal(merged.minimumAge, 18, "a field the operator never set");
  assert.deepEqual(merged.selfExclusionDays, [1, 7, 30, 90, 365]);
});
