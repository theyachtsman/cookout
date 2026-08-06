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
  assert.ok(web("components/LaunchCoin.tsx").includes("<FeeDestination"));
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

test("importing a round refuses to roll back one that is still running", async () => {
  // The failure this guards: restoring a stale export over a round that kept
  // trading, silently reverting real positions to an older state.
  const src = readFileSync(join(import.meta.dirname, "command-center.ts"), "utf8");
  const route = src.slice(src.indexOf('"/api/cc/rounds/import"'));
  assert.match(route, /already \$\{existing\.state\} here/);
  assert.ok(route.indexOf("existing.state !== \"results\"") < route.indexOf("store.rounds.set"));
});

test("the battle entry is priced by the server, never by the request", () => {
  // The whole point of a fixed ladder: if the client could send an amount,
  // entering for less than everyone else and still winning the pot comes back.
  const src = readFileSync(join(import.meta.dirname, "routes.ts"), "utf8");
  const enter = src.slice(src.indexOf('"/api/pit/:id/enter"'), src.indexOf('"/api/pit/:id/enter"') + 6000);
  const branch = enter.slice(enter.indexOf("if (body.trading)"));
  assert.ok(branch.includes("tier.entryUsd"), "the stake comes from the tier");
  assert.ok(
    !branch.includes("resolveStake(body.tradingStake"),
    "a client-sent buy-in must not price the entry",
  );
  assert.ok(branch.includes("BATTLE_TIERS.includes"), "and the tier must be a real one");
});

test("the lobby is offered only the tiers an operator left enabled", () => {
  const src = readFileSync(join(import.meta.dirname, "routes.ts"), "utf8");
  assert.match(src, /BATTLE_TIERS\.filter\(\(k\) => store\.settings\.game\.battleTiers\[k\]\?\.enabled\)/);
});

test("both Pit chain hooks are actually called, not just defined", () => {
  // createPitPools existed for a whole commit without a single call site —
  // it typechecked, shipped, and did nothing. Defining a method is not wiring
  // it, so both directions get pinned: bound in index, invoked in the engine.
  const idx = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
  const eng = readFileSync(join(import.meta.dirname, "engine.ts"), "utf8");
  for (const hook of ["onPitChainCreate", "onPitChainClose", "onPitChainResolve"]) {
    assert.match(idx, new RegExp(`engine\\.${hook}\\s*=`), `${hook} must be bound`);
    // Either call style — the point is that it is reached, not how.
    assert.ok(
      eng.includes(`this.${hook}?.(`) || eng.includes(`this.${hook}(`),
      `${hook} must be invoked by the engine`,
    );
  }
});

test("the prediction pool fee is clamped to what the contract accepts", () => {
  // PitPool rejects anything over 10% at construction, and the paper Pit's
  // rake is configurable above it — unclamped, a legal setting would deploy
  // nothing and the match would silently run without a pot.
  const idx = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
  assert.match(idx, /Math\.min\(round\.pit\?\.pitFeeBps \?\? 500, 1_000\)/);
});

/**
 * Chain Pit entries. The money goes from the player's wallet to the pool, so
 * the server is not in the payment path and cannot be the one to decide
 * whether a bet was paid for.
 */
test("a chain Pit entry is verified against the pools, not taken on trust", () => {
  const src = readFileSync(join(import.meta.dirname, "routes.ts"), "utf8");
  const enter = src.slice(src.indexOf('"/api/pit/:id/enter"'));
  const guard = enter.slice(enter.indexOf("if (round.pitChain)"), enter.indexOf("enterPit(store"));
  assert.ok(guard.includes("chain.pitStakesOf"), "it must read the pools");
  assert.match(guard, /staked\.battle\[entry\.battleTier/, "and refuse an unpaid entry in that tier");
  // Reading a stake of zero must reject, not merely warn.
  assert.match(guard, /throw new Err\(\s*402/);
});

test("a chain entry is never also charged to the paper balance", () => {
  // The stake is already in the contract; debiting pETH as well would charge
  // twice for one bet, and refunding it on withdrawal would mint money.
  const src = readFileSync(join(import.meta.dirname, "pit-pools.ts"), "utf8");
  assert.ok(src.includes("const onChain = !!round.pitChain"), "both paths must know");
  // Exactly one balance write per function — the one inside its guard. A
  // second would be a branch that moves paper money regardless of onChain,
  // which is the bug this is here to catch.
  const between = (from: string, to?: string) =>
    src.slice(src.indexOf(from), to ? src.indexOf(to) : undefined);
  const writes = (body: string) => (body.match(/user\.arenaBalance = /g) ?? []).length;
  const withdraw = between("export function withdrawPit", "export function enterPit");
  const enter = between("export function enterPit");
  assert.equal(writes(withdraw), 1, "withdrawal must credit only through its guard");
  assert.equal(writes(enter), 1, "entry must debit only through its guard");
  assert.ok(withdraw.includes("credit(") && enter.includes("debit("), "and the branches use them");
});

test("players can reach their own money without us", () => {
  // Pull-based payouts and a permissionless refund window are only guarantees
  // if the UI offers them; otherwise the money is theoretically theirs.
  const ui = web("components/PitPayout.tsx");
  assert.ok(ui.includes("claimPitPool") && ui.includes("refundPitPool"));
  const lib = web("lib/pitPool.ts");
  assert.ok(lib.includes("openRefunds"), "the escape hatch must be callable from the client");
});

test("withdrawing a chain entry checks the money actually left the pool", () => {
  // The reported bug: withdraw cleared our record, the contract kept the
  // stake, and re-entering was refused because the pool still had them down
  // as entered. Both directions now verify against the chain.
  const src = readFileSync(join(import.meta.dirname, "routes.ts"), "utf8");
  const route = src.slice(src.indexOf('"/api/pit/:id/withdraw"'));
  const guard = route.slice(route.indexOf("if (round.pitChain)"), route.indexOf("withdrawPit(store"));
  assert.ok(guard.includes("chain.pitStakesOf"), "it must read the pools");
  assert.match(guard, /stillIn/, "and refuse while the stake is still escrowed");
});

test("players can get out before the match starts", () => {
  // A stake with no exit turns "withdraw" into a lie, and the paper Pit has
  // always let a bet be pulled while the lobby is open.
  const lib = web("lib/pitPool.ts");
  assert.ok(lib.includes("leavePitPools"), "the client needs a way out");
  assert.ok(lib.includes("unstake") && lib.includes("exit"), "for both pools");
  assert.ok(
    web("app/pit/[id]/page.tsx").includes("leavePitPools"),
    "and the withdraw button must call it",
  );
});

test("each difficulty tier is its own pot", async () => {
  // One shared pool would put a $5 entrant in a pot fed by $100 entrants,
  // which is exactly what the fixed ladder was introduced to prevent — and
  // with one pool only the cheapest tier could ever be entered at all.
  const factory = readFileSync(
    join(import.meta.dirname, "../../../contracts/src/PitPoolFactory.sol"),
    "utf8",
  );
  assert.match(factory, /address battleEasy;\s*address battleMedium;\s*address battleHard;/);
  assert.match(factory, /uint256\[3\] calldata entryFees/);

  const routes = readFileSync(join(import.meta.dirname, "routes.ts"), "utf8");
  // Paying into Easy must not buy a place in Hard.
  assert.match(routes, /staked\.battle\[entry\.battleTier \?\? "easy"\]/);
});

test("updating a bet does not stake twice", () => {
  // stake() adds to a position and enter() rejects a second entry, so an
  // update that re-sent everything either doubled the bet or reverted.
  const page = web("app/pit/[id]/page.tsx");
  assert.ok(page.includes("!entry?.prediction"), "an existing prediction is not re-staked");
  assert.ok(page.includes("alreadyIn"), "an existing battle entry is not re-entered");
  assert.ok(
    page.includes("leavePitPools(pc, { prediction: false, battle: entry.battleTier })"),
    "switching tier leaves the old pot first",
  );
});

test("the crate rests on the table rather than through it", () => {
  // It was hardcoded to -0.22 while the table's top face sits at -0.33 and the
  // crate is 1.05 tall — so it hung 0.4 units through the surface and read as
  // floating. Deriving it from the table means moving the table cannot break
  // it again.
  const src = web("components/collection/CrateOpening.tsx");
  assert.match(src, /const REST_Y = TABLE_Y \+ TABLE_THICKNESS \/ 2 \+ CRATE_HEIGHT \/ 2/);
  assert.ok(!/position\.y = .*-0\.22/.test(src), "no hardcoded rest height");
});

test("the scene gives its metals something to reflect", () => {
  // Metal in a PBR renderer is almost entirely reflection: metalness 0.9 with
  // an empty environment renders near-black however bright the lights are,
  // which is what made this look flat and monotone.
  const src = web("components/collection/CrateOpening.tsx");
  assert.ok(src.includes("<Environment"), "an environment is required for metal");
  assert.ok(src.includes("Lightformer"), "built in-scene, so it needs no HDRI download");
  assert.ok(src.includes("ACESFilmicToneMapping"), "and filmic tone mapping");
});

test("the crate has its own sound cues, not borrowed ones", async () => {
  // It played round.launch, ui.click and trade.buy — so retuning a trade
  // silently changed the crate, and the crate could not be tuned at all.
  const { SOUND_CUES } = await import("@cookout/shared");
  const crate = SOUND_CUES.filter((c) => c.group === "Recruit Crates").map((c) => c.key);
  assert.deepEqual(crate, [
    "crate.arrive",
    "crate.strain",
    "crate.burst",
    "crate.reveal",
    "crate.legendary",
  ]);

  const scene = web("components/collection/CrateOpening.tsx");
  for (const key of crate) assert.ok(scene.includes(`"${key}"`), `${key} is never played`);
  // Every registered cue needs a voice, or the Audio Manager offers a slider
  // that controls nothing.
  const lib = web("lib/audio.ts");
  for (const key of crate) assert.ok(lib.includes(`R("${key}"`), `${key} has no voice`);
});

test("a card bound to a token shows the token's own art", async () => {
  const { planNftImport } = await import("@cookout/shared");
  assert.equal(typeof planNftImport, "function");
  // Otherwise the import is cosmetic: the binding exists and players still see
  // whatever was in the Media Library.
  const browser = web("components/collection/CollectionBrowser.tsx");
  assert.ok(browser.includes("chain?.imageUrl"), "NFT art must win over the asset");
  assert.ok(browser.includes("ipfs://"), "and ipfs:// must be rewritten to a gateway");
});

test("the collection exports as a brief someone outside the project can use", () => {
  const src = readFileSync(join(import.meta.dirname, "command-center.ts"), "utf8");
  const route = src.slice(src.indexOf('"/api/cc/collection/export"'));
  // An artist quotes on counts and on how many are one-offs versus variations.
  for (const field of ["byRarity", "named", "procedural", "cardCount"])
    assert.ok(route.includes(field), `the summary needs ${field}`);
  // Every written field, or they are drawing from a name alone.
  for (const field of ["biography", "lore", "equipment", "traits", "description"])
    assert.ok(route.includes(field), `${field} must be in the export`);
  // A biography with a comma would shift every later column.
  assert.match(route, /replace\(\/"\/g, '""'\)/);
});

/**
 * Minting on demand. The pull stays instant and off-chain; this is the
 * optional second step, and the player pays for it.
 */
test("a mint voucher is signed only for a recruit the player owns", () => {
  const src = readFileSync(join(import.meta.dirname, "routes.ts"), "utf8");
  const route = src.slice(src.indexOf('"/api/collection/mint-voucher"'));
  const body = route.slice(0, route.indexOf("app.post", 10));
  // Entitlement comes from their collection, never from the request — the
  // browser can ask for any card, and the signature is the authorisation.
  assert.ok(body.includes("user.collection?.owned[cardId]"), "ownership is read, not trusted");
  assert.ok(body.includes("n > owned.quantity"), "and one voucher per copy owned");
  assert.ok(body.indexOf("owned?.quantity") < body.indexOf("signMintVoucher"), "checked before signing");
});

test("the voucher is bound so it cannot be reused elsewhere", () => {
  const src = readFileSync(join(import.meta.dirname, "chain.ts"), "utf8");
  const fn = src.slice(src.indexOf("async signMintVoucher"));
  // chain + contract + player + card + nonce: a leaked signature is useless
  // to anyone else, for anything else, on any other deployment.
  for (const part of ["this.chain.id", "this.nftContract", "cardId", "nonce"])
    assert.ok(fn.includes(part), `the digest must bind ${part}`);
});

test("minting is offered on the result, never during the animation", () => {
  // The distinction that matters is not "not in this file" — it is that the
  // reveal is never blocked. A wallet prompt mid-animation would spoil the
  // moment the feature exists to celebrate; a button on the card afterwards,
  // while they are looking at it, is the natural place to offer it.
  const scene = web("components/collection/CrateOpening.tsx");
  const card = scene.slice(scene.indexOf("function DossierCard"));
  assert.ok(card.includes("<MintRecruit"), "the result card offers it");

  // Nothing in the phases that run the animation may reach for it.
  const cinematic = scene.slice(0, scene.indexOf("function DossierCard"));
  assert.ok(!cinematic.includes("MintRecruit("), "the animation must not call it");
  assert.ok(!/phase === "reveal"[\s\S]{0,400}MintRecruit/.test(scene), "and the reveal must not wait on it");

  assert.ok(
    web("components/collection/CollectionBrowser.tsx").includes("card.owned && ("),
    "and it stays available on a card they already hold",
  );
});

test("the mint button asks the chain which copies are already minted", () => {
  // It used to always request copy 1 and remember success only in local state,
  // so a reload brought the button back and pressing it spent a voucher that
  // was already gone — reverting with no useful message. The contract exposes
  // voucherSpent for exactly this; it simply was not being called.
  const ui = web("components/collection/MintRecruit.tsx");
  assert.ok(ui.includes("voucherSpent"), "it must read what has been spent");
  assert.ok(!ui.includes("void mint(1)"), "and never hardcode copy 1");
  assert.ok(ui.includes("nextCopy === 0"), "with a finished state when all copies are minted");
});

test("a mint records its gas in the wallet ledger", () => {
  // A mint moves no ETH, so without the receipt it would appear in the history
  // as a free action.
  const ui = web("components/collection/MintRecruit.tsx");
  assert.match(ui, /eth: -\(await gasCostOf\(/);
  assert.ok(ui.includes('kind: "mint"'));
  const wallet = web("lib/cookoutWallet.ts");
  assert.ok(wallet.includes("getTransactionReceipt"), "read from the receipt, not estimated");
});

test("creating a round costs the house nothing but gas", () => {
  // The seed used to be sent as msg.value and was unrecoverable — no path in
  // RoundPool returns principal, so every launch cost the platform its seed
  // whether the coin graduated or died. It is a virtual anchor now: it sets
  // the opening price and nobody funds it.
  const src = readFileSync(join(import.meta.dirname, "chain.ts"), "utf8");
  const create = src.slice(src.indexOf("functionName: \"createRound\""));
  const head = create.slice(0, 600);
  assert.match(head, /value: 0n/, "no ETH may be sent with a round");
  assert.ok(!/value: parseEther\(String\(config\.curveAnchorEth\)\)/.test(src));
  assert.ok(src.includes("virtualEthReserve: parseEther"), "the anchor is passed instead");
});

test("only real ETH can leave a pool", async () => {
  const pool = readFileSync(
    join(import.meta.dirname, "../../../contracts/src/RoundPool.sol"),
    "utf8",
  );
  // Pricing uses the virtual side; payouts must not.
  assert.match(pool, /function _pricingEth\(\)/);
  assert.match(pool, /if \(grossOut > ethReserve\) grossOut = ethReserve;/, "sells clamp to real ETH");
  // Redemption and migration read the real balance, never the anchor.
  const redeem = pool.slice(pool.indexOf("redemptionPriceWad = "), pool.indexOf("redemptionPriceWad = ") + 120);
  assert.ok(redeem.includes("ethReserve") && !redeem.includes("_pricingEth"));
});

test("the launch form's own dialogs stack above the modal that hosts them", () => {
  // Both the shell and the confirm card portal to document.body, so plain
  // z-index decides which one wins. The confirm used to sit at 80 under a
  // shell at 120: pressing Preview appeared to do nothing, and closing the
  // shell to reach the confirm unmounted the form and lost the whole coin.
  const src = web("components/LaunchCoin.tsx");
  const shell = Number(/z-\[(\d+)\][^"]*flex items-end justify-center bg-black\/80/.exec(src)?.[1]);
  const nested = [...src.matchAll(/z-\[(\d+)\][^"]*flex items-center justify-center p-4/g)].map(
    (m) => Number(m[1]),
  );
  assert.ok(shell > 0, "found the shell's layer");
  assert.equal(nested.length, 2, "confirm + created card");
  for (const z of nested) assert.ok(z > shell, `nested dialog at ${z} must beat shell at ${shell}`);
});

test("the launch shell does not dismiss itself out from under its own dialogs", () => {
  // Escape and the backdrop would otherwise discard a half-filled form while
  // the player was only trying to dismiss the confirm card in front of it.
  const src = web("components/LaunchCoin.tsx");
  assert.match(src, /onClick=\{\(\) => !nested && onClose\(\)\}/, "backdrop defers when nested");
  assert.match(src, /"Escape" && !nestedRef\.current/, "Escape defers when nested");
  assert.match(src, /onNested=\{setNested\}/, "the form reports its dialogs upward");
});

test("the collection stays dark on the paper beta, in the UI and on the wire", () => {
  // Two independent gates, because either alone is a single point of failure.
  // The UI gate is keyed to the host, not a database flag: a flag defaults on,
  // so a fresh deploy or a restored backup would expose the whole collection.
  const hook = web("lib/chainOnly.ts");
  assert.match(hook, /export function useCollectionVisible\(\)/);
  assert.match(hook, /return useChainOnly\(\);/);

  for (const [file, needle] of [
    ["app/recruit/page.tsx", /if \(!collectionVisible\)/],
    ["components/WalletButton.tsx", /\{collectionVisible && <RecruitPanel/],
    ["app/profile/page.tsx", /id !== "collection" \|\| collectionVisible/],
    ["components/PublicProfile.tsx", /collectionVisible \? \[\["collection"/],
  ] as const) {
    assert.match(web(file), needle, `${file} gates the collection`);
  }

  // And the server refuses rather than trusting the client. The catalogue used
  // to ship in full alongside `enabled: false` — every card, number, rarity
  // and set — which is precisely the thing that must not leak early.
  const routes = readFileSync(join(import.meta.dirname, "routes.ts"), "utf8");
  // Darkness must be the DEFAULT, not a stored flag: a flag defaults to on, so
  // a fresh database or a restored backup would publish the collection with
  // nobody touching anything. Deriving it from chain config cannot do that.
  assert.match(routes, /const collectionOff = \(\) =>\s*\n?\s*!chain\?\.publicContracts \|\|/);
  assert.match(routes, /!store\.flag\("nfts"\) \|\| !store\.settings\.collection\.enabled;/);
  const feed = routes.slice(routes.indexOf('"/api/collection",'), routes.indexOf('"/api/collection/:address"'));
  assert.match(feed, /if \(collectionOff\(\)\) \{[\s\S]*cards: \[\]/, "the feed returns nothing when off");
  // Every other collection surface is gated too.
  for (const route of ['"/api/collection/:address"', '"/api/collection/open"', '"/api/collection/mint-voucher"']) {
    const start = routes.indexOf(route);
    assert.ok(start > 0, `${route} exists`);
    assert.match(routes.slice(start, start + 900), /collectionOff\(\)/, `${route} is gated`);
  }
});

test("the server refuses to start against a stale @cookout/shared build", () => {
  // The failure this prevents, which actually happened: the server runs from
  // TypeScript source, but @cookout/shared resolves to its compiled dist. A
  // deploy that pulls new code and runs `npm i` does not rebuild that package,
  // so the two disagree on field names — and nothing throws. Reads return
  // undefined, arithmetic yields NaN, NaN serialises to null, and the null is
  // written into a live round. Silent corruption of data being traded.
  const guard = readFileSync(join(import.meta.dirname, "shared-build.ts"), "utf8");
  assert.match(guard, /export function assertSharedBuildFresh/);
  assert.match(guard, /if \(src > dist\)/, "compares source against build");
  assert.match(guard, /process\.exit\(1\)/, "refuses rather than corrupting");
  assert.match(guard, /npm run build -w @cookout\/shared/, "says how to fix it");

  // And it runs before anything can read a shared constant.
  const index = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
  const call = index.indexOf("assertSharedBuildFresh(");
  assert.ok(call > 0, "the guard is called");
  assert.ok(call < index.indexOf("new Store()"), "before any state is built");
});

test("every operator-paid round action has a call site, not just a method", () => {
  // Three times now I have written one of these and never called it —
  // createPitPools, voucherSpent, and claimRoundFees — each time shipping a
  // method that reads as done and does nothing. The test is the call site, in
  // both directions: the method must exist, and something must invoke it.
  const src = readFileSync(join(import.meta.dirname, "chain.ts"), "utf8");
  // Callers live in chain.ts for the private ones and index.ts for the hooks,
  // so search both rather than assume where the call has to be.
  const callers = src + readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
  for (const method of ["claimRoundFees", "migrateRound", "createPitPools"]) {
    assert.ok(new RegExp(`(private )?async ${method}\\(`).test(src), `${method} is defined`);
    assert.match(callers, new RegExp(`\\.${method}\\(`), `${method} is actually called`);
  }

  // And the claim specifically hangs off resolution, so it covers rounds that
  // failed as well as rounds that graduated — a dead round still charged trade
  // fees and still cost four transactions.
  const resolvedBlock = src.slice(src.indexOf("if (resolved) {"), src.indexOf("// Past the on-chain end time"));
  assert.match(resolvedBlock, /this\.claimRoundFees\(round\)/, "claimed on every resolution");
  assert.ok(
    resolvedBlock.indexOf("claimRoundFees") > resolvedBlock.indexOf("migrateRound"),
    "claimed after migration is kicked off",
  );
});

test("every card rail on the Cook Out page is a real shelf, with arrows", () => {
  // The Endurance rail was a bare overflow-x-auto div: it scrolled by wheel or
  // swipe but had no edge arrows and no fades, so on a desktop with more coins
  // than fit there was nothing to indicate the row continued. CategoryShelf is
  // what every other rail uses; hideHeader keeps each section's own header.
  const page = web("app/matches/page.tsx");
  const rails = [...page.matchAll(/no-scrollbar flex gap-4 overflow-x-auto/g)];
  assert.equal(rails.length, 0, "no hand-rolled card rails left on this page");
  // Both the Endurance and Up Next rails now go through the shelf.
  assert.match(page, /<CategoryShelf title="Endurance" count=\{enduranceQueue\.length\} hideHeader>/);
  assert.match(page, /<CategoryShelf title="Up next" count=\{queue\.length\} hideHeader>/);

  // And the shelf still actually renders arrows, so the above means something.
  const shelf = web("components/CategoryShelf.tsx");
  assert.match(shelf, /aria-label=\{side === "left" \? "Scroll left" : "Scroll right"\}/);
  assert.match(shelf, /\{!atStart && arrow\("left"\)\}/);
  assert.match(shelf, /\{!atEnd && arrow\("right"\)\}/);
});
