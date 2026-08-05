/**
 * Deploys just the PitPoolFactory and records it alongside the round factory.
 *
 * Separate from deploy.cjs so the Pit's pools can be added to a chain that
 * already has a round factory, without redeploying it and orphaning every
 * round that is running against it.
 */
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const file = join(__dirname, "..", "deployments", `${network.name}.json`);
  const record = JSON.parse(readFileSync(file, "utf8"));

  const feeWallet =
    process.env.PROTOCOL_FEE_WALLET ?? record.protocolFeeWallet ?? deployer.address;
  console.log(`network ${network.name} (${chainId})`);
  console.log(`resolver (the API's operator key): ${deployer.address}`);
  console.log(`house cut to: ${feeWallet}`);

  const f = await (await ethers.getContractFactory("PitPoolFactory")).deploy(
    deployer.address,
    feeWallet,
  );
  await f.waitForDeployment();
  const rc = await f.deploymentTransaction().wait();
  const address = await f.getAddress();
  console.log(`PitPoolFactory: ${address}  gas ${rc.gasUsed}`);

  record.pitPoolFactory = address;
  record.pitPoolFactoryBlock = rc.blockNumber;
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log(`recorded in ${file}`);
  console.log(`\nSet on the API:  CHAIN_PIT_FACTORY=${address}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
