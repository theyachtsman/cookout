// Deploys the RoundFactory (the only long-lived contract; every round's
// token/pool/auction deploys through it per-round) and records the deployment
// in contracts/deployments/<network>.json for the server/web to consume.
//
//   DEPLOYER_KEY=0x... node scripts/hh.cjs run scripts/deploy.cjs --network arbitrumSepolia
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(
    `network: ${network.name} (chainId ${chainId}), deployer: ${deployer.address}, ` +
      `balance: ${ethers.formatEther(balance)} ETH`,
  );

  // Uniswap v4, per chain. Robinhood mainnet (4663) and its testnet (46630)
  // share these addresses; anything else has to be added deliberately.
  const V4 = {
    // Verified present on both chains at these addresses, 2026-08-05.
    4663: { positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7" },
    46630: { positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7" },
  }[Number(chainId)];
  if (!V4) throw new Error(`no Uniswap v4 addresses recorded for chain ${chainId}`);
  const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
  const PROTOCOL_FEE_WALLET =
    process.env.PROTOCOL_FEE_WALLET ?? "0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1";
  const PROTOCOL_FEE_BPS = Number(process.env.PROTOCOL_FEE_BPS ?? 3000);

  // PriceMath is linked, not inlined — see the library for why.
  const priceMath = await (await ethers.getContractFactory("PriceMath")).deploy();
  await priceMath.waitForDeployment();
  const lockerFactory = await (await ethers.getContractFactory("LockerFactory")).deploy();
  await lockerFactory.waitForDeployment();

  const factory = await (
    await ethers.getContractFactory("RoundFactory", {
      libraries: { PriceMath: await priceMath.getAddress() },
    })
  ).deploy(
    V4.positionManager,
    PERMIT2,
    await lockerFactory.getAddress(),
    PROTOCOL_FEE_WALLET,
    PROTOCOL_FEE_BPS,
  );
  await factory.waitForDeployment();
  const receipt = await factory.deploymentTransaction().wait();

  const record = {
    network: network.name,
    chainId: Number(chainId),
    roundFactory: await factory.getAddress(),
    priceMath: await priceMath.getAddress(),
    lockerFactory: await lockerFactory.getAddress(),
    positionManager: V4.positionManager,
    permit2: PERMIT2,
    protocolFeeWallet: PROTOCOL_FEE_WALLET,
    protocolFeeBps: PROTOCOL_FEE_BPS,
    deployer: deployer.address,
    txHash: receipt.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    deployedAt: new Date().toISOString(),
  };

  const dir = join(__dirname, "..", "deployments");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${network.name}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");

  console.log(`RoundFactory deployed: ${record.roundFactory}`);
  console.log(`recorded: ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
