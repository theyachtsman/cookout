/**
 * Cosmetics (spec §10): badges, titles, chat colors, profile frames.
 * Strictly cosmetic — unlocks come from levels, achievements, and season
 * placements only. Nothing here is purchasable and nothing affects gameplay.
 */

export type CosmeticType = "title" | "badge" | "chat_color" | "frame";

export interface CosmeticDef {
  id: string;
  type: CosmeticType;
  name: string;
  /** Rendered value: emoji for badges, hex for chat colors, css class for frames. */
  value: string;
  unlock: {
    level?: number;
    achievement?: string;
    seasonTop?: number;
    monthlyXp?: number;
    /** Unlocked once the account has claimed a Founding Member number. */
    founder?: boolean;
  };
}

export const COSMETICS: CosmeticDef[] = [
  // Badges (emoji shown next to name in chat/leaderboards)
  { id: "b_flame", type: "badge", name: "Flame", value: "🔥", unlock: { level: 5 } },
  { id: "b_chart", type: "badge", name: "Tape Reader", value: "📈", unlock: { level: 15 } },
  { id: "b_whale", type: "badge", name: "Whale", value: "🐋", unlock: { level: 50 } },
  { id: "b_crown", type: "badge", name: "Crown", value: "👑", unlock: { level: 80 } },
  { id: "b_diamond", type: "badge", name: "Diamond", value: "💎", unlock: { achievement: "diamond_hands" } },
  { id: "b_shield", type: "badge", name: "Survivor", value: "🛡️", unlock: { achievement: "rug_survivor" } },
  { id: "b_grad", type: "badge", name: "Alumni Launcher", value: "🎓", unlock: { achievement: "graduate_launcher" } },
  { id: "b_oracle", type: "badge", name: "Oracle Eye", value: "🔮", unlock: { achievement: "oracle" } },
  { id: "b_podium", type: "badge", name: "Podium", value: "🏆", unlock: { seasonTop: 100 } },
  { id: "b_pass", type: "badge", name: "Season Pass", value: "🎟️", unlock: { monthlyXp: 800 } },
  { id: "b_founder", type: "badge", name: "Founding Member", value: "🥇", unlock: { founder: true } },
  // Titles (vanity display titles, separate from level titles)
  { id: "t_founder", type: "title", name: "Founding Member", value: "Founding Member", unlock: { founder: true } },
  { id: "t_early", type: "title", name: "Day One", value: "Day One", unlock: { level: 2 } },
  { id: "t_grill", type: "title", name: "Grillmaster", value: "Grillmaster", unlock: { level: 25 } },
  { id: "t_perfect", type: "title", name: "Clean Exit", value: "Clean Exit", unlock: { achievement: "perfect_exit" } },
  { id: "t_comeback", type: "title", name: "Comeback Kid", value: "Comeback Kid", unlock: { achievement: "comeback_kid" } },
  { id: "t_100x", type: "title", name: "Centurion", value: "Centurion", unlock: { achievement: "hundred_x" } },
  // Chat colors
  { id: "c_amber", type: "chat_color", name: "Amber", value: "#f59e0b", unlock: { level: 10 } },
  { id: "c_emerald", type: "chat_color", name: "Emerald", value: "#10b981", unlock: { level: 20 } },
  { id: "c_sky", type: "chat_color", name: "Sky", value: "#38bdf8", unlock: { level: 35 } },
  { id: "c_rose", type: "chat_color", name: "Rose", value: "#fb7185", unlock: { level: 65 } },
  // Profile frames
  { id: "f_bronze", type: "frame", name: "Bronze Frame", value: "frame-bronze", unlock: { level: 10 } },
  { id: "f_silver", type: "frame", name: "Silver Frame", value: "frame-silver", unlock: { level: 35 } },
  { id: "f_gold", type: "frame", name: "Gold Frame", value: "frame-gold", unlock: { level: 65 } },
  { id: "f_season", type: "frame", name: "Season Frame", value: "frame-season", unlock: { monthlyXp: 3500 } },

  // Flame Trial cosmetics (earned through Trial progression)
  { id: "b_trial", type: "badge", name: "Trial Winner", value: "🏅", unlock: { achievement: "first_flame" } },
  { id: "b_fireproof", type: "badge", name: "Fireproof", value: "🧯", unlock: { achievement: "fireproof" } },
  { id: "b_untouchable", type: "badge", name: "Untouchable", value: "✨", unlock: { achievement: "untouchable" } },
  { id: "b_mythic_trial", type: "badge", name: "Mythic Flame", value: "☄️", unlock: { achievement: "legend_hunter" } },
  { id: "t_flamesurvivor", type: "title", name: "Flame Survivor", value: "Flame Survivor", unlock: { achievement: "first_flame" } },
  { id: "t_firewalker", type: "title", name: "Fire Walker", value: "Fire Walker", unlock: { achievement: "heat_resistant" } },
  { id: "t_trialmaster", type: "title", name: "Trial Master", value: "Trial Master", unlock: { achievement: "fireproof" } },
  { id: "t_lastflame", type: "title", name: "The Last Flame", value: "The Last Flame", unlock: { achievement: "legend_hunter" } },

  // Endurance cosmetics (earned through the no-timer launchpad track)
  { id: "b_endurance", type: "badge", name: "Slow Cook", value: "🕛", unlock: { achievement: "endurance_initiate" } },
  { id: "b_longhaul", type: "badge", name: "Long Haul", value: "🐢", unlock: { achievement: "long_hauler" } },
  { id: "b_marathon", type: "badge", name: "Marathoner", value: "⏳", unlock: { achievement: "marathon_runner" } },
  { id: "b_unshaken", type: "badge", name: "Unshaken", value: "🪨", unlock: { achievement: "unshaken" } },
  { id: "b_builder", type: "badge", name: "Built to Last", value: "🏗️", unlock: { achievement: "endurance_launcher" } },
  { id: "t_longhauler", type: "title", name: "Long Hauler", value: "Long Hauler", unlock: { achievement: "long_hauler" } },
  { id: "t_marathoner", type: "title", name: "Marathoner", value: "Marathoner", unlock: { achievement: "marathon_runner" } },
  { id: "t_stillstanding", type: "title", name: "Still Standing", value: "Still Standing", unlock: { achievement: "endurance_veteran" } },
  { id: "t_distance", type: "title", name: "Went the Distance", value: "Went the Distance", unlock: { achievement: "went_the_distance" } },
  { id: "t_unshaken", type: "title", name: "Unshaken", value: "Unshaken", unlock: { achievement: "unshaken" } },
  { id: "t_builder", type: "title", name: "Built to Last", value: "Built to Last", unlock: { achievement: "endurance_launcher" } },
];

export interface EquippedCosmetics {
  title?: string;
  badge?: string;
  chatColor?: string;
  frame?: string;
}

/** Which cosmetics a player has unlocked. seasonTops = best season placements. */
export function unlockedCosmetics(user: {
  level: number;
  achievements: string[];
  bestSeasonRank?: number;
  /** This month's season XP — unlocks season-pass cosmetics. */
  monthlyXp?: number;
  /** Has claimed a Founding Member number — unlocks the founder cosmetics. */
  founder?: boolean;
}): CosmeticDef[] {
  return COSMETICS.filter((c) => {
    if (c.unlock.level !== undefined) return user.level >= c.unlock.level;
    if (c.unlock.achievement !== undefined) return user.achievements.includes(c.unlock.achievement);
    if (c.unlock.seasonTop !== undefined)
      return user.bestSeasonRank !== undefined && user.bestSeasonRank <= c.unlock.seasonTop;
    if (c.unlock.monthlyXp !== undefined) return (user.monthlyXp ?? 0) >= c.unlock.monthlyXp;
    if (c.unlock.founder) return !!user.founder;
    return false;
  });
}
