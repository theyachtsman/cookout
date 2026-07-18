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
