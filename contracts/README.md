# Contracts — implemented, tested, NOT YET AUDITED OR DEPLOYED WITH REAL FUNDS

The full on-chain round mechanism, mirroring the paper engine one-to-one:

| Contract | Purpose |
| --- | --- |
| `ArenaToken.sol` | Fixed-supply round token from the template. No owner, no mint, no pause, no blacklist. Maintains an on-chain holder count so graduation criteria need no indexer. |
| `RoundPool.sol` | The round's constant-product market. Phases: Pending → Live → Graduated (trades forever, liquidity locked by construction — no withdrawal surface exists) or Redeem (uniform batch redemption at one price, `E·O/(T+O)` pro-rata). `resolve()` is permissionless. |
| `BatchAuction.sol` | Uniform-price opening auction settled fully on-chain: fixed close time, binary-search clearing of `A* = min(D(p(A*)), maxRaise)`, pro-rata fills, pull-based claims, permissionless `settle()`. |
| `RoundFactory.sol` | Single entry point deploying token+pool+auction from fixed bytecode — "creators supply metadata, never code" enforced by construction. |

## Verification

`npm test -w @cookout/contracts` (or `node scripts/hh.cjs test` here):

- Lifecycle tests: auction → uniform fills → live trading → timer end → uniform
  redemption; graduation path; fee accounting; escrow cancel/refund.
- **Differential tests**: `scripts/gen-vectors.mjs` runs the TypeScript reference
  (`packages/shared/src/auction.ts`) over five auction scenarios and the Solidity
  settlement must reproduce clearing price, raise, and every fill within float↔wei
  rounding tolerance. The paper game and the chain are provably the same mechanism.

## Deployment

`scripts/deploy.cjs` deploys the `RoundFactory` (config has an Arbitrum Sepolia
target as the stand-in until Robinhood Chain RPC details are set):

```bash
DEPLOYER_KEY=0x... node scripts/hh.cjs run scripts/deploy.cjs --network arbitrumSepolia
```

## Before real funds

Owner has waived the pre-launch legal review gate (2026-07-14). Remaining strongly
recommended before mainnet value: an independent security audit of these four
contracts, and re-running the differential suite against the audited bytecode.
`docs/COMPLIANCE.md` retains the §12 flag list for whenever counsel does review.
