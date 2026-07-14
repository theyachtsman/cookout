# Compliance flags (spec §12) — not legal advice

Phase 2 (real funds) is **blocked** until actual counsel reviews these. This file maps
each flag to what the Phase 1 code already does so the review isn't blocked by a rebuild.

| Flag | Phase 1 posture |
| --- | --- |
| Issuer + market operator + game layer stacked on one entity | Documented; contracts drafted so round liquidity is never platform-withdrawable (see `contracts/`) |
| Batch auction is wagering-adjacent despite "fair open" framing | Auction is fully deterministic + auditable; no house edge beyond published fees; flagged for review regardless |
| "Moon or Rug" predictions = highest gambling-classification risk | XP-only payout, hard-coded; no financial reward path exists in the code |
| Creator revenue share raises issuer-of-record questions | Paper-only credit in Phase 1; real payouts disabled until review |
| Referral structure must avoid downline/MLM framing | Single-tier only: one `referredBy`, one fee-share hop, no recursion |
| Don't market paper mode as "practice for real trading" | UI copy says "paper money" plainly and nothing more |
| Emergency pause must not protect the house selectively | Rate-limited (3/hour) and written to a public-facing audit log |

Trust requirements (spec §13) built in from day one: template-only token deployment
(no creator mint/pause/blacklist), creator vetting writes an audit trail, settlement
audit hashes are recomputable by anyone, and the round-end redemption is uniform-price
so the platform cannot advantage any exit.
