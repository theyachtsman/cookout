/**
 * The Burger economy ($BURG) reward + revenue service.
 *
 * $BURG is a second progression currency: XP measures progression, Burgers are
 * earned purchasing power (toward future Recruit Crates / the Flame Goon Squad
 * collection). Everything here is data-driven — the backend is the sole
 * authority on eligibility, amount, cooldown, repeatability, and seasonality,
 * all read from `store.settings.burger` (admin-editable, never hardcoded).
 *
 * Future systems (Loot Boxes, Collections, the Pit, Seasons, the Marketplace)
 * integrate by calling `awardBurger` with their source rather than minting
 * Burgers themselves. Placeholder sources ship disabled in BURGER_DEFAULTS.
 */
import type { Address, BurgerRevenueDest, BurgerSource, BurgerAnalytics } from "@cookout/shared";
import { BURGER_REVENUE_DESTS } from "@cookout/shared";
import type { Store } from "./store.js";

const isBot = (a: string) => a.toLowerCase().startsWith("0xb07");

/**
 * Award Burgers for a rule-based source (match completion, quests, launches,
 * graduations, referrals, seasonal, and future placeholder hooks). Returns the
 * amount actually paid — 0 when the source is disabled, on cooldown, already
 * claimed (one-time), out of its seasonal window, or the earner is a bot.
 *
 * `amount`/`label` overrides let callers (or future systems) pass a computed
 * value while still honoring the rule's enabled/cooldown/repeatable gates.
 */
export function awardBurger(
  store: Store,
  address: Address,
  source: BurgerSource,
  opts: { ref?: string; now?: number; amount?: number; label?: string } = {},
): number {
  if (isBot(address)) return 0;
  // The economy has two switches on purpose: burger.enabled is the economy's
  // own config, the flag is the operator's kill switch in Command Center.
  if (!store.flag("burgers")) return 0;
  const cfg = store.settings.burger;
  if (!cfg.enabled) return 0;
  const rule = cfg.rules.find((r) => r.source === source);
  if (!rule || !rule.enabled) return 0;
  if (rule.seasonalUntil && Date.now() > rule.seasonalUntil) return 0;

  const now = opts.now ?? Date.now();
  const u = store.getOrCreateUser(address);
  const claims = (u.burgerClaims ??= {});

  // One-time rules pay once per player.
  if (!rule.repeatable && claims[`rule:${source}`]) return 0;
  // Cooldown between awards of a repeatable source.
  if (rule.cooldownSec > 0 && now - (claims[`cd:${source}`] ?? 0) < rule.cooldownSec * 1000) return 0;

  const amount = Math.max(0, Math.round(opts.amount ?? rule.amount));
  if (amount <= 0) return 0;

  credit(store, address, amount, "reward", source, opts.label ?? rule.label, opts.ref, now);
  claims[`cd:${source}`] = now;
  if (!rule.repeatable) claims[`rule:${source}`] = now;
  return amount;
}

/**
 * Award any newly-crossed XP-level Burger milestones. Call after a level-up with
 * the player's new level; every enabled milestone at or below it that hasn't been
 * claimed pays out (so a multi-level jump grants each tier once).
 */
export function awardBurgerXpMilestones(store: Store, address: Address, level: number, now = Date.now()): number {
  if (isBot(address)) return 0;
  // The economy has two switches on purpose: burger.enabled is the economy's
  // own config, the flag is the operator's kill switch in Command Center.
  if (!store.flag("burgers")) return 0;
  const cfg = store.settings.burger;
  if (!cfg.enabled) return 0;
  const u = store.getOrCreateUser(address);
  const claims = (u.burgerClaims ??= {});
  let total = 0;
  for (const m of cfg.xpMilestones) {
    if (!m.enabled || m.amount <= 0 || level < m.level) continue;
    const key = `xp:${m.level}`;
    if (claims[key]) continue;
    credit(store, address, Math.round(m.amount), "reward", "xp_milestone", `Level ${m.level} Milestone`, String(m.level), now);
    claims[key] = now;
    total += Math.round(m.amount);
  }
  return total;
}

/**
 * Award a one-time milestone (First Match, First Launch, …) if enabled and not
 * yet claimed by this player. Idempotent — safe to call on every qualifying event.
 */
export function awardBurgerOneTime(store: Store, address: Address, id: string, now = Date.now()): number {
  if (isBot(address)) return 0;
  // The economy has two switches on purpose: burger.enabled is the economy's
  // own config, the flag is the operator's kill switch in Command Center.
  if (!store.flag("burgers")) return 0;
  const cfg = store.settings.burger;
  if (!cfg.enabled) return 0;
  const m = cfg.oneTimeMilestones.find((x) => x.id === id);
  if (!m || !m.enabled || m.amount <= 0) return 0;
  const u = store.getOrCreateUser(address);
  const claims = (u.burgerClaims ??= {});
  const key = `once:${id}`;
  if (claims[key]) return 0;
  credit(store, address, Math.round(m.amount), "reward", "one_time", m.label, id, now);
  claims[key] = now;
  return Math.round(m.amount);
}

/**
 * Buy Burgers with Cook Out balance (pETH). Debits the balance, mints $BURG at
 * the configured rate, records both ledgers, and routes the revenue by the
 * configured allocation. Throws a plain Error (message) on a bad/underfunded buy.
 */
export function purchaseBurgers(
  store: Store,
  address: Address,
  eth: number,
  now = Date.now(),
): { burgers: number; burgerBalance: number; arenaBalance: number } {
  const cfg = store.settings.burger;
  if (!cfg.enabled) throw new Error("The Burger shop is closed.");
  const spend = Number(eth);
  if (!Number.isFinite(spend) || spend <= 0) throw new Error("Enter an amount to spend.");
  const u = store.getOrCreateUser(address);
  if ((u.arenaBalance ?? 0) + 1e-9 < spend) throw new Error("Not enough Cook Out balance.");
  const burgers = Math.floor(spend * cfg.burgersPerEth);
  if (burgers <= 0) throw new Error("That's too small to buy any $BURG.");

  // Debit Cook Out balance (Cook Out ledger) and mint $BURG (Burger ledger).
  u.arenaBalance = (u.arenaBalance ?? 0) - spend;
  store.recordLedger(address, "burger_purchase", -spend);
  u.burgerBalance = (u.burgerBalance ?? 0) + burgers;
  u.burgerPurchased = (u.burgerPurchased ?? 0) + burgers;
  const purchaseId = store.id();
  store.recordBurgerTxn(address, { source: "purchase", category: "purchase", amount: burgers, label: "Burger Purchase", ref: purchaseId }, now);

  routeBurgerRevenue(store, address, spend, purchaseId, now);
  return { burgers, burgerBalance: u.burgerBalance, arenaBalance: u.arenaBalance ?? 0 };
}

/** Split a purchase across the configured revenue destinations (normalized),
 *  logging every slice. The jackpot slice feeds the live weekly pool; the rest
 *  accrue into named buckets for future disbursement + the accounting ledger. */
function routeBurgerRevenue(store: Store, address: Address, eth: number, purchaseId: string, now: number): void {
  const alloc = store.settings.burger.revenueAllocation;
  const total = BURGER_REVENUE_DESTS.reduce((s, d) => s + Math.max(0, alloc[d.key] ?? 0), 0);
  if (total <= 0) return;
  for (const { key } of BURGER_REVENUE_DESTS) {
    const frac = Math.max(0, alloc[key] ?? 0) / total;
    const amount = eth * frac;
    if (amount <= 1e-12) continue;
    store.burgerRevenueBuckets[key] = (store.burgerRevenueBuckets[key] ?? 0) + amount;
    store.burgerRevenueEth += amount;
    store.burgerRevenueLedger.push({ id: store.id(), at: now, purchaseEth: eth, dest: key as BurgerRevenueDest, pct: frac, amount, ref: purchaseId });
    // Only the jackpot destination has a live sink today; it feeds the pot now.
    if (key === "jackpot") store.jackpotPool += amount;
  }
  if (store.burgerRevenueLedger.length > 8000) store.burgerRevenueLedger.splice(0, store.burgerRevenueLedger.length - 6000);
}

/** Admin: grant (positive) or remove (negative) Burgers directly. Removal is
 *  clamped so a balance never goes negative. Returns the new balance. */
export function adminAdjustBurgers(store: Store, address: Address, amount: number, note = "", now = Date.now()): number {
  const u = store.getOrCreateUser(address);
  let delta = Math.round(Number(amount) || 0);
  if (delta < 0) delta = -Math.min(-delta, u.burgerBalance ?? 0);
  if (delta === 0) return u.burgerBalance ?? 0;
  u.burgerBalance = (u.burgerBalance ?? 0) + delta;
  const positive = delta > 0;
  store.recordBurgerTxn(
    address,
    {
      source: positive ? "admin_grant" : "adjustment",
      category: positive ? "admin_grant" : "adjustment",
      amount: delta,
      label: note.trim() || (positive ? "Admin Grant" : "Admin Adjustment"),
    },
    now,
  );
  return u.burgerBalance ?? 0;
}

/** Shared credit path: bumps the balance + lifetime-earned, then records the txn
 *  (which fires the socket toast + rolls up site-wide analytics). */
function credit(
  store: Store,
  address: Address,
  amount: number,
  category: "reward",
  source: BurgerSource,
  label: string,
  ref: string | undefined,
  now: number,
): void {
  const u = store.getOrCreateUser(address);
  u.burgerBalance = (u.burgerBalance ?? 0) + amount;
  u.burgerEarned = (u.burgerEarned ?? 0) + amount;
  store.recordBurgerTxn(address, { source, category, amount, label, ref }, now);
}

/** Economy-health analytics for the admin Burger Economy Manager. */
export function burgerAnalytics(store: Store, now = Date.now()): BurgerAnalytics {
  const cfg = store.settings.burger;
  const labelFor = (s: BurgerSource): string =>
    cfg.rules.find((r) => r.source === s)?.label ??
    ({ xp_milestone: "XP Milestone", one_time: "One-Time Milestone", admin_grant: "Admin Grant", purchase: "Purchase" } as Record<string, string>)[s] ??
    s;

  let totalEarned = 0;
  let totalPurchased = 0;
  let totalSpent = 0;
  let circulating = 0;
  let holders = 0;
  const earners: { address: string; displayName?: string; earned: number }[] = [];
  for (const u of store.users.values()) {
    if (isBot(u.address)) continue;
    const earned = u.burgerEarned ?? 0;
    const purchased = u.burgerPurchased ?? 0;
    const bal = u.burgerBalance ?? 0;
    totalEarned += earned;
    totalPurchased += purchased;
    totalSpent += u.burgerSpent ?? 0;
    circulating += bal;
    if (bal > 0 || earned > 0 || purchased > 0) holders += 1;
    if (earned > 0) earners.push({ address: u.address, displayName: u.displayName, earned });
  }

  const bySource = Object.entries(store.burgerBySource)
    .map(([source, amount]) => ({ source: source as BurgerSource, label: labelFor(source as BurgerSource), amount: amount ?? 0 }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const daily = Object.entries(store.burgerDaily)
    .map(([day, amount]) => ({ day, amount }))
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .slice(0, 30);

  // Average earned per day since the first day we have data for.
  const days = Object.keys(store.burgerDaily);
  const spanDays = Math.max(1, days.length);
  const avgEarnedPerDay = totalEarned / spanDays;

  return {
    totalEarned,
    totalPurchased,
    totalSpent,
    circulating,
    holders,
    avgPerPlayer: holders ? circulating / holders : 0,
    avgEarnedPerDay,
    bySource,
    daily,
    topEarners: earners.sort((a, b) => b.earned - a.earned).slice(0, 10),
    // Purchased ÷ earned: >1 means players buy more than they grind (sink-ready).
    sinkRatio: totalEarned > 0 ? totalPurchased / totalEarned : 0,
    revenueEth: store.burgerRevenueEth,
  };
}
