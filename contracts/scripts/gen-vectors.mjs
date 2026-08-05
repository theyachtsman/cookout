/**
 * Generates differential test vectors from the TypeScript reference
 * implementation (packages/shared auction.ts). The Solidity settlement must
 * reproduce these within float↔wei rounding tolerance — this is the proof
 * that the paper engine and the on-chain auction are the same mechanism.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { quoteBuyWei, quoteSellWei, settleAuction } from "@cookout/shared";

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

/**
 * Quote vectors, in wei and exact.
 *
 * The auction vectors above allow a float↔wei tolerance because the reference
 * is float math. These must not: the client uses quoteBuyWei/quoteSellWei to
 * compute the minimum-out it sends with every trade, so a quote that is even
 * one wei off the contract either reverts honest trades or leaves the trade
 * under-protected. Exact equality is the whole point.
 */
const E = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const QUOTE_CASES = [
  { name: "buy, 1% fee", reserves: { eth: 100, token: 1_000_000 }, feeBps: 100, buy: 1 },
  { name: "buy, no fee", reserves: { eth: 100, token: 1_000_000 }, feeBps: 0, buy: 2.5 },
  { name: "buy, max fee", reserves: { eth: 40, token: 1_000_000 }, feeBps: 500, buy: 0.25 },
  { name: "buy, large vs reserves", reserves: { eth: 10, token: 1_000_000 }, feeBps: 100, buy: 5 },
  { name: "sell, 1% fee", reserves: { eth: 100, token: 1_000_000 }, feeBps: 100, sell: 1_000 },
  { name: "sell, no fee", reserves: { eth: 100, token: 1_000_000 }, feeBps: 0, sell: 25_000 },
  { name: "sell, max fee", reserves: { eth: 40, token: 1_000_000 }, feeBps: 500, sell: 500 },
];

const quoteVectors = QUOTE_CASES.map((c) => {
  const reserves = { ethReserve: E(c.reserves.eth), tokenReserve: E(c.reserves.token) };
  const isBuy = c.buy !== undefined;
  const amount = isBuy ? E(c.buy) : E(c.sell);
  const expected = isBuy
    ? quoteBuyWei(reserves, amount, c.feeBps)
    : quoteSellWei(reserves, amount, c.feeBps);
  return {
    name: c.name,
    side: isBuy ? "buy" : "sell",
    reserves: c.reserves,
    feeBps: c.feeBps,
    amount: amount.toString(),
    expected: expected.toString(),
  };
});

const dir = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(dir, "..", "test", "vectors.json"), JSON.stringify(vectors, null, 2));
writeFileSync(join(dir, "..", "test", "quote-vectors.json"), JSON.stringify(quoteVectors, null, 2));
console.log(`wrote ${vectors.length} auction + ${quoteVectors.length} quote vectors`);
