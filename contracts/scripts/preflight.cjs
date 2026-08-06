/**
 * Refuse to deploy into a mistake.
 *
 * Everything here is a fact that is cheap to check now and expensive to
 * discover after the fact: the factory is immutable once deployed, and a round
 * created against a wrong PositionManager or a wrong fee wallet cannot be
 * corrected — only abandoned. Run it against the target network before deploy.
 *
 *   DEPLOYER_KEY=0x... node scripts/hh.cjs run scripts/preflight.cjs --network robinhood
 */
const { ethers, network } = require("hardhat");

const KNOWN_V4 = {
  4663: {
    positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
    poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  },
  46630: {
    positionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
    poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  },
};
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const TESTNET_OPERATOR = "0xb6ffa5587db5e5781134e23988bfca78f6dd27db";
/**
 * Enough to deploy and run rounds, measured rather than guessed.
 *
 * Gas is now the entire cost. At the chain's real gas price (~0.023 gwei) the
 * factory deploys for 0.00012 ETH and creating a round costs ~0.00005 — the
 * curve's opening price comes from a virtual reserve, so the operator funds
 * no liquidity and gets no principal back because none was ever put up.
 *
 * The floor is deliberately far above that. An operator wallet that runs dry
 * mid-round cannot settle an auction or resolve a round, and players' money is
 * sitting in the pool while it cannot — so the margin is the point, not the
 * arithmetic.
 */
const MIN_OPERATOR_ETH = 0.02;

let problems = 0;
const ok = (label, detail = "") => console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
const bad = (label, detail = "") => {
  console.log(`  STOP  ${label}${detail ? ` — ${detail}` : ""}`);
  problems++;
};

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  const id = Number(chainId);
  const live = id === 4663;
  console.log(`\npreflight: ${network.name} (chainId ${id})${live ? "  *** REAL MONEY ***" : ""}\n`);

  const v4 = KNOWN_V4[id];
  if (!v4) bad("no recorded Uniswap v4 addresses for this chain");
  else {
    for (const [name, addr] of [...Object.entries(v4), ["permit2", PERMIT2]]) {
      const size = ((await ethers.provider.getCode(addr)).length - 2) / 2;
      size > 1000
        ? ok(`${name} deployed`, `${addr} (${size} bytes)`)
        : bad(`${name} missing at ${addr}`, `${size} bytes`);
    }
  }

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    bad("no DEPLOYER_KEY set");
  } else {
    const me = signers[0];
    const bal = Number(ethers.formatEther(await ethers.provider.getBalance(me.address)));
    console.log(`  ----  deployer ${me.address}`);
    bal >= MIN_OPERATOR_ETH
      ? ok("deployer funded", `${bal.toFixed(4)} ETH`)
      : bad("deployer underfunded", `${bal.toFixed(4)} ETH, want >= ${MIN_OPERATOR_ETH}`);
    // The testnet operator's key is public. Using it on mainnet would hand
    // anyone the ability to drain gas and stop settlement.
    if (live && me.address.toLowerCase() === TESTNET_OPERATOR)
      bad("this is the PUBLIC testnet operator key — generate a fresh one for mainnet");
    else if (live) ok("not the public testnet key");
  }

  const feeWallet = process.env.PROTOCOL_FEE_WALLET ?? "0x75f14607218dc771FcAC61a01Ae86507b9d8fdf1";
  const feeBps = Number(process.env.PROTOCOL_FEE_BPS ?? 3000);
  /^0x[0-9a-fA-F]{40}$/.test(feeWallet) && feeWallet !== ethers.ZeroAddress
    ? ok("protocol fee wallet", feeWallet)
    : bad("protocol fee wallet is not an address", feeWallet);
  feeBps > 0 && feeBps < 10_000
    ? ok("protocol fee split", `${feeBps / 100}% protocol / ${(10_000 - feeBps) / 100}% creator`)
    : bad("protocol fee split out of range", String(feeBps));

  // The factory embeds everything it deploys; going over the limit is a
  // deployment that reverts after you have paid for the libraries.
  const art = require("../artifacts/src/RoundFactory.sol/RoundFactory.json");
  const size = (art.deployedBytecode.length - 2) / 2;
  size <= 24_576
    ? ok("factory within the contract size limit", `${size} / 24576 bytes`)
    : bad("factory exceeds the contract size limit", `${size} bytes`);

  console.log(
    problems === 0
      ? `\nREADY${live ? " — this next step spends real money and cannot be undone." : ""}\n`
      : `\n${problems} PROBLEM(S) — do not deploy.\n`,
  );
  if (problems) process.exit(1);
}
main().catch((e) => { console.error("preflight failed:", e.message ?? e); process.exit(1); });
