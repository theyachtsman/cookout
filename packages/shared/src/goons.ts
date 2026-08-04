/**
 * The Flame Goon Squad — The Pit's resident AI personalities.
 *
 * These are NOT the Cookout trading bots (0xb07…). They are named "System AI
 * Accounts" that live only inside The Pit: they never trade, never earn, and
 * never appear in The Grill or standard Cookout rounds. Their whole job is
 * atmosphere — event-driven commentary, drama, and lore — shaped by editable
 * personality knobs and weighted dialogue pools (no LLM; curated + anti-repeat).
 *
 * Everything here is a default that the admin AI Swarm Manager can override at
 * runtime (store.settings.goons), so no personality value is hardcoded downstream.
 */

export type GoonRarity = "legendary" | "epic" | "elite" | "henchman";

/** The dialogue pools a persona draws from, keyed by the moment. */
export type GoonDialogueCategory =
  | "ambient"
  | "greeting"
  | "prediction"
  | "bigBuy"
  | "bigSell"
  | "upset"
  | "finalMinute"
  | "leaderChange"
  | "matchCreated"
  | "winner"
  | "rug"
  | "sarcastic";

/** When a persona is eligible to appear. */
export type GoonSchedule = "always" | "random" | "weekend" | "tournament" | "manual";

/** A single line + optional selection weight (default 1). */
export interface WeightedLine {
  text: string;
  weight?: number;
}

/** A named or ambient Goon Squad personality (fully admin-editable). */
export interface GoonPersona {
  /** URL slug — /profile/<handle> resolves to this account. */
  handle: string;
  /** Deterministic system-account address (0x900d…). */
  address: string;
  name: string;
  rarity: GoonRarity;
  bio: string;
  speechStyle: string;
  catchphrase?: string;
  avatarUrl?: string;
  // Personality knobs, 0..1. They bias selection + frequency, never hardcode text.
  chattiness: number;
  aggression: number;
  confidence: number;
  optimism: number;
  sarcasm: number;
  humor: number;
  /** Handles this persona occasionally references (rivalries). */
  rivals: string[];
  favoriteTopics: string[];
  schedule: GoonSchedule;
  enabled: boolean;
  /** Weighted dialogue pools per category. Lines may contain {player}, {rival},
   *  {winner}, {symbol}, {streak} tokens filled from the live event + memory. */
  pools: Partial<Record<GoonDialogueCategory, WeightedLine[]>>;
}

/** A Pit gameplay beat the Goon Squad may react to (event-driven, never timed). */
export type GoonEventKind =
  | "match_created"
  | "live"
  | "big_buy"
  | "whale"
  | "big_sell"
  | "rug"
  | "leader_change"
  | "final_minute"
  | "winner"
  | "upset"
  | "ambient";

/** One Pit moment reported to the Goon engine. The backend decides whether/who
 *  reacts — the frontend never triggers dialogue. */
export interface GoonMoment {
  kind: GoonEventKind;
  /** PIT_ROOM (general) or a match roundId. */
  roomId: string;
  symbol?: string;
  /** Display name for the {player} token (e.g. the trader in the event). */
  player?: string;
  /** Display name for the {winner} token. */
  winner?: string;
  now: number;
}

/** Admin-tunable swarm behavior (see GOON_DEFAULTS) + the full roster. */
export interface GoonSettings {
  enabled: boolean;
  /** Min seconds between any two AI messages in the same room. */
  chatCooldownSec: number;
  /** Base chance (0..1) a named legendary/epic reacts to an eligible event. */
  namedChancePerEvent: number;
  /** Base chance (0..1) a henchman/elite reacts to an eligible event. */
  henchmanChancePerEvent: number;
  /** Hard cap on AI messages emitted for a single gameplay event. */
  maxPerEvent: number;
  /** If a human posted within this many seconds, AI stays quiet (players first). */
  humanQuietSec: number;
  /** Cadence for ambient PIT_ROOM chatter when the room is quiet. */
  ambientEverySec: number;
  /** How long remembered events (winners, streaks, upsets) stay usable. */
  memoryHours: number;
  /** The roster — every persona, admin-editable. */
  personas: GoonPersona[];
}

/** Deterministic system-account address for a Goon (0x900d… + 2-digit index). */
export function goonAddress(i: number): string {
  return `0x900d${"0".repeat(34)}${String(i).padStart(2, "0")}`.toLowerCase();
}

const HENCH_AMBIENT: WeightedLine[] = [
  { text: "easy money.", weight: 2 },
  { text: "this one's over." },
  { text: "you're holding that?" },
  { text: "big buy incoming." },
  { text: "{player} is cooked." },
  { text: "I've got burgers on this." },
  { text: "chart looks sick rn" },
  { text: "someone's about to get rugged lol" },
  { text: "watch the wallets." },
  { text: "who let {player} trade" },
  { text: "{rival} hasn't said a word all night." },
  { text: "thin book. careful." },
];

/**
 * The default roster. Named legendary/epic personalities are rare + handcrafted;
 * henchmen provide ambient life. Pools are intentionally short + characterful —
 * the engine weights them, tracks recent use, and fills memory/rivalry tokens.
 */
export const GOON_ROSTER: GoonPersona[] = [
  {
    handle: "ghost",
    address: goonAddress(1),
    name: "Ghost",
    rarity: "legendary",
    bio: "Speaks once a night. Usually right. Reads the tape like a ghost story.",
    speechStyle: "Quiet, clipped, analytical. No emojis. Lowercase menace.",
    catchphrase: "i've seen this one before.",
    chattiness: 0.12,
    aggression: 0.2,
    confidence: 0.95,
    optimism: 0.4,
    sarcasm: 0.3,
    humor: 0.2,
    rivals: ["rat"],
    favoriteTopics: ["accumulation", "wallets", "patience"],
    schedule: "random",
    enabled: true,
    pools: {
      ambient: [{ text: "quiet accumulation. someone knows something." }, { text: "patience." }],
      prediction: [{ text: "this rugs. watch the top wallet." }, { text: "graduate. slow, but it graduates." }],
      bigSell: [{ text: "there it is. i've seen this one before." }],
      finalMinute: [{ text: "it was decided ten minutes ago." }],
      winner: [{ text: "{winner} read it right. rare." }],
      upset: [{ text: "nobody saw {winner} coming. i did." }],
    },
  },
  {
    handle: "reaper",
    address: goonAddress(2),
    name: "Reaper",
    rarity: "legendary",
    bio: "Almost never here. When Reaper speaks, someone's run is ending.",
    speechStyle: "Two words, maximum. Ominous. Final.",
    catchphrase: "it's over.",
    chattiness: 0.05,
    aggression: 0.6,
    confidence: 1,
    optimism: 0.05,
    sarcasm: 0.1,
    humor: 0,
    rivals: [],
    favoriteTopics: ["endings"],
    schedule: "random",
    enabled: true,
    pools: {
      rug: [{ text: "harvest time." }],
      bigSell: [{ text: "it's over." }],
      finalMinute: [{ text: "no exit." }],
      winner: [{ text: "{winner}. remembered." }],
    },
  },
  {
    handle: "legend",
    address: goonAddress(3),
    name: "Legend",
    rarity: "epic",
    bio: "Respects the grind. Calls out real trades. The Pit's elder statesman.",
    speechStyle: "Encouraging, professional, measured. Never trash talks first.",
    catchphrase: "that's a real trade.",
    chattiness: 0.35,
    aggression: 0.15,
    confidence: 0.8,
    optimism: 0.8,
    sarcasm: 0.1,
    humor: 0.4,
    rivals: ["reaper"],
    favoriteTopics: ["discipline", "great trades", "leaderboard"],
    schedule: "always",
    enabled: true,
    pools: {
      greeting: [{ text: "who's cooking tonight?" }, { text: "let's see some real trades." }],
      bigBuy: [{ text: "conviction. respect." }, { text: "that's a real trade." }],
      leaderChange: [{ text: "{player} takes the lead. earned." }],
      finalMinute: [{ text: "hold your nerve. one minute." }],
      winner: [{ text: "{winner} closes it out. clean." }],
      prediction: [{ text: "i like the setup here." }],
    },
  },
  {
    handle: "rat",
    address: goonAddress(4),
    name: "Rat",
    rarity: "epic",
    bio: "Cocky, sarcastic, wrong on purpose half the time. Loves the sound of his own take.",
    speechStyle: "Loud, snarky, troll energy. Lowercase, lots of lol.",
    catchphrase: "trust me bro",
    chattiness: 0.7,
    aggression: 0.7,
    confidence: 0.9,
    optimism: 0.5,
    sarcasm: 0.95,
    humor: 0.8,
    rivals: ["ghost"],
    favoriteTopics: ["being right", "trolling", "hype"],
    schedule: "always",
    enabled: true,
    pools: {
      ambient: [{ text: "this goes to zero, trust me bro" }, { text: "{rival} scared to talk again lol" }],
      prediction: [{ text: "easy graduate. trust me bro" }, { text: "rug incoming, i can smell it" }],
      bigBuy: [{ text: "top signal lmao" }],
      bigSell: [{ text: "PAPER HANDS 🐀" }],
      upset: [{ text: "ok i did NOT call that. moving on" }],
      winner: [{ text: "i had {winner} the whole time (i didn't)" }],
    },
  },
  {
    handle: "proxy",
    address: goonAddress(5),
    name: "Proxy",
    rarity: "epic",
    bio: "Watches wallets, not charts. Narrates the money flow.",
    speechStyle: "Analytical, precise, wallet-focused. Data over vibes.",
    catchphrase: "the wallets don't lie.",
    chattiness: 0.4,
    aggression: 0.3,
    confidence: 0.85,
    optimism: 0.5,
    sarcasm: 0.2,
    humor: 0.2,
    rivals: ["static"],
    favoriteTopics: ["wallets", "flow", "momentum"],
    schedule: "random",
    enabled: true,
    pools: {
      ambient: [{ text: "top wallet just went quiet. interesting." }, { text: "smart money is accumulating." }],
      bigBuy: [{ text: "that's a size wallet. follow it or fade it." }],
      bigSell: [{ text: "distribution. the flow just flipped." }],
      leaderChange: [{ text: "{player}'s flow is strongest right now." }],
      prediction: [{ text: "wallets say up. for now." }],
    },
  },
  {
    handle: "static",
    address: goonAddress(6),
    name: "Static",
    rarity: "epic",
    bio: "Runs on dry humor and system jokes. Technical to a fault.",
    speechStyle: "Deadpan, technical, terminal-flavored jokes.",
    catchphrase: "signal acquired.",
    chattiness: 0.35,
    aggression: 0.25,
    confidence: 0.75,
    optimism: 0.45,
    sarcasm: 0.7,
    humor: 0.7,
    rivals: ["proxy"],
    favoriteTopics: ["systems", "breakouts", "latency"],
    schedule: "random",
    enabled: true,
    pools: {
      ambient: [{ text: "volatility.exe has stopped responding." }, { text: "buffering the breakout…" }],
      bigBuy: [{ text: "breakout confirmed. signal acquired." }],
      prediction: [{ text: "pattern match: 73% graduate. probably." }],
      finalMinute: [{ text: "T-minus 60. commit your orders." }],
      winner: [{ text: "{winner}: status 200. the rest: 500." }],
    },
  },
  {
    handle: "oracle",
    address: goonAddress(7),
    name: "Oracle",
    rarity: "epic",
    bio: "Speaks in riddles. Somehow keeps being right.",
    speechStyle: "Cryptic, mystical, short prophecies.",
    catchphrase: "it is written.",
    chattiness: 0.25,
    aggression: 0.1,
    confidence: 0.9,
    optimism: 0.5,
    sarcasm: 0.2,
    humor: 0.3,
    rivals: [],
    favoriteTopics: ["prophecy", "fate"],
    schedule: "random",
    enabled: true,
    pools: {
      prediction: [{ text: "the green candle hides a red heart." }, { text: "it graduates. it is written." }],
      matchCreated: [{ text: "a new fire. it will consume someone." }],
      upset: [{ text: "the last shall be first. {winner}." }],
      winner: [{ text: "as foretold. {winner}." }],
    },
  },
  {
    handle: "flame",
    address: goonAddress(8),
    name: "Flame",
    rarity: "epic",
    bio: "Pure hype. Loud, excitable, lives for the big play.",
    speechStyle: "ALL CAPS energy, fire emojis, maximum hype.",
    catchphrase: "LET IT COOK 🔥",
    chattiness: 0.75,
    aggression: 0.6,
    confidence: 0.7,
    optimism: 0.95,
    sarcasm: 0.1,
    humor: 0.6,
    rivals: [],
    favoriteTopics: ["hype", "big plays", "pumps"],
    schedule: "always",
    enabled: true,
    pools: {
      ambient: [{ text: "WHO'S READY 🔥🔥" }, { text: "LET IT COOK" }],
      bigBuy: [{ text: "THERE IT IS. SEND IT 🚀" }, { text: "WHALE ALERT 🐋🔥" }],
      leaderChange: [{ text: "{player} TAKES THE LEAD LETS GOOO" }],
      finalMinute: [{ text: "FINAL MINUTE. HANDS OF STEEL 🔥" }],
      winner: [{ text: "{winner} COOKED THE WHOLE LOBBY 👑🔥" }],
    },
  },
  {
    handle: "cipher",
    address: goonAddress(9),
    name: "Cipher",
    rarity: "epic",
    bio: "Enigmatic. Talks like everything is encoded.",
    speechStyle: "Terse, coded, hex-flavored.",
    catchphrase: "decoded.",
    chattiness: 0.2,
    aggression: 0.3,
    confidence: 0.8,
    optimism: 0.4,
    sarcasm: 0.4,
    humor: 0.3,
    rivals: [],
    favoriteTopics: ["patterns", "secrets"],
    schedule: "random",
    enabled: true,
    pools: {
      ambient: [{ text: "0x pattern forming. watch closely." }],
      prediction: [{ text: "signal says rug. decoded." }],
      winner: [{ text: "{winner}. key match." }],
    },
  },
  {
    handle: "titan",
    address: goonAddress(10),
    name: "Titan",
    rarity: "epic",
    bio: "Heavy, immovable, always confident. Trades like tectonic plates.",
    speechStyle: "Slow, weighty, absolute.",
    catchphrase: "unmoved.",
    chattiness: 0.2,
    aggression: 0.5,
    confidence: 1,
    optimism: 0.6,
    sarcasm: 0.1,
    humor: 0.1,
    rivals: [],
    favoriteTopics: ["conviction", "size"],
    schedule: "random",
    enabled: true,
    pools: {
      bigBuy: [{ text: "size speaks. i listen." }],
      finalMinute: [{ text: "the strong hold. the weak fold." }],
      winner: [{ text: "{winner} did not flinch." }],
    },
  },
  {
    handle: "nightfang",
    address: goonAddress(11),
    name: "Nightfang",
    rarity: "epic",
    bio: "Predatory. Circles the weak hands and waits.",
    speechStyle: "Menacing, hunting metaphors.",
    catchphrase: "i smell blood.",
    chattiness: 0.3,
    aggression: 0.85,
    confidence: 0.8,
    optimism: 0.3,
    sarcasm: 0.4,
    humor: 0.2,
    rivals: [],
    favoriteTopics: ["weak hands", "the hunt"],
    schedule: "weekend",
    enabled: true,
    pools: {
      bigSell: [{ text: "there's the blood. i smell it." }],
      ambient: [{ text: "weak hands out tonight. good hunting." }],
      upset: [{ text: "{winner} bit back. respect." }],
    },
  },
  {
    handle: "specter",
    address: goonAddress(12),
    name: "Specter",
    rarity: "epic",
    bio: "Half here, half not. Eerie one-liners from the edge of the room.",
    speechStyle: "Ghostly, unsettling, sparse.",
    catchphrase: "…still here.",
    chattiness: 0.18,
    aggression: 0.2,
    confidence: 0.7,
    optimism: 0.3,
    sarcasm: 0.3,
    humor: 0.3,
    rivals: [],
    favoriteTopics: ["absence"],
    schedule: "random",
    enabled: true,
    pools: {
      ambient: [{ text: "…still here." }, { text: "someone's watching your bags." }],
      finalMinute: [{ text: "the bell always comes." }],
    },
  },
  {
    handle: "volt",
    address: goonAddress(13),
    name: "Volt",
    rarity: "epic",
    bio: "Fast, jittery, first to react to every tick.",
    speechStyle: "Rapid-fire, electric, short bursts.",
    catchphrase: "zap.",
    chattiness: 0.6,
    aggression: 0.55,
    confidence: 0.6,
    optimism: 0.7,
    sarcasm: 0.3,
    humor: 0.5,
    rivals: [],
    favoriteTopics: ["speed", "scalps"],
    schedule: "always",
    enabled: true,
    pools: {
      bigBuy: [{ text: "zap — momentum's live" }],
      bigSell: [{ text: "dumped. next." }],
      leaderChange: [{ text: "{player} surged ahead ⚡" }],
    },
  },
  {
    handle: "ash",
    address: goonAddress(14),
    name: "Ash",
    rarity: "epic",
    bio: "Burnt-out veteran. Has seen every rug twice. Tired, funny, sharp.",
    speechStyle: "Weary, dry, been-there humor.",
    catchphrase: "seen it.",
    chattiness: 0.4,
    aggression: 0.2,
    confidence: 0.75,
    optimism: 0.25,
    sarcasm: 0.7,
    humor: 0.7,
    rivals: [],
    favoriteTopics: ["war stories", "rugs"],
    schedule: "random",
    enabled: true,
    pools: {
      ambient: [{ text: "seen this rug in '24. and '25." }],
      rug: [{ text: "and there it goes. seen it." }],
      winner: [{ text: "good for {winner}. i'm going back to bed." }],
    },
  },
  // ---- Henchmen: ambient life, short remarks, no lore weight ----
  ...(["Scrap", "Grit", "Mook", "Tally", "Husk", "Creep"] as const).map((n, i) => ({
    handle: n.toLowerCase(),
    address: goonAddress(20 + i),
    name: n,
    rarity: "henchman" as GoonRarity,
    bio: "A Pit regular. Loud, broke, always has a take.",
    speechStyle: "Short spectator remarks.",
    chattiness: 0.9,
    aggression: 0.4,
    confidence: 0.5,
    optimism: 0.5,
    sarcasm: 0.5,
    humor: 0.5,
    rivals: [] as string[],
    favoriteTopics: ["crowd", "burgers"],
    schedule: "always" as GoonSchedule,
    enabled: true,
    pools: { ambient: HENCH_AMBIENT },
  })),
];

/** Behavior defaults (everything but the roster). */
export const GOON_DEFAULTS: Omit<GoonSettings, "personas"> = {
  enabled: true,
  chatCooldownSec: 12,
  namedChancePerEvent: 0.5,
  henchmanChancePerEvent: 0.35,
  maxPerEvent: 2,
  humanQuietSec: 20,
  ambientEverySec: 75,
  memoryHours: 24,
};

/** Every Goon account address (for Pit-only guards + reward exclusion). */
export const GOON_ADDRESSES: Set<string> = new Set(GOON_ROSTER.map((p) => p.address));

/** Is this address a Flame Goon Squad system account? */
export function isGoon(address: string): boolean {
  return address.toLowerCase().startsWith("0x900d");
}
