/**
 * Generates differential test vectors from the TypeScript reference
 * implementation (packages/shared auction.ts). The Solidity settlement must
 * reproduce these within float↔wei rounding tolerance — this is the proof
 * that the paper engine and the on-chain auction are the same mechanism.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { settleAuction } from "@cookout/shared";

const CASES = [
  {
    name: "market orders under cap",
    pool: { eth: 100, token: 1_000_000 },
    maxRaise: 50,
    feeBps: 0,
    intents: [{ amount: 5 }, { amount: 10 }, { amount: 1 }],
  },
  {
    name: "oversubscribed pro-rata",
    pool: { eth: 100, token: 1_000_000 },
    maxRaise: 20,
    feeBps: 0,
    intents: [{ amount: 30 }, { amount: 10 }],
  },
  {
    name: "limit below clearing excluded",
    pool: { eth: 100, token: 1_000_000 },
    maxRaise: 100,
    feeBps: 0,
    intents: [{ amount: 40 }, { amount: 10, maxPrice: 0.0001 * 1.000001 }],
  },
  {
    name: "limits cap the raise",
    pool: { eth: 100, token: 1_000_000 },
    maxRaise: 1000,
    feeBps: 0,
    intents: [
      { amount: 100, maxPrice: 0.0001 * 1.05 },
      { amount: 100, maxPrice: 0.0001 * 1.05 },
    ],
  },
  {
    name: "mixed with settlement fee",
    pool: { eth: 40, token: 1_000_000 },
    maxRaise: 30,
    feeBps: 50,
    intents: [{ amount: 12 }, { amount: 6, maxPrice: 0.00008 }, { amount: 9, maxPrice: 0.0002 }],
  },
];

const vectors = CASES.map((c) => {
  const result = settleAuction({
    roundId: c.name,
    intents: c.intents.map((i, idx) => ({
      id: String(idx),
      roundId: c.name,
      userAddress: `0x${idx}`,
      ethAmount: i.amount,
      maxPrice: i.maxPrice,
      submittedAt: 0,
    })),
    pool: { ethReserve: c.pool.eth, tokenReserve: c.pool.token, totalSupply: c.pool.token },
    maxRaise: c.maxRaise,
    feeBps: c.feeBps,
    now: 0,
  });
  return {
    ...c,
    expected: {
      clearingPrice: result.clearingPrice,
      totalRaised: result.totalRaised,
      fillRatio: result.fillRatio,
      fills: result.fills.map((f) => ({ ethFilled: f.ethFilled, tokensOut: f.tokensOut })),
    },
  };
});

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "vectors.json");
writeFileSync(out, JSON.stringify(vectors, null, 2));
console.log(`wrote ${vectors.length} vectors to test/vectors.json`);
