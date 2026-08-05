# Compliance flags (spec §12) — not legal advice

**Counsel review has been waived for the mainnet launch by the operator.** This
file is no longer a pre-review checklist; it is the record of what the code
actually does, so that a review can happen at any time without a rebuild — and
so nobody has to guess which risks were accepted deliberately.

Nothing here has been reviewed by a lawyer. The controls below reduce exposure;
they do not resolve the classification questions in the table.

## What the platform can and cannot enforce

This determines what every control below is worth, so it comes first.

Chain rounds are **non-custodial and permissionless**. Players trade from their
own wallets straight against the round contracts, and the server only mirrors
what already happened on-chain. **No server-side check can stop a trade**, and a
control that claims to would be worse than no control, because it would be
relied upon.

What the platform genuinely operates, and therefore genuinely gates:

| Surface | Gated? | Why |
| --- | --- | --- |
| Session (all site access, all data) | **Yes** | Nothing works without one |
| Coin creation | **Yes** | `createRound` is signed by the operator key |
| Creator fee destination | **Yes** | Set at launch, burned into the splitter |
| Buys, sells, pull-ups | **No** | Wallet → contract; we are not in the path |
| Liquidity in a graduated pool | **No** | Locked forever by construction, by design |

Describe these externally as access control over an interface — not as custody
or control over funds. They are not the same thing and the difference matters.

## Phase 2 controls, as built

| Control | Where | Notes |
| --- | --- | --- |
| Region blocking | `evaluateCompliance`, at session exchange | ISO country + `US-NY` style subdivisions. Location from Cloudflare's `CF-IPCountry` — added at the edge, so a browser can't forge it. **A VPN defeats it**; that is an accepted limit of geo-gating, not a bug. |
| Unknown region | Configurable | Allowed by default. Failing closed is right for a licensing gate and wrong as a default — it locks out everyone behind a privacy proxy. |
| Sanctions / denied addresses | Same gate | Case-insensitive address deny list, editable in the Command Center. Not wired to an automatic OFAC feed; the list is operator-maintained. |
| Age + terms | Blocking screen before any session | Records version, timestamp, attested age, and country at acceptance. Bumping `termsVersion` re-prompts everyone without erasing earlier records. |
| Self-exclusion | Settings → Take a break | One-way. Extendable, never shortened, **no staff route to lift one** — a test asserts the absence. Applying it revokes every live session. |
| Launch halt | Command Center | Stops new coin creation without evicting anyone mid-round. Rounds already on-chain are unaffected and cannot be stopped. |
| Audit trail | `store.auditLog`, area `compliance` | Every refusal, acceptance, and settings change, with the actor. |

Defaults ship **off** (`enabled: false`) so the paper beta is unaffected. The
default block list is the OFAC comprehensive country programme (CU, IR, KP, SY,
RU, BY). **The US is deliberately not on it** — whether to serve US users, or
particular states, is a licensing decision about your own operation and not
something a default should quietly make for you.

## The original flags

| Flag | Posture |
| --- | --- |
| Issuer + market operator + game layer stacked on one entity | Unchanged and unresolved. Round liquidity is never platform-withdrawable; graduated liquidity is locked by a contract with no withdrawal path at all. |
| Batch auction is wagering-adjacent despite "fair open" framing | Deterministic, auditable, no house edge beyond published fees. **Still the main classification risk.** |
| "Moon or Rug" predictions = highest gambling-classification risk | **Changed for Phase 2.** `PitPool` escrows real ETH and pays winners pro-rata, so a financial reward path now exists where the Phase 1 code deliberately had none. This is the single change most likely to attract a gambling classification, and it was made knowingly. |
| Battle the Goon Squad pays a real cash prize | `PitBattlePool`: buy-in pot, winner-take-all on PnL. Skill-framed rather than chance-framed, which is the more defensible half — but it is still a cash prize decided by the operator. |
| Creator revenue share raises issuer-of-record questions | **Now live for real funds.** Post-graduation LP fees split on-chain between the creator's chosen address and the protocol wallet, both immutable at deploy. |
| Referral structure must avoid downline/MLM framing | Single-tier only: one `referredBy`, one fee-share hop, no recursion. |
| Don't market paper mode as "practice for real trading" | UI copy says "paper money" plainly and nothing more. |
| Emergency pause must not protect the house selectively | Rate-limited (3/hour), written to a public-facing audit log. The launch halt is the Phase 2 equivalent and is equally logged. |

Trust requirements (spec §13) built in from day one: template-only token
deployment (no creator mint/pause/blacklist), creator vetting writes an audit
trail, settlement audit hashes are recomputable by anyone, and round-end
redemption is uniform-price so the platform cannot advantage any exit.

## Known gaps

Listed so they are accepted knowingly rather than discovered later:

- **No counsel review.** Waived. The classification questions above are open.
- **No KYC.** Sanctions screening is an operator-maintained address list, not
  identity verification.
- **Geo-gating is defeated by a VPN.** True of every IP-based gate.
- **Self-attested age.** No verification, and none is planned.
- **On-chain activity cannot be blocked**, only access to this interface.
- **The Pit settles on an oracle.** Pit matches are simulated, so no contract
  can verify who won: the platform posts the outcome. The pool contracts bound
  that — capped fees to fixed addresses, payouts derived from stakes, a
  permissionless refund window so refusing to resolve cannot keep the money,
  and a winner who must have entered. What they cannot bound is a *dishonest*
  outcome. Winner-take-all is the weaker of the two: a false pari-mutuel result
  still pays whoever backed it, while naming one entrant hands them everything.
  Publishing entries and results is the mitigation, not a fix.
