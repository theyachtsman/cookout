# Contracts (Phase 2 prep — DRAFT, UNAUDITED, NOT DEPLOYED)

Phase 1 runs entirely on paper money; nothing in this directory is used at runtime yet.
These drafts exist so the Phase 1 game semantics (uniform-price batch auction, pro-rata
fills, fixed-supply template token, criteria-based graduation) stay contract-shaped and
can be swapped in for Phase 2 without redesigning the game.

**Do not deploy with real funds until:**

1. Legal review of spec §12 items is complete (issuer/market-operator posture, auction
   classification, creator payouts, prediction mechanics).
2. An independent security audit of every contract here has been completed and published.
3. The trust requirements of spec §13 are independently verifiable on-chain (no platform
   withdraw rights, non-discretionary liquidity rules, rate-limited logged pause).

| Contract | Purpose | Mirrors (paper engine) |
| --- | --- | --- |
| `ArenaToken.sol` | Fixed-supply round token from the platform-audited template. No mint, no pause, no blacklist, no owner. | `RoundConfig.totalSupply` |
| `BatchAuction.sol` | Escrowed buy intents, fixed close time, single uniform clearing price, pro-rata oversubscription, one atomic settlement. | `packages/shared/src/auction.ts` |
| `Graduation.sol` | Moves round liquidity into a permanently locked pool when pre-published criteria are met; otherwise enables the uniform batch redemption. | `RoundEngine.endRound` |

The TypeScript clearing algorithm in `@cookout/shared` is the reference implementation;
the Solidity settlement must reproduce its results exactly (same fixed-point rules), and
both are exercised against the same test vectors before Phase 2.
