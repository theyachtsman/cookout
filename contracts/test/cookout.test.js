const { expect } = require("chai");
const { ethers } = require("hardhat");
const vectors = require("./vectors.json");

const E = (n) => ethers.parseEther(String(n));
const WAD = 10n ** 18n;

async function mine(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

async function now() {
  const b = await ethers.provider.getBlock("latest");
  return b.timestamp;
}

/** Real Uniswap v4 on Robinhood Chain — same addresses as its mainnet. */
const V4 = {
  positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};
const PROTOCOL_WALLET = "0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1";

/** PriceMath is an external library, so every consumer has to link it. */
async function linkedFactories() {
  const priceMath = await (await ethers.getContractFactory("PriceMath")).deploy();
  const libraries = { PriceMath: await priceMath.getAddress() };
  return {
    RoundFactory: await ethers.getContractFactory("RoundFactory", { libraries }),
    RoundPool: await ethers.getContractFactory("RoundPool", { libraries }),
    PriceMathHarness: await ethers.getContractFactory("PriceMathHarness", { libraries }),
  };
}

/** Deploy a full round via the factory. */
async function createRound(overrides = {}) {
  const [deployer] = await ethers.getSigners();
  const lockerFactory = await (await ethers.getContractFactory("LockerFactory")).deploy();
  const { RoundFactory } = await linkedFactories();
  const factory = await RoundFactory.deploy(
    overrides.positionManager ?? V4.positionManager,
    V4.permit2,
    await lockerFactory.getAddress(),
    PROTOCOL_WALLET,
    3_000,
  );
  const t = await now();
  const params = {
    name: "Block Party",
    symbol: "BLOCK",
    totalSupply: E(1_000_000),
    queueClosesAt: t + 100,
    endTime: t + 1000,
    auctionMaxRaiseWei: E(50),
    auctionFeeBps: 0,
    tradeFeeBps: 100,
    mcapTargetWei: 0,
    graduationMcapWei: E(400),
    graduationMinVolumeWei: E(200),
    graduationMinHolders: 10,
    feeRecipient: deployer.address,
    creator: deployer.address,
    feeDestination: ethers.ZeroAddress, // defaults to the creator
    ...overrides,
  };
  delete params.liquidity;
  delete params.positionManager;
  await (await factory.createRound(params, { value: overrides.liquidity ?? E(100) })).wait();
  const r = await factory.rounds(0);
  return {
    factory,
    params,
    token: await ethers.getContractAt("ArenaToken", r.token),
    pool: await ethers.getContractAt("RoundPool", r.pool),
    auction: await ethers.getContractAt("BatchAuction", r.auction),
    locker: await ethers.getContractAt("CookoutLpLocker", r.locker),
    splitter: await ethers.getContractAt("FeeSplitter", r.feeSplitter),
  };
}

const hasFn = (contract, name) => {
  try {
    return contract.interface.getFunction(name) !== null;
  } catch {
    return false;
  }
};

const rel = (a, b) => {
  const diff = a > b ? a - b : b - a;
  if (b === 0n) return diff === 0n ? 0 : 1;
  return Number((diff * 10n ** 12n) / b) / 1e12;
};

describe("ArenaToken", () => {
  it("fixed supply, no owner functions, tracks holder count", async () => {
    const [a, b] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("ArenaToken")).deploy("T", "T", E(1000), a.address);
    expect(await token.totalSupply()).to.equal(E(1000));
    expect(await token.holderCount()).to.equal(1n);
    await token.transfer(b.address, E(10));
    expect(await token.holderCount()).to.equal(2n);
    await token.connect(b).transfer(a.address, E(10));
    expect(await token.holderCount()).to.equal(1n);
    expect(hasFn(token, "mint")).to.equal(false);
    expect(hasFn(token, "pause")).to.equal(false);
    expect(hasFn(token, "blacklist")).to.equal(false);
  });
});

describe("RoundFactory parameter bounds", () => {
  /** Expect createRound to revert with `reason` for the given overrides. */
  async function expectRejected(overrides, reason) {
    const [deployer] = await ethers.getSigners();
    const lockerFactory = await (await ethers.getContractFactory("LockerFactory")).deploy();
    const factory = await (await linkedFactories()).RoundFactory.deploy(
      V4.positionManager,
      V4.permit2,
      await lockerFactory.getAddress(),
      PROTOCOL_WALLET,
      3_000,
    );
    const t = await now();
    const params = {
      name: "Honeypot",
      symbol: "TRAP",
      totalSupply: E(1_000_000),
      queueClosesAt: t + 100,
      endTime: t + 1000,
      auctionMaxRaiseWei: E(50),
      auctionFeeBps: 0,
      tradeFeeBps: 100,
      mcapTargetWei: 0,
      graduationMcapWei: E(400),
      graduationMinVolumeWei: E(200),
      graduationMinHolders: 10,
      feeRecipient: deployer.address,
      creator: deployer.address,
      feeDestination: ethers.ZeroAddress,
      ...overrides,
    };
    await expect(factory.createRound(params, { value: E(100) })).to.be.revertedWithCustomError(
      factory,
      reason,
    );
  }

  it("rejects honeypot trade fees above MAX_FEE_BPS", async () => {
    await expectRejected({ tradeFeeBps: 501 }, "FeeTooHigh");
    await expectRejected({ tradeFeeBps: 9999 }, "FeeTooHigh");
  });

  it("rejects auction fees above MAX_FEE_BPS", async () => {
    await expectRejected({ auctionFeeBps: 501 }, "FeeTooHigh");
  });

  it("rejects out-of-bounds supply and zero fee recipient", async () => {
    await expectRejected({ totalSupply: 0n }, "BadSupply");
    await expectRejected({ totalSupply: 10n ** 18n - 1n }, "BadSupply"); // dust-reserve pathologies
    await expectRejected({ totalSupply: 10n ** 33n + 1n }, "BadSupply"); // k-overflow headroom
    await expectRejected({ feeRecipient: ethers.ZeroAddress }, "BadFeeRecipient");
  });

  it("accepts supply exactly at the bounds", async () => {
    await createRound({ totalSupply: 10n ** 18n });
    await createRound({ totalSupply: 10n ** 33n });
  });

  it("rejects degenerate schedules", async () => {
    const t = await now();
    await expectRejected({ queueClosesAt: t - 10 }, "QueueClosesInPast");
    await expectRejected({ queueClosesAt: t + 500, endTime: t + 400 }, "EndsBeforeQueueCloses");
  });

  it("accepts fees exactly at MAX_FEE_BPS", async () => {
    const { pool } = await createRound({ tradeFeeBps: 500, auctionFeeBps: 500 });
    expect(await pool.tradeFeeBps()).to.equal(500n);
  });
});

describe("BatchAuction guards (2026-07 audit follow-ups)", () => {
  it("submit: rejects dust intents below MIN_INTENT_WEI", async () => {
    const [, alice] = await ethers.getSigners();
    const { auction } = await createRound();
    const min = await auction.MIN_INTENT_WEI();
    await expect(auction.connect(alice).submit(0, { value: min - 1n })).to.be.revertedWith("value");
    await expect(auction.connect(alice).submit(0, { value: min })).to.emit(
      auction,
      "IntentSubmitted",
    );
  });

  it("settle: zero-token sentinel settles as zero-fill; escrow never leaves; full refunds", async () => {
    const [deployer, alice, bob] = await ethers.getSigners();
    // A pool state no honest constructor can produce: zero token reserve makes
    // _priceWadAt return its uint256.max sentinel for any raise. Before the
    // guards, market intents accepted that price and their ETH entered the
    // pool for zero tokens; now the auction must settle zero-fill instead.
    const mock = await (await ethers.getContractFactory("MockRoundPool")).deploy();
    await mock.setReserves(E(1), 0);
    const token = await (
      await ethers.getContractFactory("ArenaToken")
    ).deploy("Trap", "TRAP", E(1), deployer.address);
    const t = await now();
    const auction = await (
      await ethers.getContractFactory("BatchAuction")
    ).deploy(
      await mock.getAddress(),
      await token.getAddress(),
      t + 50,
      E(50),
      0,
      deployer.address,
    );

    await auction.connect(alice).submit(0, { value: E(2) }); // market: accepts any price
    await auction.connect(bob).submit(0, { value: E(1) });
    await mine(60);

    await expect(auction.settle()).to.emit(auction, "Settled").withArgs(0n, 0n, 0n, 0n);
    expect(await mock.receivedWei()).to.equal(0n); // no escrow reached the pool
    expect(await mock.opened()).to.equal(true); // trading still opened

    // Every intent refunds in full (Claimed: ethFilled 0, tokensOut 0, refund all).
    await expect(auction.connect(alice).claim(0))
      .to.emit(auction, "Claimed")
      .withArgs(0n, alice.address, 0n, 0n, E(2));
    await expect(auction.connect(bob).claim(1))
      .to.emit(auction, "Claimed")
      .withArgs(1n, bob.address, 0n, 0n, E(1));
    expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(0n);
  });
});

describe("Round lifecycle on-chain", () => {
  it("auction → uniform fills → live trading → timer end → uniform redemption", async () => {
    const [, alice, bob, carol, rando] = await ethers.getSigners();
    const { token, pool, auction } = await createRound();

    // Queue: alice 2 ETH market, bob 1 ETH market, carol 1 ETH with a limit
    // just above spot (will be excluded by the clearing price).
    await auction.connect(alice).submit(0, { value: E(2) });
    await auction.connect(bob).submit(0, { value: E(1) });
    const spotWad = (E(100) * WAD) / E(1_000_000);
    await auction.connect(carol).submit(spotWad + 1n, { value: E(1) });

    await expect(auction.connect(rando).settle()).to.be.revertedWith("not closed");
    await mine(150);
    await auction.connect(rando).settle(); // permissionless settlement
    expect(await auction.settled()).to.equal(true);

    const clearing = await auction.clearingPriceWad();
    expect(clearing).to.be.gt(spotWad);

    // Claims: uniform price, carol fully refunded.
    const before = await ethers.provider.getBalance(carol.address);
    await auction.connect(carol).claim(2);
    const after = await ethers.provider.getBalance(carol.address);
    expect(after - before).to.be.closeTo(E(1), E(0.001)); // minus gas
    expect(await token.balanceOf(carol.address)).to.equal(0n);

    await auction.connect(alice).claim(0);
    await auction.connect(bob).claim(1);
    const aTok = await token.balanceOf(alice.address);
    const bTok = await token.balanceOf(bob.address);
    expect(rel(aTok, bTok * 2n)).to.be.lt(1e-9); // proportional to committed ETH
    // price check: tokens * clearing ≈ ethFilled
    expect(rel((aTok * clearing) / WAD, E(2))).to.be.lt(1e-6);

    // Continuous trading now open.
    await pool.connect(bob).buy(0, { value: E(3) });
    const bobTokens = await token.balanceOf(bob.address);
    await token.connect(bob).approve(await pool.getAddress(), bobTokens);
    await pool.connect(bob).sell(bobTokens / 2n, 0);

    // No liquidity-withdrawal surface exists.
    expect(hasFn(pool, "withdraw")).to.equal(false);
    expect(hasFn(pool, "skim")).to.equal(false);
    expect(hasFn(pool, "removeLiquidity")).to.equal(false);

    // Timer end → permissionless resolve → redemption (criteria not met).
    await expect(pool.connect(rando).resolve()).to.be.revertedWith("round not over");
    await mine(1000);
    await pool.connect(rando).resolve();
    expect(await pool.phase()).to.equal(3n); // Redeem
    await expect(pool.connect(bob).buy(0, { value: E(1) })).to.be.revertedWith("not trading");

    // Uniform redemption: same price per token for everyone.
    const priceWad = await pool.redemptionPriceWad();
    expect(priceWad).to.be.gt(0n);
    const aliceTokens = await token.balanceOf(alice.address);
    await token.connect(alice).approve(await pool.getAddress(), aliceTokens);
    const balBefore = await ethers.provider.getBalance(alice.address);
    await pool.connect(alice).redeem(aliceTokens);
    const got = (await ethers.provider.getBalance(alice.address)) - balBefore;
    expect(rel(got, (aliceTokens * priceWad) / WAD)).to.be.lt(1e-3); // gas noise
  });

  it("graduation: criteria met keeps the pool trading forever", async () => {
    const [deployer, alice, bob] = await ethers.getSigners();
    const { pool, auction, token } = await createRound({
      graduationMcapWei: E(150),
      graduationMinVolumeWei: E(10),
      graduationMinHolders: 2,
      liquidity: E(100),
    });
    await auction.connect(alice).submit(0, { value: E(10) });
    await mine(150);
    await auction.settle();
    await auction.connect(alice).claim(0);
    await pool.connect(bob).buy(0, { value: E(30) }); // pump mcap past 150
    await mine(1000);
    await pool.resolve();
    expect(await pool.phase()).to.equal(2n); // Graduated
    // Arena Alumni: trading continues indefinitely.
    await pool.connect(bob).buy(0, { value: E(1) });
    await expect(pool.connect(bob).redeem(1n)).to.be.revertedWith("not redeeming");
    void deployer;
    void token;
  });

  it("fees accrue and only flow to the published recipient", async () => {
    const [deployer, alice] = await ethers.getSigners();
    const { pool, auction } = await createRound({ tradeFeeBps: 100 });
    await auction.connect(alice).submit(0, { value: E(5) });
    await mine(150);
    await auction.settle();
    await pool.connect(alice).buy(0, { value: E(10) });
    const fees = await pool.feesAccrued();
    expect(fees).to.equal(E(0.1)); // 1% of 10
    const before = await ethers.provider.getBalance(deployer.address);
    await pool.connect(alice).claimFees();
    const after = await ethers.provider.getBalance(deployer.address);
    expect(after - before).to.equal(fees);
  });

  it("cancel refunds escrow before close", async () => {
    const [, alice] = await ethers.getSigners();
    const { auction } = await createRound();
    await auction.connect(alice).submit(0, { value: E(2) });
    const before = await ethers.provider.getBalance(alice.address);
    await auction.connect(alice).cancel(0);
    const after = await ethers.provider.getBalance(alice.address);
    expect(after - before).to.be.closeTo(E(2), E(0.001));
    await mine(150);
    await auction.settle();
    expect(await auction.totalRaisedWei()).to.equal(0n);
  });
});

describe("Differential: Solidity settlement matches the TS reference", () => {
  for (const v of vectors) {
    it(v.name, async () => {
      const signers = await ethers.getSigners();
      const { auction } = await createRound({
        totalSupply: E(v.pool.token),
        liquidity: E(v.pool.eth),
        auctionMaxRaiseWei: E(v.maxRaise),
        auctionFeeBps: v.feeBps,
      });
      for (let i = 0; i < v.intents.length; i++) {
        const it = v.intents[i];
        const maxPriceWad = it.maxPrice ? ethers.parseEther(it.maxPrice.toFixed(18)) : 0n;
        await auction.connect(signers[i + 1]).submit(maxPriceWad, { value: E(it.amount) });
      }
      await mine(150);
      await auction.settle();

      const raised = await auction.totalRaisedWei();
      expect(rel(raised, E(v.expected.totalRaised))).to.be.lt(1e-6, "totalRaised");
      if (v.expected.totalRaised > 0) {
        const clearing = await auction.clearingPriceWad();
        expect(rel(clearing, ethers.parseEther(v.expected.clearingPrice.toFixed(18)))).to.be.lt(
          1e-6,
          "clearingPrice",
        );
        for (let i = 0; i < v.intents.length; i++) {
          const tx = await auction.connect(signers[i + 1]).claim(i);
          const rc = await tx.wait();
          const ev = rc.logs
            .map((l) => {
              try {
                return auction.interface.parseLog(l);
              } catch {
                return null;
              }
            })
            .find((p) => p?.name === "Claimed");
          const exp = v.expected.fills[i];
          expect(rel(ev.args.ethFilled, E(exp.ethFilled))).to.be.lt(1e-6, `fill ${i} eth`);
          expect(rel(ev.args.tokensOut, E(exp.tokensOut))).to.be.lt(1e-6, `fill ${i} tokens`);
        }
      }
    });
  }
});

/**
 * The client sends a minimum-out with every trade, computed from
 * quoteBuyWei/quoteSellWei in packages/shared. If those drift from the pool by
 * even one wei, the floor either reverts honest trades or stops protecting
 * them. So this asserts exact equality against the deployed contract — no
 * tolerance, unlike the auction vectors above, whose reference is float math.
 */
describe("Differential: TS trade quotes match the pool exactly", () => {
  const quoteVectors = require("./quote-vectors.json");
  const toWei = (n) => (BigInt(Math.round(n * 1e6)) * 10n ** 12n);

  /** A pool sitting at exactly the vector's reserves, open for trading. */
  async function poolAt(reserves, feeBps, extraTokensForSeller = 0n) {
    const [deployer, trader] = await ethers.getSigners();
    const tokenReserve = toWei(reserves.token);
    const token = await (await ethers.getContractFactory("ArenaToken")).deploy(
      "Quote", "QTE", tokenReserve + extraTokensForSeller, deployer.address,
    );
    const pool = await (await linkedFactories()).RoundPool.deploy(
      await token.getAddress(),
      deployer.address,
      feeBps,
      (await now()) + 86_400,
      0n,                      // no mcap target — nothing auto-resolves mid-test
      ethers.MaxUint256,       // graduation unreachable
      ethers.MaxUint256,
      ethers.MaxUint256,
      V4.positionManager,
      V4.permit2,
      ethers.ZeroAddress, // no locker: these tests never migrate
    );
    await pool.initAuction(deployer.address); // the deployer stands in for the auction
    await token.transfer(await pool.getAddress(), tokenReserve);
    await pool.initialize({ value: toWei(reserves.eth) });
    await pool.auctionBuy({ value: 0 }); // zero-value open: reserves unchanged
    if (extraTokensForSeller > 0n) await token.transfer(trader.address, extraTokensForSeller);
    return { pool, token, trader };
  }

  for (const v of quoteVectors.filter((q) => q.side === "buy")) {
    it(v.name, async () => {
      const { pool, trader } = await poolAt(v.reserves, v.feeBps);
      const out = await pool.connect(trader).buy.staticCall(0, { value: BigInt(v.amount) });
      expect(out).to.equal(BigInt(v.expected));
    });
  }

  for (const v of quoteVectors.filter((q) => q.side === "sell")) {
    it(v.name, async () => {
      const amount = BigInt(v.amount);
      const { pool, token, trader } = await poolAt(v.reserves, v.feeBps, amount);
      await token.connect(trader).approve(await pool.getAddress(), amount);
      const out = await pool.connect(trader).sell.staticCall(amount, 0);
      expect(out).to.equal(BigInt(v.expected));
    });
  }

  it("a minimum-out one wei above the true output reverts", async () => {
    const { pool, trader } = await poolAt({ eth: 100, token: 1_000_000 }, 100);
    const value = ethers.parseEther("1");
    const out = await pool.connect(trader).buy.staticCall(0, { value });
    await expect(pool.connect(trader).buy(out + 1n, { value })).to.be.revertedWith("slippage");
    await expect(pool.connect(trader).buy(out, { value })).to.not.be.reverted;
  });
});

describe("FeeSplitter — graduated-pool fee routing", () => {
  const PROTOCOL = "0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1";

  async function deploySplitter(protocolBps = 3_000) {
    const [, creator] = await ethers.getSigners();
    const splitter = await (await ethers.getContractFactory("FeeSplitter")).deploy(
      creator.address, PROTOCOL, protocolBps,
    );
    return { splitter, creator };
  }

  it("splits ETH by the immutable bps and pays each side once", async () => {
    const [payer, creator] = await ethers.getSigners();
    const { splitter } = await deploySplitter(3_000);
    await payer.sendTransaction({ to: await splitter.getAddress(), value: E(10) });

    expect(await splitter.pendingEth(PROTOCOL)).to.equal(E(3));
    expect(await splitter.pendingEth(creator.address)).to.equal(E(7));

    await expect(splitter.releaseEth(PROTOCOL)).to.changeEtherBalance(PROTOCOL, E(3));
    expect(await splitter.pendingEth(PROTOCOL)).to.equal(0n);
    // Draining twice is the classic splitter bug; the second call has nothing owed.
    await expect(splitter.releaseEth(PROTOCOL)).to.be.revertedWithCustomError(
      splitter, "NothingOwed",
    );
  });

  it("keeps accounting straight when fees arrive in several waves", async () => {
    const [payer, creator] = await ethers.getSigners();
    const { splitter } = await deploySplitter(3_000);
    const addr = await splitter.getAddress();

    await payer.sendTransaction({ to: addr, value: E(10) });
    await splitter.releaseEth(creator.address); // takes 7
    await payer.sendTransaction({ to: addr, value: E(10) });

    // Lifetime-based accounting: 20 total, creator owed 14, already took 7.
    expect(await splitter.pendingEth(creator.address)).to.equal(E(7));
    expect(await splitter.pendingEth(PROTOCOL)).to.equal(E(6));
  });

  it("pays nobody but the two named recipients", async () => {
    const [, , stranger] = await ethers.getSigners();
    const { splitter } = await deploySplitter();
    await expect(splitter.pendingEth(stranger.address)).to.be.revertedWithCustomError(
      splitter, "NotARecipient",
    );
  });

  it("splits the round token too — fees arrive in both pool currencies", async () => {
    const [deployer, creator] = await ethers.getSigners();
    const { splitter } = await deploySplitter(3_000);
    const token = await (await ethers.getContractFactory("ArenaToken")).deploy(
      "Fee", "FEE", E(1_000), deployer.address,
    );
    await token.transfer(await splitter.getAddress(), E(1_000));

    const t = await token.getAddress();
    expect(await splitter.pendingToken(t, PROTOCOL)).to.equal(E(300));
    await splitter.releaseToken(t, creator.address);
    expect(await token.balanceOf(creator.address)).to.equal(E(700));
  });

  it("a creator address that rejects ETH cannot strand the protocol's fees", async () => {
    // The creator address is arbitrary user input from the launch form. If a
    // push-both design were used, a contract that reverts on receive would take
    // the protocol's fees down with it.
    const [payer] = await ethers.getSigners();
    const rejector = await (await ethers.getContractFactory("LockerFactory")).deploy(); // no receive()
    const splitter = await (await ethers.getContractFactory("FeeSplitter")).deploy(
      await rejector.getAddress(), PROTOCOL, 3_000,
    );
    await payer.sendTransaction({ to: await splitter.getAddress(), value: E(10) });

    await expect(splitter.releaseEth(await rejector.getAddress())).to.be.revertedWithCustomError(
      splitter, "TransferFailed",
    );
    await expect(splitter.releaseEth(PROTOCOL)).to.changeEtherBalance(PROTOCOL, E(3));
  });

  it("refuses a configuration that would burn fees forever", async () => {
    const [, creator] = await ethers.getSigners();
    const F = await ethers.getContractFactory("FeeSplitter");
    await expect(F.deploy(ethers.ZeroAddress, PROTOCOL, 3_000)).to.be.revertedWithCustomError(
      F, "BadRecipient",
    );
    await expect(F.deploy(creator.address, ethers.ZeroAddress, 3_000)).to.be.revertedWithCustomError(
      F, "BadRecipient",
    );
    await expect(F.deploy(creator.address, PROTOCOL, 10_001)).to.be.revertedWithCustomError(
      F, "BadSplit",
    );
  });

  it("has no owner, setter, or escape hatch", async () => {
    const { splitter } = await deploySplitter();
    const names = splitter.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.name);
    for (const forbidden of ["owner", "setFeeRecipient", "transferOwnership", "withdraw", "execute"])
      expect(names).to.not.include(forbidden);
  });
});

describe("CookoutLpLocker — permanent liquidity", () => {
  const CURRENCY0 = "0x0000000000000000000000000000000000000000"; // native ETH
  const CURRENCY1 = "0x1111111111111111111111111111111111111111";

  async function deployLocker() {
    const [, , splitter] = await ethers.getSigners();
    const posm = await (await ethers.getContractFactory("MockPositionManager")).deploy();
    await posm.setPoolKey(CURRENCY0, CURRENCY1);
    const locker = await (await ethers.getContractFactory("CookoutLpLocker")).deploy(
      await posm.getAddress(), splitter.address,
    );
    return { posm, locker, splitter };
  }

  it("collects fees by decreasing liquidity by exactly zero", async () => {
    const { posm, locker, splitter } = await deployLocker();
    await locker.collectFees(42);

    const [actions, tokenId, liquidity, payee] = await posm.decodeLast();
    expect(actions).to.equal("0x0111"); // DECREASE_LIQUIDITY, TAKE_PAIR
    expect(tokenId).to.equal(42n);
    // The whole safety argument in one assertion: zero liquidity means the
    // call settles fee deltas and cannot touch the principal.
    expect(liquidity).to.equal(0n);
    expect(payee).to.equal(splitter.address);
  });

  it("lets anyone trigger a collection, but only ever to the fixed payee", async () => {
    const { posm, locker, splitter } = await deployLocker();
    const [, , , stranger] = await ethers.getSigners();
    await locker.connect(stranger).collectFees(7);
    const [, , , payee] = await posm.decodeLast();
    expect(payee).to.equal(splitter.address);
  });

  it("has no way to move, approve, or unwind the position", async () => {
    const { locker } = await deployLocker();
    const names = locker.interface.fragments
      .filter((f) => f.type === "function")
      .map((f) => f.name);
    // Uniswap's own PositionFeesForwarder ships approveOperator(), which after
    // a timelock hands an operator blanket approval over the NFT. The point of
    // this contract is that no such function exists to reason about.
    for (const forbidden of [
      "approveOperator", "setApprovalForAll", "approve", "transferFrom",
      "safeTransferFrom", "owner", "transferOwnership", "withdraw", "execute",
      "multicall", "decreaseLiquidity", "burn",
    ])
      expect(names, `must not expose ${forbidden}`).to.not.include(forbidden);
    expect(names).to.have.members(["positionManager", "feeRecipient", "collectFees", "onERC721Received"]);
  });

  it("accepts positions only from the position manager", async () => {
    const { posm, locker } = await deployLocker();
    const [, , , stranger] = await ethers.getSigners();
    // An unrelated NFT sent here would be stuck forever with no way out.
    await expect(
      locker.connect(stranger).onERC721Received(stranger.address, stranger.address, 1, "0x"),
    ).to.be.revertedWithCustomError(locker, "NotThePositionManager");
    await expect(posm.sendPositionTo(await locker.getAddress(), 1)).to.not.be.reverted;
  });

  it("refuses a configuration that would send fees nowhere", async () => {
    const [, , splitter] = await ethers.getSigners();
    const posm = await (await ethers.getContractFactory("MockPositionManager")).deploy();
    const L = await ethers.getContractFactory("CookoutLpLocker");
    await expect(L.deploy(await posm.getAddress(), ethers.ZeroAddress))
      .to.be.revertedWithCustomError(L, "BadRecipient");
    await expect(L.deploy(ethers.ZeroAddress, splitter.address))
      .to.be.revertedWithCustomError(L, "BadRecipient");
  });

  it("routes a graduated coin's fees all the way to creator and protocol", async () => {
    // End to end: locker → splitter → both recipients.
    const [payer, creator] = await ethers.getSigners();
    const PROTOCOL = "0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1";
    const splitter = await (await ethers.getContractFactory("FeeSplitter")).deploy(
      creator.address, PROTOCOL, 3_000,
    );
    const posm = await (await ethers.getContractFactory("MockPositionManager")).deploy();
    await posm.setPoolKey(CURRENCY0, CURRENCY1);
    const locker = await (await ethers.getContractFactory("CookoutLpLocker")).deploy(
      await posm.getAddress(), await splitter.getAddress(),
    );

    const [, , , payee] = await (async () => {
      await locker.collectFees(1);
      return posm.decodeLast();
    })();
    expect(payee).to.equal(await splitter.getAddress());

    // Simulate the pool paying that collection out.
    await payer.sendTransaction({ to: await splitter.getAddress(), value: E(10) });
    await expect(splitter.releaseEth(PROTOCOL)).to.changeEtherBalance(PROTOCOL, E(3));
    await expect(splitter.releaseEth(creator.address)).to.changeEtherBalance(creator, E(7));
  });
});

describe("BatchAuction queue bounds", () => {
  it("merges a top-up instead of taking another queue slot", async () => {
    const { auction } = await createRound();
    const [, alice] = await ethers.getSigners();
    await auction.connect(alice).submit(0, { value: E(2) });
    await auction.connect(alice).submit(0, { value: E(3) });

    expect(await auction.intentCount()).to.equal(1n);
    const it = await auction.intents(0);
    expect(it.amount).to.equal(E(5));
  });

  it("keeps different limit prices as separate intents", async () => {
    const { auction } = await createRound();
    const [, alice] = await ethers.getSigners();
    await auction.connect(alice).submit(0, { value: E(1) });
    await auction.connect(alice).submit(10n ** 15n, { value: E(1) });
    expect(await auction.intentCount()).to.equal(2n);
  });

  it("a cancel frees the slot so the bidder can come back", async () => {
    const { auction } = await createRound();
    const [, alice] = await ethers.getSigners();
    await auction.connect(alice).submit(0, { value: E(2) });
    await auction.connect(alice).cancel(0);
    // Without clearing the merge index this would top up the cancelled intent
    // and strand the ETH behind its claimed flag.
    await auction.connect(alice).submit(0, { value: E(1) });
    expect(await auction.intentCount()).to.equal(2n);
    const fresh = await auction.intents(1);
    expect(fresh.amount).to.equal(E(1));
    expect(fresh.claimed).to.equal(false);
  });

  it("merged demand clears the same as separate intents would", async () => {
    // The merge must not change the auction's outcome, only its storage.
    const a = await createRound();
    const b = await createRound();
    const [, alice, bob] = await ethers.getSigners();

    await a.auction.connect(alice).submit(0, { value: E(3) });
    await a.auction.connect(alice).submit(0, { value: E(2) }); // merges to 5
    await a.auction.connect(bob).submit(0, { value: E(4) });

    await b.auction.connect(alice).submit(0, { value: E(5) });
    await b.auction.connect(bob).submit(0, { value: E(4) });

    await mine(4000);
    await a.auction.settle();
    await b.auction.settle();
    expect(await a.auction.clearingPriceWad()).to.equal(await b.auction.clearingPriceWad());
    expect(await a.auction.totalRaisedWei()).to.equal(await b.auction.totalRaisedWei());
  });

  it("caps the queue so settlement can never be priced out of reach", async () => {
    // Escrow that cannot settle is escrow that cannot refund, so the bound is
    // a solvency property. MAX_INTENTS is sized from measured settle gas.
    const { auction } = await createRound();
    expect(await auction.MAX_INTENTS()).to.equal(1_000n);
  });
});

describe("ArenaToken holder counting", () => {
  async function token(supply = E(10_000)) {
    const [deployer] = await ethers.getSigners();
    return (await ethers.getContractFactory("ArenaToken")).deploy("Hold", "HLD", supply, deployer.address);
  }

  it("ignores dust, so holders cannot be sprayed into existence", async () => {
    const [deployer, a, b, c] = await ethers.getSigners();
    const t = await token(E(10_000));
    expect(await t.minHolderBalance()).to.equal(E(1)); // 1bp of supply
    expect(await t.holderCount()).to.equal(1n);

    // The old rule counted any nonzero balance: three transfers of 1 wei used
    // to buy three holders for gas alone.
    for (const who of [a, b, c]) await t.transfer(who.address, 1n);
    expect(await t.holderCount()).to.equal(1n);

    await t.transfer(a.address, E(1));
    expect(await t.holderCount()).to.equal(2n);
  });

  it("stops counting an address once it drops below the floor", async () => {
    const [deployer, a] = await ethers.getSigners();
    const t = await token(E(10_000));
    await t.transfer(a.address, E(5));
    expect(await t.holderCount()).to.equal(2n);

    // Leaves dust behind — a holder by the old rule, not by this one.
    await t.connect(a).transfer(deployer.address, E(5) - 1n);
    expect(await t.holderCount()).to.equal(1n);
  });

  it("never double-counts a holder topping up", async () => {
    const [, a] = await ethers.getSigners();
    const t = await token(E(10_000));
    await t.transfer(a.address, E(2));
    await t.transfer(a.address, E(2));
    expect(await t.holderCount()).to.equal(2n);
  });

  it("keeps a floor of 1 wei for tiny-supply tokens", async () => {
    const [, a] = await ethers.getSigners();
    const t = await token(1_000n); // supply/10_000 would round to 0
    expect(await t.minHolderBalance()).to.equal(1n);
    await t.transfer(a.address, 1n);
    expect(await t.holderCount()).to.equal(2n);
  });
});

describe("PriceMath — the price a graduated coin opens at", () => {
  let m;
  const Q96 = 2n ** 96n;

  let lib;
  before(async () => {
    const priceMath = await (await ethers.getContractFactory("PriceMath")).deploy();
    lib = priceMath;
    m = await (
      await ethers.getContractFactory("PriceMathHarness", {
        libraries: { PriceMath: await priceMath.getAddress() },
      })
    ).deploy();
  });

  /** Reference sqrtPriceX96, computed in JS at full precision. */
  const expected = (r0, r1) => {
    // sqrt(r1/r0) * 2^96, via integer sqrt of (r1 << 192) / r0.
    const ratio = (r1 * (Q96 * Q96)) / r0;
    let x = ratio, y = (x + 1n) / 2n;
    while (y < x) { x = y; y = (ratio / y + y) / 2n; }
    return x;
  };

  it("prices a 1:1 pool at exactly 2^96", async () => {
    expect(await m.sqrtPriceX96FromReserves(E(1), E(1))).to.equal(Q96);
  });

  it("matches a full-precision reference across realistic reserves", async () => {
    const cases = [
      [E(100), E(1_000_000)],   // a typical seeded round
      [E(1), E(1_000_000)],     // thin ETH side
      [E(500), E(21_000_000)],  // large supply
      [E(3), E(42)],            // small and awkward
    ];
    for (const [r0, r1] of cases) {
      const got = await m.sqrtPriceX96FromReserves(r0, r1);
      const want = expected(r0, r1);
      // The 2^48 split costs about half a bit; assert it costs no more than
      // that, since the error lands directly in the opening price.
      const drift = got > want ? got - want : want - got;
      expect(drift * 10n ** 12n / want, `${r0}/${r1}`).to.be.lessThan(10n);
    }
  });

  it("price rises with the token side and falls with the ETH side", async () => {
    const base = await m.sqrtPriceX96FromReserves(E(100), E(1_000_000));
    expect(await m.sqrtPriceX96FromReserves(E(100), E(2_000_000))).to.be.greaterThan(base);
    expect(await m.sqrtPriceX96FromReserves(E(200), E(1_000_000))).to.be.lessThan(base);
  });

  it("refuses a degenerate pool rather than opening one at a nonsense price", async () => {
    await expect(m.sqrtPriceX96FromReserves(0, E(1))).to.be.revertedWithCustomError(lib, "ZeroReserve");
    await expect(m.sqrtPriceX96FromReserves(E(1), 0)).to.be.revertedWithCustomError(lib, "ZeroReserve");
    // Ratios v4 itself cannot represent. Both are far outside anything the
    // factory's supply bounds allow — the guard exists so a malformed pool
    // fails by name rather than deep inside the PoolManager.
    await expect(m.sqrtPriceX96FromReserves(1n, 10n ** 40n))
      .to.be.revertedWithCustomError(lib, "PriceOutOfRange");
    await expect(m.sqrtPriceX96FromReserves(10n ** 30n, 1n))
      .to.be.revertedWithCustomError(lib, "PriceOutOfRange");
  });

  it("mulDiv keeps full precision where a plain multiply would overflow", async () => {
    const big = 2n ** 200n;
    expect(await m.mulDiv(big, Q96, big)).to.equal(Q96);
    expect(await m.mulDiv(ethers.MaxUint256, 1n, 2n)).to.equal(ethers.MaxUint256 / 2n);
  });

  it("liquidity is bounded by whichever side runs out first", async () => {
    const p = await m.sqrtPriceX96FromReserves(E(100), E(1_000_000));
    const balanced = await m.fullRangeLiquidity(p, E(100), E(1_000_000));
    // The two sides agree on the value and differ in its last few wei: one
    // divides by (sqrtB − p), the other by (p − sqrtA). Asserting exact
    // equality anywhere here would be asserting a coincidence.
    const close = (a, b) => {
      const drift = a > b ? a - b : b - a;
      expect(drift * 10n ** 12n / b).to.be.lessThan(10n);
    };

    // Surplus on either side cannot mint more liquidity — the short side is
    // the binding constraint, and minting past it would need funds the pool
    // doesn't hold.
    close(await m.fullRangeLiquidity(p, E(100), E(10_000_000)), balanced);
    close(await m.fullRangeLiquidity(p, E(200), E(1_000_000)), balanced);

    // Doubling both sides does double it, which is the property that matters:
    // liquidity tracks the size of the pool being migrated.
    close(await m.fullRangeLiquidity(p, E(200), E(2_000_000)), balanced * 2n);
  });
});

describe("PitPool — real money on a simulated match", () => {
  const GRADUATE = 1, RUG = 2, TIMER = 3;

  async function pool({ feeBps = 500, closeIn = 100, refundIn = 10_000 } = {}) {
    const [house, feeTo, a, b, c] = await ethers.getSigners();
    const t = await now();
    const p = await (await ethers.getContractFactory("PitPool")).deploy(
      house.address, feeTo.address, feeBps, t + closeIn, t + refundIn,
    );
    return { p, house, feeTo, a, b, c };
  }

  it("pays winners pro-rata and nobody else", async () => {
    const { p, house, a, b, c } = await pool({ feeBps: 0 });
    await p.connect(a).stake(GRADUATE, { value: E(3) });
    await p.connect(b).stake(GRADUATE, { value: E(1) });
    await p.connect(c).stake(RUG, { value: E(4) });

    await mine(200);
    await p.connect(house).resolve(GRADUATE);

    // 8 ETH pot, split 3:1 between the two who called it right.
    expect(await p.pending(a.address)).to.equal(E(6));
    expect(await p.pending(b.address)).to.equal(E(2));
    expect(await p.pending(c.address)).to.equal(0n);
    await expect(p.connect(a).claim()).to.changeEtherBalance(a, E(6));
    await expect(p.connect(c).claim()).to.be.revertedWithCustomError(p, "NothingToClaim");
    await expect(p.connect(a).claim()).to.be.revertedWithCustomError(p, "AlreadyClaimed");
  });

  it("takes its fee once, capped, and only to the fixed recipient", async () => {
    const { p, house, feeTo, a } = await pool({ feeBps: 500 });
    await p.connect(a).stake(TIMER, { value: E(10) });
    await mine(200);
    await expect(p.connect(house).resolve(TIMER)).to.changeEtherBalance(feeTo, E(0.5));
    expect(await p.pending(a.address)).to.equal(E(9.5));

    const F = await ethers.getContractFactory("PitPool");
    const t = await now();
    await expect(F.deploy(house.address, feeTo.address, 1_001, t + 100, t + 200))
      .to.be.revertedWithCustomError(F, "BadConfig");
  });

  it("refuses to let the operator keep the pot by never resolving", async () => {
    // The whole point of the refund window: a silent operator can delay
    // payment, never take it.
    const { p, a, b } = await pool({ closeIn: 100, refundIn: 1_000 });
    await p.connect(a).stake(RUG, { value: E(2) });
    await p.connect(b).stake(GRADUATE, { value: E(1) });

    await mine(200);
    await expect(p.connect(a).openRefunds()).to.be.revertedWithCustomError(p, "TooEarly");

    await mine(1_000);
    // Permissionless: it does not depend on the operator being alive.
    await p.connect(b).openRefunds();
    await expect(p.connect(a).refund()).to.changeEtherBalance(a, E(2));
    await expect(p.connect(b).refund()).to.changeEtherBalance(b, E(1));
    expect(await ethers.provider.getBalance(await p.getAddress())).to.equal(0n);
  });

  it("refunds everyone, fee-free, when nobody backed the winner", async () => {
    const { p, house, feeTo, a } = await pool({ feeBps: 500 });
    await p.connect(a).stake(RUG, { value: E(5) });
    await mine(200);
    // The house does not get to keep a pot it did not win.
    await expect(p.connect(house).resolve(GRADUATE)).to.changeEtherBalance(feeTo, 0n);
    expect(await p.refunding()).to.equal(true);
    await expect(p.connect(a).refund()).to.changeEtherBalance(a, E(5));
  });

  it("only the resolver resolves, once, and not before close", async () => {
    const { p, house, a } = await pool();
    await p.connect(a).stake(TIMER, { value: E(1) });
    await expect(p.connect(house).resolve(TIMER)).to.be.revertedWithCustomError(p, "NotClosed");
    await mine(200);
    await expect(p.connect(a).resolve(TIMER)).to.be.revertedWithCustomError(p, "NotResolver");
    await p.connect(house).resolve(TIMER);
    // No re-resolving after seeing who claimed.
    await expect(p.connect(house).resolve(RUG)).to.be.revertedWithCustomError(p, "AlreadyResolved");
  });

  it("closes staking on time and refuses an unresolved outcome", async () => {
    const { p, house, a } = await pool();
    await p.connect(a).stake(GRADUATE, { value: E(1) });
    await mine(200);
    await expect(p.connect(a).stake(GRADUATE, { value: E(1) }))
      .to.be.revertedWithCustomError(p, "Closed");
    await expect(p.connect(house).resolve(0)).to.be.revertedWithCustomError(p, "BadCall");
  });

  it("has no path from the pot to the operator", async () => {
    const { p } = await pool();
    const names = p.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const forbidden of ["withdraw", "sweep", "rescue", "setResolver", "setFee", "execute", "owner"])
      expect(names, `must not expose ${forbidden}`).to.not.include(forbidden);
  });
});

describe("PitBattlePool — winner takes the pot", () => {
  async function battle({ feeBps = 500, closeIn = 100, refundIn = 10_000, entry = E(1) } = {}) {
    const [house, feeTo, a, b, c] = await ethers.getSigners();
    const t = await now();
    const p = await (await ethers.getContractFactory("PitBattlePool")).deploy(
      house.address, feeTo.address, feeBps, entry, t + closeIn, t + refundIn,
    );
    return { p, house, feeTo, a, b, c };
  }

  it("pays the whole pot to the named winner, minus the fee", async () => {
    const { p, house, feeTo, a, b, c } = await battle({ feeBps: 500, entry: E(1) });
    for (const w of [a, b, c]) await p.connect(w).enter({ value: E(1) });
    expect(await p.pot()).to.equal(E(3));
    expect(await p.entrants()).to.equal(3n);

    await mine(200);
    await expect(p.connect(house).resolve(b.address)).to.changeEtherBalance(feeTo, E(0.15));
    expect(await p.pending(b.address)).to.equal(E(2.85));
    expect(await p.pending(a.address)).to.equal(0n);
    await expect(p.connect(b).claim()).to.changeEtherBalance(b, E(2.85));
    // Losing entrants get nothing — that is what winner-take-all means.
    await expect(p.connect(a).claim()).to.be.revertedWithCustomError(p, "NotTheWinner");
    await expect(p.connect(b).claim()).to.be.revertedWithCustomError(p, "AlreadyPaid");
  });

  it("cannot name a winner who never bought in", async () => {
    // The bound that makes this a picker rather than a withdrawal function:
    // without it, one call sends the pot anywhere the operator likes.
    const { p, house, a, c } = await battle();
    await p.connect(a).enter({ value: E(1) });
    await mine(200);
    await expect(p.connect(house).resolve(c.address))
      .to.be.revertedWithCustomError(p, "NotAnEntrant");
    await expect(p.connect(house).resolve(house.address))
      .to.be.revertedWithCustomError(p, "NotAnEntrant");
    await p.connect(house).resolve(a.address);
  });

  it("everyone risks the same, which is the point of a fixed entry", async () => {
    // With a chosen buy-in, entering for a tenth of what others risked still
    // won the whole pot. A fixed entry per tier removes that outright.
    const { p, a, b } = await battle({ feeBps: 0, entry: E(1) });
    await p.connect(a).enter({ value: E(1) });
    await expect(p.connect(b).enter({ value: E(0.1) }))
      .to.be.revertedWithCustomError(p, "WrongEntryFee");
    await expect(p.connect(b).enter({ value: E(5) }))
      .to.be.revertedWithCustomError(p, "WrongEntryFee");
    // Overpaying is refused rather than refunded: an entry that quietly cost
    // more than the tier advertised breaks the same guarantee.
    await p.connect(b).enter({ value: E(1) });
    await expect(p.connect(b).enter({ value: E(1) }))
      .to.be.revertedWithCustomError(p, "AlreadyEntered");
    expect(await p.pot()).to.equal(E(2));
    expect(await p.entrants()).to.equal(2n);
  });

  it("the pot is always entrants x the entry fee", async () => {
    const { p, a, b, c } = await battle({ entry: E(0.25) });
    for (const w of [a, b, c]) await p.connect(w).enter({ value: E(0.25) });
    expect(await p.pot()).to.equal(E(0.75));
    expect(await p.entryFee()).to.equal(E(0.25));
  });

  it("returns every buy-in if the battle is never resolved", async () => {
    const { p, a, b } = await battle({ closeIn: 100, refundIn: 1_000, entry: E(2) });
    await p.connect(a).enter({ value: E(2) });
    await p.connect(b).enter({ value: E(2) });
    await mine(200);
    await expect(p.connect(a).openRefunds()).to.be.revertedWithCustomError(p, "TooEarly");

    await mine(1_000);
    await p.connect(b).openRefunds();
    await expect(p.connect(a).refund()).to.changeEtherBalance(a, E(2));
    await expect(p.connect(b).refund()).to.changeEtherBalance(b, E(2));
    await expect(p.connect(a).refund()).to.be.revertedWithCustomError(p, "AlreadyPaid");
    expect(await ethers.provider.getBalance(await p.getAddress())).to.equal(0n);
  });

  it("only the resolver resolves, once, and not before close", async () => {
    const { p, house, a, b } = await battle();
    await p.connect(a).enter({ value: E(1) });
    await p.connect(b).enter({ value: E(1) });
    await expect(p.connect(house).resolve(a.address)).to.be.revertedWithCustomError(p, "NotClosed");
    await mine(200);
    await expect(p.connect(a).resolve(a.address)).to.be.revertedWithCustomError(p, "NotResolver");
    await p.connect(house).resolve(a.address);
    // No switching the winner after the fact.
    await expect(p.connect(house).resolve(b.address))
      .to.be.revertedWithCustomError(p, "AlreadyResolved");
  });

  it("has no path from the pot to the operator", async () => {
    const { p } = await battle();
    const names = p.interface.fragments.filter((f) => f.type === "function").map((f) => f.name);
    for (const forbidden of ["withdraw", "sweep", "rescue", "setResolver", "setFee", "execute", "owner"])
      expect(names, `must not expose ${forbidden}`).to.not.include(forbidden);
  });
});

describe("PitPoolFactory", () => {
  const MATCH = ethers.id("pit-match-1");

  async function factory() {
    const [resolver, feeTo, stranger] = await ethers.getSigners();
    const f = await (await ethers.getContractFactory("PitPoolFactory")).deploy(
      resolver.address, feeTo.address,
    );
    return { f, resolver, feeTo, stranger };
  }

  it("creates both pools wired to the fixed resolver and fee recipient", async () => {
    const { f, resolver, feeTo } = await factory();
    const t = await now();
    await f.createPools(MATCH, 500, 500, E(0.01), t + 100, t + 86_500);

    const { prediction, battle } = await f.poolsFor(MATCH);
    const p = await ethers.getContractAt("PitPool", prediction);
    const b = await ethers.getContractAt("PitBattlePool", battle);
    for (const c of [p, b]) {
      expect(await c.resolver()).to.equal(resolver.address);
      expect(await c.feeRecipient()).to.equal(feeTo.address);
    }
    expect(await b.entryFee()).to.equal(E(0.01));
  });

  it("only the resolver may create pools", async () => {
    // Anyone else's pools would carry this resolver's name while escrowing
    // money for a match that does not exist.
    const { f, stranger } = await factory();
    const t = await now();
    await expect(f.connect(stranger).createPools(MATCH, 500, 500, E(0.01), t + 100, t + 86_500))
      .to.be.revertedWithCustomError(f, "NotResolver");
  });

  it("will not create a second set for the same match", async () => {
    const { f } = await factory();
    const t = await now();
    await f.createPools(MATCH, 500, 500, E(0.01), t + 100, t + 86_500);
    await expect(f.createPools(MATCH, 500, 500, E(0.01), t + 100, t + 86_500))
      .to.be.revertedWithCustomError(f, "AlreadyCreated");
  });

  it("passes the contracts' own guardrails through", async () => {
    const { f } = await factory();
    const t = await now();
    // A fee above the pools' cap, and a refund window that never opens.
    await expect(f.createPools(MATCH, 1_500, 500, E(0.01), t + 100, t + 86_500)).to.be.reverted;
    await expect(f.createPools(MATCH, 500, 500, E(0.01), t + 100, t + 50)).to.be.reverted;
    await expect(f.createPools(MATCH, 500, 500, 0, t + 100, t + 86_500)).to.be.reverted;
  });
});
