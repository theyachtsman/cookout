/**
 * Database-backed gameplay configuration.
 *
 * Every value here used to be a constant compiled into the build, which meant
 * retuning a fee or adding a daily quest needed a deploy. The constants are
 * still the source of the *defaults* — `freshGameSettings()` seeds from them —
 * but the running values live in the store and are edited from the Command
 * Center's Game Configuration module.
 *
 * The rule for anything in here: read it through the store's resolvers
 * (`store.tierConfig()`, `store.xpFor()`, …), never from the constant directly.
 * The constants remain exported so the defaults, and the "reset to default"
 * button, have something to point at.
 */
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_XP,
  PODIUM_XP,
  TRADE_XP,
  XP_AWARDS,
  type AchievementDef,
  type XpEventKind,
} from "./gamification.js";
import { BOND_TARGET_USD, GAME_MODES, TIER_CONFIGS } from "./constants.js";
import {
  DAILY_ACTIVE_COUNT,
  DAILY_SET_BONUS_XP,
  MISSIONS,
  WEEKLY_SET_BONUS_XP,
  type MissionDef,
} from "./missions.js";
import type { GameMode, RiskTier, RoundConfig } from "./types.js";

/** The tunable half of a game mode. Name, tagline and blurb stay in code. */
export interface GameModeSettings {
  /** Live-trading minutes; null = no timer (Endurance). */
  minutes: number | null;
  rugRules: boolean;
  tier: RiskTier;
  pullUpCap: number;
  unlockLevel: number;
  /** Listed in the launchpad but not launchable. */
  disabled: boolean;
}

/** A quest's tunable fields. The metric it measures stays in code. */
export interface MissionSettings {
  target: number;
  xp: number;
  enabled: boolean;
}

/** An achievement's tunable fields. Its unlock condition stays in code. */
export interface AchievementSettings {
  rarity: AchievementDef["rarity"];
  enabled: boolean;
}

export interface GameSettings {
  /** Round economics per risk tier — fees, liquidity, caps, graduation bars. */
  tiers: Record<RiskTier, RoundConfig>;
  /** The curated launch modes. */
  modes: Record<GameMode, GameModeSettings>;
  /** XP paid per event. */
  xp: Record<XpEventKind, number>;
  /** Round podium XP by finishing rank. */
  podiumXp: number[];
  /** Per-trade XP decay curve and its caps. */
  tradeXp: { base: number; decay: number; roundCap: number; dailyCap: number };
  /** One-time XP for unlocking an achievement, by rarity. */
  achievementXp: Record<AchievementDef["rarity"], number>;
  /** Bonding target in USD — the market cap a coin must reach to serve up. */
  bondTargetUsd: number;
  /** Quests, keyed by mission id. */
  missions: Record<string, MissionSettings>;
  /** How many of the daily pool are live each day. */
  dailyActiveCount: number;
  dailySetBonusXp: number;
  weeklySetBonusXp: number;
  /** Achievements, keyed by id. */
  achievements: Record<string, AchievementSettings>;
}

/**
 * A fresh settings object seeded from the compiled defaults. Deep-copied
 * throughout, so an admin edit can never mutate the constants themselves —
 * the same pattern the Pit, Burger and Goon settings already use.
 */
export function freshGameSettings(): GameSettings {
  return {
    tiers: {
      rookie: { ...TIER_CONFIGS.rookie },
      standard: { ...TIER_CONFIGS.standard },
      degen: { ...TIER_CONFIGS.degen },
    },
    modes: Object.fromEntries(
      GAME_MODES.map((m) => [
        m.key,
        {
          minutes: m.minutes,
          rugRules: m.rugRules,
          tier: m.tier,
          pullUpCap: m.pullUpCap,
          unlockLevel: m.unlockLevel,
          disabled: !!m.disabled,
        } satisfies GameModeSettings,
      ]),
    ) as Record<GameMode, GameModeSettings>,
    xp: { ...XP_AWARDS },
    podiumXp: [...PODIUM_XP],
    tradeXp: { ...TRADE_XP },
    achievementXp: { ...ACHIEVEMENT_XP },
    bondTargetUsd: BOND_TARGET_USD,
    missions: Object.fromEntries(
      MISSIONS.map((m) => [m.id, { target: m.target, xp: m.xp, enabled: true } satisfies MissionSettings]),
    ),
    dailyActiveCount: DAILY_ACTIVE_COUNT,
    dailySetBonusXp: DAILY_SET_BONUS_XP,
    weeklySetBonusXp: WEEKLY_SET_BONUS_XP,
    achievements: Object.fromEntries(
      ACHIEVEMENTS.map((a) => [a.id, { rarity: a.rarity, enabled: true } satisfies AchievementSettings]),
    ),
  };
}

/**
 * Fill in anything a stored settings object is missing.
 *
 * Snapshots predate every future addition — a new game mode, quest or
 * achievement ships in code and has no stored row yet. Merging on load means
 * new content appears with its default immediately, and an operator's existing
 * edits are never clobbered.
 */
export function mergeGameSettings(stored: Partial<GameSettings> | undefined): GameSettings {
  const fresh = freshGameSettings();
  if (!stored) return fresh;
  return {
    tiers: { ...fresh.tiers, ...(stored.tiers ?? {}) },
    modes: { ...fresh.modes, ...(stored.modes ?? {}) },
    xp: { ...fresh.xp, ...(stored.xp ?? {}) },
    podiumXp: stored.podiumXp?.length ? [...stored.podiumXp] : fresh.podiumXp,
    tradeXp: { ...fresh.tradeXp, ...(stored.tradeXp ?? {}) },
    achievementXp: { ...fresh.achievementXp, ...(stored.achievementXp ?? {}) },
    bondTargetUsd: stored.bondTargetUsd ?? fresh.bondTargetUsd,
    missions: { ...fresh.missions, ...(stored.missions ?? {}) },
    dailyActiveCount: stored.dailyActiveCount ?? fresh.dailyActiveCount,
    dailySetBonusXp: stored.dailySetBonusXp ?? fresh.dailySetBonusXp,
    weeklySetBonusXp: stored.weeklySetBonusXp ?? fresh.weeklySetBonusXp,
    achievements: { ...fresh.achievements, ...(stored.achievements ?? {}) },
  };
}

/** Apply the stored overrides to a mission definition. */
export function resolveMission(def: MissionDef, settings: GameSettings): MissionDef {
  const o = settings.missions[def.id];
  return o ? { ...def, target: o.target, xp: o.xp } : def;
}

/**
 * Guardrails for the config editor. A gameplay value that is merely *wrong* is
 * an operator's problem; a value that breaks the engine (a zero-length round, a
 * negative fee, a pool with no liquidity) is ours to refuse. Returns a reason,
 * or null when the value is acceptable.
 */
export function gameSettingProblem(path: string, value: unknown): string | null {
  const n = typeof value === "number" ? value : NaN;
  const positive = (label: string) => (n > 0 ? null : `${label} must be greater than zero`);
  const nonNegative = (label: string) => (n >= 0 ? null : `${label} can't be negative`);

  if (path.endsWith(".maxDurationSeconds")) return positive("round length");
  if (path.endsWith(".initialEthLiquidity")) return positive("seed liquidity");
  if (path.endsWith(".initialTokenLiquidity")) return positive("seed token liquidity");
  if (path.endsWith(".totalSupply")) return positive("total supply");
  if (path.endsWith(".graduationMcap")) return positive("graduation market cap");
  if (path.endsWith("bondTargetUsd")) return positive("bond target");
  if (path.endsWith("Bps")) {
    if (!(n >= 0)) return "a fee can't be negative";
    if (n > 10_000) return "a fee can't exceed 100% (10000 bps)";
    return null;
  }
  if (path.endsWith(".pullUpCap")) return positive("pull-up cap");
  if (path.endsWith(".unlockLevel")) return n >= 1 ? null : "unlock level starts at 1";
  if (path.endsWith(".minutes")) return value === null || n > 0 ? null : "match length must be positive, or null for no timer";
  if (path.startsWith("xp.") || path.endsWith("Xp") || path.endsWith("SetBonusXp")) return nonNegative("XP");
  if (path.endsWith(".target")) return positive("quest target");
  if (path.endsWith("dailyActiveCount")) return n >= 1 ? null : "at least one daily quest must be live";
  if (path.endsWith("tradeXp.decay")) return n > 0 && n <= 1 ? null : "decay must be between 0 and 1";
  if (typeof value === "number" && !Number.isFinite(n)) return "not a number";
  return null;
}
