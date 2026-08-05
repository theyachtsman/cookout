import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards on the Cookout Wallet migration.
 *
 * The chain-only site used to play from a burner private key kept in
 * localStorage. That is gone: the player's Privy embedded wallet is the one
 * balance rounds spend. These are source checks rather than behaviour tests
 * because the thing worth protecting is which wallet gets to sign — a
 * regression there moves real money to the wrong address, and it would look
 * completely normal in a UI test.
 */

const web = (p: string) => readFileSync(join(import.meta.dirname, "../../../apps/web", p), "utf8");

test("gameplay transactions sign with the Cookout Wallet, not the old burner", () => {
  const chainTx = web("lib/chainTx.ts");
  assert.ok(
    !/from "\.\/arenaWallet"/.test(chainTx),
    "chainTx must not reach for the legacy burner wallet",
  );
  assert.ok(chainTx.includes("cookoutSend"), "chainTx should send via the Cookout Wallet");
});

test("the legacy burner can no longer sign anything", () => {
  const legacy = web("lib/arenaWallet.ts");
  // Sweeping a stranded balance home is the one send it may still do.
  assert.ok(!legacy.includes("export async function arenaSend"), "arenaSend must stay removed");
  assert.ok(
    !legacy.includes("export function arenaAddress"),
    "nothing should mint a new burner key",
  );
  assert.ok(legacy.includes("arenaWithdraw"), "the migration sweep must stay available");
});

test("the embedded wallet signs without a confirmation sheet", () => {
  // A modal per trade is unplayable, and it is why the burner existed at all.
  assert.ok(web("components/Providers.tsx").includes("showWalletUIs: false"));
});

test("the chain wallet page can deposit, send, and show history", () => {
  const page = web("app/wallet/page.tsx");
  for (const needed of ["cookoutTransfer", "walletHistory", "Send max", "LegacyArenaSweep"])
    assert.ok(page.includes(needed), `wallet page is missing ${needed}`);
});

test("the chain ledger dedupes replayed events and reads newest first", async () => {
  const { Store } = await import("./store.js");
  const store = new Store();
  const me = "0xabc0000000000000000000000000000000000001" as `0x${string}`;
  const row = { kind: "buy" as const, eth: -0.5, tokens: 1000, symbol: "PORK", chainId: 46630 };

  store.recordChainLedger(me, { ...row, txHash: "0xdead", at: 1_000 });
  // The mirror re-scans a block range after a restart; the same buy must not
  // land twice, or the history reads as double the trades actually made.
  store.recordChainLedger(me, { ...row, txHash: "0xdead", at: 1_000 });
  store.recordChainLedger(me, { ...row, kind: "sell", eth: 0.6, txHash: "0xbeef", at: 2_000 });

  const ledger = store.chainLedgerOf(me);
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0]!.kind, "sell", "newest first");
  assert.equal(ledger[1]!.eth, -0.5, "a buy debits the wallet");
});

test("a different action on one transaction is kept", () => {
  // Selling approves and then sells in the same flow; those are two rows, and
  // deduping on hash alone would silently swallow one of them.
  const src = readFileSync(join(import.meta.dirname, "store.ts"), "utf8");
  assert.match(src, /e\.txHash === entry\.txHash && e\.kind === entry\.kind/);
});
