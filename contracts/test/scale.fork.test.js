/**
 * The auction at its limits, and under people trying to break it.
 *
 * Runs on a fork of 46630 rather than the live chain: filling MAX_INTENTS
 * costs 1 ETH of escrow, which the testnet operator does not have. The fork
 * keeps the real chain's state and config, so the gas numbers are real; what
 * it cannot model is an Orbit chain's L1 calldata component, which is a
 * per-transaction cost and not part of what settle()'s loop does.
 *
 *   npm run test:scale
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const V4 = {
  positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};
const PROTOCOL = "0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1";
const MIN_INTENT = E(0.001);

(process.env.FORK ? describe : describe.skip)("BatchAuction at scale", function () {
  this.timeout(15 * 60 * 1000);
  let factory, bank;

  before(async () => {
    [bank] = await ethers.getSigners();
    const priceMath = await (await ethers.getContractFactory("PriceMath")).deploy();
    const lockerFactory = await (await ethers.getContractFactory("LockerFactory")).deploy();
    factory = await (
      await ethers.getContractFactory("RoundFactory", {
        libraries: { PriceMath: await priceMath.getAddress() },
      })
    ).deploy(V4.positionManager, V4.permit2, await lockerFactory.getAddress(), PROTOCOL, 3000);
  });

  /** A fresh round whose queue stays open long enough to fill. */
  async function freshRound(overrides = {}) {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await (
      await factory.createRound(
        {
          name: "Scale", symbol: "SCALE", totalSupply: E(1_000_000),
          queueClosesAt: now + 100_000, endTime: now + 200_000,
          auctionMaxRaiseWei: E(1), auctionFeeBps: 0, tradeFeeBps: 100,
          mcapTargetWei: 0, graduationMcapWei: ethers.MaxUint256,
          graduationMinVolumeWei: ethers.MaxUint256, graduationMinHolders: ethers.MaxUint256,
          feeRecipient: bank.address, creator: bank.address,
          feeDestination: ethers.ZeroAddress,
          ...overrides,
        },
        { value: E(100) },
      )
    ).wait();
    const r = await factory.rounds((await factory.roundCount()) - 1n);
    return {
      auction: await ethers.getContractAt("BatchAuction", r.auction),
      pool: await ethers.getContractAt("RoundPool", r.pool),
    };
  }

  /** `count` funded wallets, spread over `perWallet` distinct limit prices. */
  async function crowd(count) {
    const wallets = [];
    for (let i = 0; i < count; i++) {
      const w = new ethers.Wallet(
        ethers.keccak256(ethers.toUtf8Bytes(`scale-${i}`)), ethers.provider);
      await ethers.provider.send("hardhat_setBalance", [w.address, "0x21e19e0c9bab2400000"]);
      wallets.push(w);
    }
    return wallets;
  }

  it("fills the queue to MAX_INTENTS and refuses the next one", async () => {
    const { auction } = await freshRound();
    const max = Number(await auction.MAX_INTENTS());
    const wallets = await crowd(20);
    const perWallet = max / wallets.length;

    for (const [wi, w] of wallets.entries()) {
      const a = auction.connect(w);
      for (let k = 0; k < perWallet; k++) {
        // Distinct limit prices so each takes its own slot: the merge keys on
        // (bidder, price), which is what stops one wallet eating the queue.
        await a.submit(BigInt(10 ** 12 + wi * perWallet + k), { value: MIN_INTENT });
      }
    }
    expect(await auction.intentCount()).to.equal(BigInt(max));

    const extra = (await crowd(21)).at(-1);
    await expect(auction.connect(extra).submit(9n, { value: MIN_INTENT }))
      .to.be.revertedWith("queue full");
  });

  it("settles a full queue inside a conventional block", async () => {
    const { auction } = await freshRound();
    const max = Number(await auction.MAX_INTENTS());
    const wallets = await crowd(20);
    const perWallet = max / wallets.length;
    for (const [wi, w] of wallets.entries()) {
      const a = auction.connect(w);
      for (let k = 0; k < perWallet; k++) {
        await a.submit(0, { value: MIN_INTENT }); // market orders: all eligible
      }
    }
    // Market orders from one wallet merge, so top up to a full queue with
    // distinct prices — the merge is doing its job.
    let n = Number(await auction.intentCount());
    for (let i = 0; n < max; i++, n++) {
      await auction.connect(wallets[i % wallets.length])
        .submit(BigInt(10 ** 12 + i), { value: MIN_INTENT });
    }
    expect(await auction.intentCount()).to.equal(BigInt(max));

    await ethers.provider.send("evm_increaseTime", [200_000]);
    await ethers.provider.send("evm_mine");
    const rc = await (await auction.settle()).wait();
    const perIntent = rc.gasUsed / BigInt(max);
    console.log(`        settle at n=${max}: ${rc.gasUsed} gas (${perIntent}/intent)`);
    expect(await auction.settled()).to.equal(true);
    // The bound was chosen so a full queue fits a 30M block with headroom.
    expect(rc.gasUsed).to.be.lessThan(30_000_000n);
  });

  it("keeps escrow exactly solvent across every claim", async () => {
    const { auction } = await freshRound({ auctionMaxRaiseWei: E(0.05) });
    const n = 200;
    const wallets = await crowd(n);
    for (const w of wallets) await auction.connect(w).submit(0, { value: MIN_INTENT });
    expect(await auction.intentCount()).to.equal(BigInt(n));

    const escrow = await ethers.provider.getBalance(await auction.getAddress());
    expect(escrow).to.equal(MIN_INTENT * BigInt(n));

    await ethers.provider.send("evm_increaseTime", [200_000]);
    await ethers.provider.send("evm_mine");
    await auction.settle();

    for (let i = 0; i < n; i++) await auction.connect(wallets[i]).claim(BigInt(i));
    // Oversubscribed 4:1, so most of this is refunds. Not one wei may be
    // stranded and not one wei may be overpaid.
    expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(0n);
  });

  describe("under attack", () => {
    it("prices out dust spam", async () => {
      const { auction } = await freshRound();
      const [w] = await crowd(1);
      await expect(auction.connect(w).submit(0, { value: MIN_INTENT - 1n }))
        .to.be.revertedWith("value");
      await expect(auction.connect(w).submit(0, { value: 1n })).to.be.revertedWith("value");
    });

    it("one wallet cannot consume the queue", async () => {
      // A cap without merging would hand a griefer a censorship tool: fill
      // every slot, lock out real bidders, cancel and walk away.
      const { auction } = await freshRound();
      const [w] = await crowd(1);
      for (let i = 0; i < 50; i++) await auction.connect(w).submit(0, { value: MIN_INTENT });
      expect(await auction.intentCount()).to.equal(1n);
      const it0 = await auction.intents(0);
      expect(it0.amount).to.equal(MIN_INTENT * 50n);
    });

    it("cancelling and re-entering leaves no stranded escrow", async () => {
      const { auction } = await freshRound();
      const [w] = await crowd(1);
      await auction.connect(w).submit(0, { value: E(0.01) });
      await auction.connect(w).cancel(0);
      await auction.connect(w).submit(0, { value: E(0.02) });
      expect(await ethers.provider.getBalance(await auction.getAddress())).to.equal(E(0.02));

      await ethers.provider.send("evm_increaseTime", [200_000]);
      await ethers.provider.send("evm_mine");
      await auction.settle();
      await auction.connect(w).claim(1n);
      // The cancelled intent is settled-as-empty and must not pay again.
      await expect(auction.connect(w).claim(0n)).to.be.reverted;
    });

    it("only the bidder can claim, and only once", async () => {
      const { auction } = await freshRound({ auctionMaxRaiseWei: E(0.001) });
      const [alice, mallory] = await crowd(2);
      await auction.connect(alice).submit(0, { value: E(0.01) });
      await ethers.provider.send("evm_increaseTime", [200_000]);
      await ethers.provider.send("evm_mine");
      await auction.settle();

      // Claims are self-service: claim() pays msg.sender and requires it to be
      // the intent's owner, so there is no way to trigger someone else's claim
      // — not to help them, and not to push their tokens somewhere.
      await expect(auction.connect(mallory).claim(0n)).to.be.revertedWith("claimed");

      const before = await ethers.provider.getBalance(alice.address);
      await auction.connect(alice).claim(0n);
      expect(await ethers.provider.getBalance(alice.address)).to.be.greaterThan(before);
      // Draining an intent twice is the classic auction bug.
      await expect(auction.connect(alice).claim(0n)).to.be.revertedWith("claimed");
    });

    it("settlement is open to anyone, and runs exactly once", async () => {
      const { auction } = await freshRound();
      const [w, stranger] = await crowd(2);
      await auction.connect(w).submit(0, { value: E(0.01) });
      await ethers.provider.send("evm_increaseTime", [200_000]);
      await ethers.provider.send("evm_mine");
      // Not the operator, not the creator — the platform has no privileged role.
      await auction.connect(stranger).settle();
      await expect(auction.connect(w).settle()).to.be.revertedWith("settled");
    });
  });
});
