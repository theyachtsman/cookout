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

/** Deploy a full round via the factory. */
async function createRound(overrides = {}) {
  const [deployer] = await ethers.getSigners();
  const factory = await (await ethers.getContractFactory("RoundFactory")).deploy();
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
    ...overrides,
  };
  await (await factory.createRound(params, { value: overrides.liquidity ?? E(100) })).wait();
  const r = await factory.rounds(0);
  return {
    factory,
    params,
    token: await ethers.getContractAt("ArenaToken", r.token),
    pool: await ethers.getContractAt("RoundPool", r.pool),
    auction: await ethers.getContractAt("BatchAuction", r.auction),
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
    const factory = await (await ethers.getContractFactory("RoundFactory")).deploy();
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
      ...overrides,
    };
    await expect(factory.createRound(params, { value: E(100) })).to.be.revertedWith(reason);
  }

  it("rejects honeypot trade fees above MAX_FEE_BPS", async () => {
    await expectRejected({ tradeFeeBps: 501 }, "fee too high");
    await expectRejected({ tradeFeeBps: 9999 }, "fee too high");
  });

  it("rejects auction fees above MAX_FEE_BPS", async () => {
    await expectRejected({ auctionFeeBps: 501 }, "fee too high");
  });

  it("rejects out-of-bounds supply and zero fee recipient", async () => {
    await expectRejected({ totalSupply: 0n }, "supply");
    await expectRejected({ totalSupply: 10n ** 18n - 1n }, "supply"); // dust-reserve pathologies
    await expectRejected({ totalSupply: 10n ** 33n + 1n }, "supply"); // k-overflow headroom
    await expectRejected({ feeRecipient: ethers.ZeroAddress }, "fee recipient");
  });

  it("accepts supply exactly at the bounds", async () => {
    await createRound({ totalSupply: 10n ** 18n });
    await createRound({ totalSupply: 10n ** 33n });
  });

  it("rejects degenerate schedules", async () => {
    const t = await now();
    await expectRejected({ queueClosesAt: t - 10 }, "queue closes in past");
    await expectRejected({ queueClosesAt: t + 500, endTime: t + 400 }, "ends before queue closes");
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
    const pool = await (await ethers.getContractFactory("RoundPool")).deploy(
      await token.getAddress(),
      deployer.address,
      feeBps,
      (await now()) + 86_400,
      0n,                      // no mcap target — nothing auto-resolves mid-test
      ethers.MaxUint256,       // graduation unreachable
      ethers.MaxUint256,
      ethers.MaxUint256,
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
    const rejector = await (await ethers.getContractFactory("RoundFactory")).deploy(); // no receive()
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
