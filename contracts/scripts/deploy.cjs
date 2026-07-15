// Deploys the RoundFactory (the only long-lived contract; every round's
// token/pool/auction deploys through it per-round).
//
//   DEPLOYER_KEY=0x... node scripts/hh.cjs run scripts/deploy.cjs --network arbitrumSepolia
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`network: ${network.name}, deployer: ${deployer.address}`);
  const factory = await (await ethers.getContractFactory("RoundFactory")).deploy();
  await factory.waitForDeployment();
  console.log(`RoundFactory deployed: ${await factory.getAddress()}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
