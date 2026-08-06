/**
 * Deploys GoonSquadNFT and records it.
 *
 * The signer is passed in rather than derived here: the key lives only on the
 * API host, and this script never needs to see it — only the address it
 * signs as, which is public. That address is immutable in the contract, so it
 * is checked for shape before anything is spent.
 */
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { ethers, network } = require("hardhat");

async function main() {
  const signer = process.env.NFT_SIGNER;
  if (!/^0x[0-9a-fA-F]{40}$/.test(signer ?? ""))
    throw new Error("set NFT_SIGNER to the voucher signer's ADDRESS (not its key)");

  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const file = join(__dirname, "..", "deployments", `${network.name}.json`);
  const record = JSON.parse(readFileSync(file, "utf8"));

  // Placeholder until the commissioned art is published; setBaseURI moves it
  // once, then freezeMetadata() makes it permanent.
  const baseURI = process.env.NFT_BASE_URI ?? "https://api-dev.thecookout.fun/nft/";
  const owner = process.env.NFT_OWNER ?? deployer.address;

  console.log(`network ${network.name} (${chainId})`);
  console.log(`  signer  ${signer}   (immutable — must match CHAIN_NFT_SIGNER_KEY)`);
  console.log(`  owner   ${owner}    (may setBaseURI until frozen)`);
  console.log(`  baseURI ${baseURI}`);

  const nft = await (await ethers.getContractFactory("GoonSquadNFT")).deploy(signer, owner, baseURI);
  await nft.waitForDeployment();
  const rc = await nft.deploymentTransaction().wait();
  const address = await nft.getAddress();
  console.log(`\nGoonSquadNFT: ${address}  gas ${rc.gasUsed}`);

  // Read it back: a wrong signer here can never be corrected.
  const onChain = await ethers.provider.call({ to: address, data: "0x238ac933" }); // signer()
  console.log(`  on-chain signer reads: 0x${onChain.slice(-40)}`);

  record.goonSquadNft = address;
  record.goonSquadNftSigner = signer;
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log(`recorded in ${file}`);
  console.log(`\nSet on the API:  CHAIN_NFT=${address}`);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
