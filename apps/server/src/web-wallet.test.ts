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

/**
 * Slippage floors. Passing 0 as minTokensOut/minEthOut makes every trade
 * sandwichable for its full size, which is what the chain client did until
 * these landed. The exact quote math is proven against the deployed pool in
 * contracts/test; this only guards the wiring, which is where it would rot.
 */
test("chain trades send a real minimum-out, never zero", () => {
  const src = web("lib/chainTx.ts");

  const buy = src.slice(src.indexOf("export async function chainBuy"));
  assert.ok(buy.includes("SEL.buy + pad32(minOut)"), "buy must send a quoted floor");

  const sell = src.slice(src.indexOf("export async function chainSell"));
  assert.ok(
    sell.includes("SEL.sell + pad32(tokensWei) + pad32(minOut)"),
    "sell must send a quoted floor",
  );

  // Redemption is a fixed uniform price with no curve to move, so it is the one
  // trade that legitimately passes no floor.
  const redeem = src.slice(src.indexOf("export async function chainRedeem"));
  assert.ok(redeem.includes("SEL.redeem + pad32(tokensWei)"));
});

test("the quote is taken after the approval, not before", () => {
  // The approval is its own transaction; anything mined next to it moves the
  // price that an earlier quote would still be promising.
  const src = web("lib/chainTx.ts");
  const sell = src.slice(src.indexOf("export async function chainSell"));
  assert.ok(sell.indexOf("SEL.approve") < sell.indexOf("quoteSell"));
});

test("contract reads do not need an injected wallet", () => {
  // Privy-only players have no window.ethereum. Routing reads through it meant
  // selling threw "No wallet found" before it could even check an allowance.
  const src = web("lib/chainTx.ts");
  const body = src.slice(src.indexOf("async function call("), src.indexOf("// ---------------- quoting"));
  assert.ok(body.includes("ethCall("), "reads should go over the public RPC");
  assert.ok(!body.includes("eth().request"), "reads must not touch the injected wallet");
});

/**
 * Post-graduation fee routing. The destination is collected at launch because
 * it gets burned into an immutable FeeSplitter at graduation — a bad address
 * accepted here is unrecoverable, by anyone, forever.
 */
test("the fee destination is validated before it can be stored", async () => {
  const { feeDestinationOf } = await import("./routes.js");

  // Absent means "pay my own wallet", resolved at graduation.
  assert.equal(feeDestinationOf(undefined), undefined);
  assert.equal(feeDestinationOf(""), undefined);

  assert.equal(
    feeDestinationOf("0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1"),
    "0x75f14607218dc771fcac61a01ae86507b9d8fdf1",
    "stored lowercased so it compares equal to every other address we hold",
  );
  assert.equal(feeDestinationOf("  0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1  "), 
    "0x75f14607218dc771fcac61a01ae86507b9d8fdf1", "pasted addresses carry whitespace");

  // Each of these is unrecoverable once burned into the splitter.
  for (const bad of [
    "0x123",                                        // truncated
    "75f14607218dc771FcAC61a01Ae86507b9d8fdf1",     // missing 0x
    "0x75f14607218dc771FcAC61a01Ae86507b9d8fdfZZ",  // not hex
    "0x0000000000000000000000000000000000000000",   // burns the fees
  ])
    assert.throws(() => feeDestinationOf(bad), /fee destination/, `accepted ${bad}`);
});

test("the protocol fee wallet is the one the operator set", async () => {
  const { PROTOCOL_FEE_WALLET, GRADUATED_PROTOCOL_FEE_BPS } = await import("@cookout/shared");
  assert.equal(PROTOCOL_FEE_WALLET, "0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1");
  assert.ok(GRADUATED_PROTOCOL_FEE_BPS > 0 && GRADUATED_PROTOCOL_FEE_BPS < 10_000);
});

test("the launch form asks for the destination and says it is permanent", () => {
  const ui = web("components/FeeDestination.tsx");
  assert.ok(ui.includes("permanent"), "the consequence must be stated, not implied");
  assert.ok(web("app/submissions/page.tsx").includes("<FeeDestination"));
});

/**
 * The spend guard. Silent signing is what keeps rounds playable, and the cost
 * of it is that anything on the page can move funds unseen. The guard has to
 * sit at the send chokepoint — put it in a UI component and the next caller
 * bypasses it without noticing.
 */
test("large spends are checked where every send passes, not in the UI", () => {
  const src = web("lib/cookoutWallet.ts");
  const send = src.slice(src.indexOf("export async function cookoutSend"));
  assert.ok(send.includes("await guardSpend("), "cookoutSend must run the guard");

  const guard = src.slice(src.indexOf("async function guardSpend"));
  // No confirmer mounted must fail closed: signing a large spend because the
  // dialog was missing is the exact thing being guarded against.
  assert.ok(
    guard.indexOf("if (!confirmer) throw") < guard.indexOf("if (!(await confirmer("),
    "a missing confirmer must reject, never fall through to signing",
  );
});

test("the operator's gas balance is watched, since empty means stuck escrow", async () => {
  const { OPERATOR_MIN_BALANCE_ETH } = await import("./chain.js");
  assert.ok(OPERATOR_MIN_BALANCE_ETH > 0);
  const src = readFileSync(join(import.meta.dirname, "chain.ts"), "utf8");
  assert.ok(src.includes("checkOperatorBalance"), "the balance must be polled");
  // One audit line per crossing, not one a minute.
  assert.match(src, /previous \?\? Infinity\) >= OPERATOR_MIN_BALANCE_ETH/);
});

/**
 * Feature flags have to actually gate something.
 *
 * Every flag was registered in the Command Center and read by nothing: an
 * operator could switch "The Pit" off, watch the toggle move and the audit log
 * record it, and the Pit would keep taking entries. A control panel that lies
 * is worse than no control panel, and this is the same failure as the copy keys
 * that were editable but never rendered — so it gets the same kind of guard.
 */
test("every registered feature flag is enforced somewhere", async () => {
  const { FEATURE_FLAGS } = await import("@cookout/shared");
  const sources = ["routes.ts", "engine.ts", "store.ts", "collection.ts", "burger.ts", "jackpot.ts"]
    .map((f) => {
      try {
        return readFileSync(join(import.meta.dirname, f), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");

  // Flags whose enforcement is presentational or lives outside the server.
  const elsewhere = new Set(["seasonal_theme", "maintenance", "telegram", "goons", "nfts"]);

  const dead = FEATURE_FLAGS.filter((f) => !elsewhere.has(f.key))
    .filter((f) => !sources.includes(`flag("${f.key}")`))
    .map((f) => f.key);
  assert.deepEqual(dead, [], `these flags gate nothing: ${dead.join(", ")}`);
});

test("a flag switched off actually closes the thing it names", async () => {
  const { Store } = await import("./store.js");
  const store = new Store();
  assert.equal(store.flag("pit"), true, "on by default");
  store.featureFlags.pit = false;
  assert.equal(store.flag("pit"), false);
  // Defaults still resolve for flags the operator never touched.
  assert.equal(store.flag("pit_trading"), true);
});

/**
 * On-chain Pit pools. The paper site keeps running the Pit in pETH; only the
 * chain-only site escrows real money, which is why `pitChain` is optional and
 * every path has to cope with it being absent.
 */
test("the battle winner is decided by a rule a player can check", async () => {
  const { Store } = await import("./store.js");
  const { battleWinnerOf } = await import("./pit-results.js");
  const store = new Store();
  const round = { id: "r1" } as never;

  const A = "0xaaa0000000000000000000000000000000000001";
  const B = "0xbbb0000000000000000000000000000000000002";
  const C = "0xccc0000000000000000000000000000000000003";

  // Highest PnL wins outright.
  assert.equal(battleWinnerOf(store, round, new Map([[A, 5], [B, 9], [C, 1]])), B);

  // A winner-take-all contract cannot split a tie, so one has to be picked —
  // by a rule fixed in advance, not a judgement made after seeing who it helps.
  store.trades.set("r1", [
    { userAddress: A }, { userAddress: A }, { userAddress: B },
  ] as never);
  assert.equal(
    battleWinnerOf(store, round, new Map([[A, 9], [B, 9]])),
    A,
    "tied on PnL, more trades wins",
  );
  // Tied on both: the address order is arbitrary and deterministic, which is
  // the point — it cannot be steered.
  store.trades.set("r1", []);
  assert.equal(battleWinnerOf(store, round, new Map([[B, 9], [A, 9]])), A);

  assert.equal(battleWinnerOf(store, round, new Map()), undefined, "nobody traded");
});

test("resolution is wired to the engine without a circular dependency", () => {
  // The chain service takes the engine, so the engine gets its hook after both
  // exist. If this is ever dropped, Pit pools silently never resolve and the
  // only thing standing between players and a stuck pot is the refund window.
  const idx = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
  assert.match(idx, /engine\.onPitChainResolve\s*=/);
  const eng = readFileSync(join(import.meta.dirname, "engine.ts"), "utf8");
  assert.ok(eng.includes("onPitChainResolve"), "the engine must call it on Pit match end");
});
