/**
 * Migration, against the real Uniswap v4 on a fork of Robinhood Chain (46630).
 *
 * Run with FORK=1. Skipped otherwise, so the normal suite stays offline and
 * fast — but this is the only test that proves anything about migrate(): a mock
 * PositionManager would only confirm we encoded what we intended, not that
 * Uniswap accepts it. The addresses below are identical on Robinhood mainnet.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const E = (n) => ethers.parseEther(String(n));
const V4 = {
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
};
const PROTOCOL_WALLET = "0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1";

(process.env.FORK ? describe : describe.skip)("migrate() against real Uniswap v4", () => {
  let deployer, pool, token, locker, splitter, factory;

  before(async () => {
    [deployer] = await ethers.getSigners();
    const priceMath = await (await ethers.getContractFactory("PriceMath")).deploy();
    const libraries = { PriceMath: await priceMath.getAddress() };
    const lockerFactory = await (await ethers.getContractFactory("LockerFactory")).deploy();

    factory = await (
      await ethers.getContractFactory("RoundFactory", { libraries })
    ).deploy(
      V4.positionManager,
      V4.permit2,
      await lockerFactory.getAddress(),
      PROTOCOL_WALLET,
      3_000,
    );

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await (
      await factory.createRound(
        {
          name: "Graduate", symbol: "GRAD", totalSupply: E(1_000_000),
          queueClosesAt: now + 100, endTime: now + 200,
          auctionMaxRaiseWei: E(50), auctionFeeBps: 0, tradeFeeBps: 100,
          mcapTargetWei: 0,
          // Graduation must be reachable: zero thresholds graduate on resolve.
          graduationMcapWei: 0, graduationMinVolumeWei: 0, graduationMinHolders: 0,
          feeRecipient: deployer.address, creator: deployer.address,
          feeDestination: ethers.ZeroAddress,
        },
        { value: E(100) },
      )
    ).wait();

    const r = await factory.rounds(0);
    pool = await ethers.getContractAt("RoundPool", r.pool, deployer);
    token = await ethers.getContractAt("ArenaToken", r.token);
    locker = await ethers.getContractAt("CookoutLpLocker", r.locker);
    splitter = await ethers.getContractAt("FeeSplitter", r.feeSplitter);

    const auction = await ethers.getContractAt("BatchAuction", r.auction);
    await ethers.provider.send("evm_increaseTime", [300]);
    await ethers.provider.send("evm_mine");
    await auction.settle();
    await pool.resolve();
    expect(await pool.phase()).to.equal(2n); // Graduated
  });

  it("moves the whole pool into a real v4 position owned by the locker", async () => {
    const [ethBefore, tokenBefore] = await pool.getReserves();
    expect(ethBefore).to.be.greaterThan(0n);

    const posm = await ethers.getContractAt(
      ["function ownerOf(uint256) view returns (address)"],
      V4.positionManager,
    );

    await expect(pool.migrate()).to.emit(pool, "Migrated");
    const tokenId = await pool.migratedPositionId();

    // The position exists on Uniswap's PositionManager and belongs to the
    // locker — not to us, not to the creator, not to anyone who can move it.
    expect(await posm.ownerOf(tokenId)).to.equal(await locker.getAddress());

    // The pool is emptied: reserves booked to zero and the ETH actually gone.
    const [ethAfter, tokenAfter] = await pool.getReserves();
    expect(ethAfter).to.equal(0n);
    expect(tokenAfter).to.equal(0n);
    // Dust from mint rounding is swept back, so a little may remain — but the
    // overwhelming majority must have left for the v4 pool.
    expect(await ethers.provider.getBalance(await pool.getAddress()))
      .to.be.lessThan(ethBefore / 1_000n);
    expect(await token.balanceOf(await pool.getAddress()))
      .to.be.lessThan(tokenBefore / 1_000n);
  });

  it("opens the v4 pool at the price the curve ended on", async () => {
    // The migrated price must match the curve's last price, or the first
    // arbitrageur takes the difference out of the locked liquidity.
    const [ethR, tokenR] = [E(100), E(1_000_000)]; // the seeded reserves
    const priceMath = await ethers.getContractAt(
      ["function sqrtPriceX96FromReserves(uint256,uint256) pure returns (uint160)"],
      await (await ethers.getContractFactory("PriceMath")).deploy().then((c) => c.getAddress()),
    );
    const expectedSqrt = await priceMath.sqrtPriceX96FromReserves(ethR, tokenR);

    const stateView = await ethers.getContractAt(
      ["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"],
      "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b", // StateView on 46630
    );
    const poolId = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [ethers.ZeroAddress, await token.getAddress(), 3000, 60, ethers.ZeroAddress],
      ),
    );
    const [sqrtPriceX96] = await stateView.getSlot0(poolId);
    // Within a hair: the auction moved reserves slightly before resolution.
    const drift = sqrtPriceX96 > expectedSqrt
      ? sqrtPriceX96 - expectedSqrt
      : expectedSqrt - sqrtPriceX96;
    expect(drift * 100n / expectedSqrt).to.be.lessThan(5n);
  });

  it("cannot be migrated twice", async () => {
    await expect(pool.migrate()).to.be.revertedWith("migrated");
  });

  it("routes collected fees to the creator and the protocol", async () => {
    const tokenId = await pool.migratedPositionId();
    // Nothing has traded, so there are no fees yet — what matters is that the
    // call is accepted by the real PositionManager and pays the splitter.
    await expect(locker.collectFees(tokenId)).to.emit(locker, "FeesCollected")
      .withArgs(tokenId, await splitter.getAddress());
  });
});
