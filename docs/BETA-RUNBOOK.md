# Beta-Day Runbook (100-wallet paper beta)

## T-minus days: prep

- [ ] VPS deployed per [DEPLOYMENT.md](DEPLOYMENT.md); strong `ADMIN_KEY`; `CORS_ORIGIN` set
- [ ] `BETA_WHITELIST` **unset** — signups collect on the landing page, nobody can enter early
      (existing profiles always keep access, so test wallets you've already used will get in;
      use fresh wallets to verify the gate)
- [ ] Bot rehearsal against the real domain: `node apps/server/scripts/bots.mjs https://api.<domain> 50`
      for 10+ minutes; watch RAM/CPU (`htop`), API log, and the arena in a browser
- [ ] Seed 3–5 good token concepts with artwork (your own creator wallet) so the calendar isn't empty
- [ ] `/admin` → Live Ops: pick tier (rookie recommended for day one), lead seconds
- [ ] Nightly backup cron in place; run one manual `pg_dump` and confirm the file

## Window open

1. Add `BETA_WHITELIST=1` to the env file, `systemctl restart cookout-api`
2. Post the X announcement with the landing-page link
3. Verify with a whitelisted wallet + a non-whitelisted wallet (should be refused with
   "not on the beta whitelist")

## During the day

- `/admin` is your console: signups, feedback (refreshes every 15s), live round controls,
  chat moderation (delete / mute 15m), clear-flags for accidental rug bans
- Round cadence: auto-schedule keeps the calendar full from top-voted submissions;
  turn it OFF in Live Ops if you want to hand-schedule "showcase" rounds instead
- If someone griefs chat: Moderate Chat → mute. If a creator rugs on purpose: that's
  the game (degen) — but their wallet flags automatically
- Emergency: pause a round from admin (rate-limited 3/hour, logged); `systemctl restart
  cookout-api` is safe — sessions, balances, and history all survive
- Watch: `journalctl -fu cookout-api` and `htop`

## Metrics to pull afterwards

- Signups vs. actual sign-ins (landing → arena conversion)
- Rounds per player, average round participation (admin overview + leaderboards)
- Any Served Up? How close did bonding bars get? (tune thresholds if nobody's close)
- Feedback list — export and triage
- Chat volume / moderation actions needed

## Window close

- Remove `BETA_WHITELIST=1`, restart (or leave it on to keep the arena invite-only)
- Thank-you post; consider a "beta tester" cosmetic badge for participants (ask Claude —
  the cosmetics system supports it in minutes)
