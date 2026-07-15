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
  unlock: { level?: number; achievement?: string; seasonTop?: number };
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
  // Titles (vanity display titles, separate from level titles)
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
}): CosmeticDef[] {
  return COSMETICS.filter((c) => {
    if (c.unlock.level !== undefined) return user.level >= c.unlock.level;
    if (c.unlock.achievement !== undefined) return user.achievements.includes(c.unlock.achievement);
    if (c.unlock.seasonTop !== undefined)
      return user.bestSeasonRank !== undefined && user.bestSeasonRank <= c.unlock.seasonTop;
    return false;
  });
}
