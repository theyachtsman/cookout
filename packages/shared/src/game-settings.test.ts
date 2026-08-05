import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BATTLE_TIERS,
  battleEntryWei,
  freshGameSettings,
  gameSettingProblem,
  mergeGameSettings,
} from "./game-settings.js";

test("battle tiers ship as the $5 / $25 / $100 ladder", () => {
  const s = freshGameSettings();
  assert.deepEqual(
    BATTLE_TIERS.map((t) => s.battleTiers[t].entryUsd),
    [5, 25, 100],
  );
  for (const t of BATTLE_TIERS) assert.ok(s.battleTiers[t].feeBps <= 1_000, "within the contract cap");
});

test("an operator's tier edits survive a merge, and new tiers arrive at default", () => {
  const merged = mergeGameSettings({
    battleTiers: { easy: { label: "Easy", entryUsd: 2, feeBps: 300, enabled: true } },
  } as never);
  assert.equal(merged.battleTiers.easy.entryUsd, 2, "the edit is kept");
  assert.equal(merged.battleTiers.hard.entryUsd, 100, "untouched tiers keep their default");
});

test("tier guardrails refuse what the contract would reject or a typo would cost", () => {
  assert.equal(gameSettingProblem("battleTiers.easy.entryUsd", 5), null);
  assert.match(gameSettingProblem("battleTiers.easy.entryUsd", 0) ?? "", /greater than zero/);
  // A mistyped zero reprices the whole tier for everyone who enters it.
  assert.match(gameSettingProblem("battleTiers.hard.entryUsd", 100_000) ?? "", /typo/);
  // PitBattlePool caps its fee at 10%; a higher value here would just fail to deploy.
  assert.equal(gameSettingProblem("battleTiers.hard.feeBps", 1_000), null);
  assert.match(gameSettingProblem("battleTiers.hard.feeBps", 1_500) ?? "", /capped at 10%/);
});

test("USD entries convert to wei at the current ETH price", () => {
  // The ladder is priced in dollars so it means the same thing as ETH moves.
  assert.equal(battleEntryWei(25, 2_500), 10n ** 16n); // $25 at $2500/ETH = 0.01 ETH
  assert.equal(battleEntryWei(100, 4_000), 25n * 10n ** 15n); // 0.025 ETH
  assert.throws(() => battleEntryWei(25, 0), /positive/);
});
