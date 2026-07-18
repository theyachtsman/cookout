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

  const factory = await (await ethers.getContractFactory("RoundFactory")).deploy();
  await factory.waitForDeployment();
  const receipt = await factory.deploymentTransaction().wait();

  const record = {
    network: network.name,
    chainId: Number(chainId),
    roundFactory: await factory.getAddress(),
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
