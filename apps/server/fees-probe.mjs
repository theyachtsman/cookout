import { createPublicClient, http, keccak256, toHex, formatEther } from "viem";
const c = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com") });
const sel = (sig) => keccak256(toHex(sig)).slice(0, 10);
const POOL = process.argv[2];
for (const sig of ["feesAccrued()", "feeRecipient()", "ethReserve()", "virtualEthReserve()"]) {
  const r = await c.call({ to: POOL, data: sel(sig) });
  const v = BigInt(r.data ?? "0x0");
  console.log(`  ${sig.padEnd(22)} ${sig === "feeRecipient()" ? "0x" + v.toString(16).padStart(40, "0") : formatEther(v) + " ETH"}`);
}
console.log(`  balance                ${formatEther(await c.getBalance({ address: POOL }))} ETH`);
