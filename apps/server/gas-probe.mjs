import { createPublicClient, http, formatEther, formatGwei } from "viem";
for (const [label, url] of [["mainnet 4663", "https://rpc.mainnet.chain.robinhood.com"], ["testnet 46630", "https://rpc.testnet.chain.robinhood.com"]]) {
  const c = createPublicClient({ transport: http(url) });
  const gp = await c.getGasPrice();
  // Operator-paid transactions for one full round, measured on testnet.
  const perRound = { createRound: 5_103_339n, settle: 375_876n, resolve: 55_208n, migrate: 522_481n, claimFees: 40_000n };
  const total = Object.values(perRound).reduce((a, b) => a + b, 0n);
  const cost = total * gp;
  console.log(`\n${label} — gas price ${formatGwei(gp)} gwei`);
  console.log(`  operator gas per round: ${total} gas = ${formatEther(cost)} ETH`);
  // Trade fee is 100 bps of volume, paid to the operator as feeRecipient.
  console.log(`  break-even volume @1% trade fee: ${formatEther(cost * 100n)} ETH`);
  console.log(`  1000 rounds cost: ${formatEther(cost * 1000n)} ETH`);
}
