/**
 * Site copy — every piece of player-facing text, editable from the Command
 * Center instead of compiled into the build.
 *
 * How it works: each string has a stable dotted key and a default that is the
 * text currently shipped. The store keeps a sparse override map, the client is
 * served the resolved result, and `t(key)` reads it. A key with no override
 * renders its default, so adding a new string to the registry is safe and a
 * missing translation is impossible — the worst case is the shipped wording.
 *
 * Keys are permanent. Renaming one orphans whatever an operator wrote for it,
 * so treat them the way you would a database column.
 */
import { ACHIEVEMENTS, LEVEL_TITLES } from "./gamification.js";
import { GAME_MODES, HOUSE_SPECIALS } from "./constants.js";
import { MISSIONS } from "./missions.js";

export interface CopyEntry {
  key: string;
  /** Editor grouping — a page or a system. */
  group: string;
  /** What this string is, for whoever is editing it. */
  label: string;
  defaultText: string;
  /** Render as a textarea rather than a single line. */
  multiline?: boolean;
  /** Guidance: length limits, where it appears, what must stay intact. */
  note?: string;
}

/**
 * Statically-authored copy: pages and UI chrome. Content that already exists as
 * structured data (modes, quests, achievements) is derived below instead, so
 * there is exactly one source for each string.
 */
const STATIC_COPY: CopyEntry[] = [
  // ------------------------------------------------------------- landing
  { key: "landing.badge", group: "Landing page", label: "Top badge", defaultText: "OPEN BETA · 100% PAPER MONEY · NO WALLET NEEDED" },
  { key: "landing.hero.titleA", group: "Landing page", label: "Title, first word", defaultText: "THE" },
  { key: "landing.hero.titleB", group: "Landing page", label: "Title, second word", defaultText: "COOKOUT" },
  { key: "landing.hero.headline", group: "Landing page", label: "Headline", defaultText: "Every chart is a multiplayer match." },
  {
    key: "landing.hero.sub",
    group: "Landing page",
    label: "Sub-headline",
    multiline: true,
    defaultText:
      "A room full of people piles into the same coin at the same second. You get a few minutes to out-trade all of them. Then we run it back.",
  },
  { key: "landing.hero.promise1", group: "Landing page", label: "Promise chip 1", defaultText: "Same price" },
  { key: "landing.hero.promise2", group: "Landing page", label: "Promise chip 2", defaultText: "Same second" },
  { key: "landing.hero.promise3", group: "Landing page", label: "Promise chip 3", defaultText: "No bots" },
  { key: "landing.hero.promise4", group: "Landing page", label: "Promise chip 4", defaultText: "No snipers" },
  { key: "landing.hero.ctaPlay", group: "Landing page", label: "Primary button", defaultText: "Play Now" },
  { key: "landing.hero.ctaWatch", group: "Landing page", label: "Secondary button", defaultText: "Watch a match" },
  { key: "landing.hero.noteTitle", group: "Landing page", label: "Callout, bold part", defaultText: "Pick a name and play." },
  {
    key: "landing.hero.noteBody",
    group: "Landing page",
    label: "Callout, rest",
    defaultText: "Paper money, no deposit, no wallet. You're in a match in under a minute.",
  },

  { key: "landing.stats.online", group: "Landing page", label: "Stat: online label", defaultText: "in the room" },
  { key: "landing.stats.pot", group: "Landing page", label: "Stat: jackpot label", defaultText: "this week's pot" },
  { key: "landing.stats.matches", group: "Landing page", label: "Stat: matches label", defaultText: "matches run" },
  { key: "landing.stats.lengthLabel", group: "Landing page", label: "Stat: match length label", defaultText: "a match takes" },
  { key: "landing.stats.lengthValue", group: "Landing page", label: "Stat: match length value", defaultText: "~10 min" },

  {
    key: "landing.ticker",
    group: "Landing page",
    label: "Rotating ticker lines",
    multiline: true,
    note: "One line per row. These rotate under the hero.",
    defaultText: [
      "🐋 someone walked in with 0.8 and moved the whole chart",
      "🏆 DiamondDan took the PnL lead with 40 seconds left",
      "💀 RUGRAT went to zero. eight people got out first.",
      "🔥 queue filled in under a minute",
      "🍽️ WAGYU served up. holders kept their bags.",
      "📈 fomo_fred doubled his position at the top. bold.",
      "🎰 the pot went up again",
    ].join("\n"),
  },

  { key: "landing.flow.title", group: "Landing page", label: "How-it-works heading", defaultText: "How a match works" },
  { key: "landing.flow.sub", group: "Landing page", label: "How-it-works sub", defaultText: "Ten minutes, start to finish. Then the next one." },
  { key: "landing.flow.step1.title", group: "Landing page", label: "Step 1 title", defaultText: "Pull Up" },
  {
    key: "landing.flow.step1.body",
    group: "Landing page",
    label: "Step 1 body",
    multiline: true,
    defaultText:
      "Somebody's coin comes up on the calendar. You walk into the lobby, see who else is here, and call it: moon or rug.",
  },
  { key: "landing.flow.step2.title", group: "Landing page", label: "Step 2 title", defaultText: "Fair Open" },
  {
    key: "landing.flow.step2.body",
    group: "Landing page",
    label: "Step 2 body",
    multiline: true,
    defaultText:
      "Everyone puts in their buy before the bell. Nobody gets filled early. When it closes, the whole room gets the exact same price.",
  },
  { key: "landing.flow.step3.title", group: "Landing page", label: "Step 3 title", defaultText: "Trade Live" },
  {
    key: "landing.flow.step3.body",
    group: "Landing page",
    label: "Step 3 body",
    multiline: true,
    defaultText:
      "Now it's a real market and everyone can see what you're doing. Scalp it, ride it, or panic. Chat will have opinions either way.",
  },
  { key: "landing.flow.step4.title", group: "Landing page", label: "Step 4 title", defaultText: "Graduate or Burn" },
  {
    key: "landing.flow.step4.body",
    group: "Landing page",
    label: "Step 4 body",
    multiline: true,
    defaultText:
      "Hit the targets and the coin lives on. Fall short and everybody cashes out at the same price. Get rugged and, well, that happened.",
  },

  { key: "landing.fair.eyebrow", group: "Landing page", label: "Fair Open eyebrow", defaultText: "The one rule" },
  { key: "landing.fair.title", group: "Landing page", label: "Fair Open heading", defaultText: "Nobody gets in first." },
  {
    key: "landing.fair.body",
    group: "Landing page",
    label: "Fair Open body",
    multiline: true,
    defaultText:
      "Buys don't fill as they come in. They pile up until the bell, then the whole room gets one price. Being fast doesn't help. Neither does a bot.",
  },
  { key: "landing.fair.link", group: "Landing page", label: "Fair Open link text", defaultText: "It's all in the menu." },

  { key: "landing.access.eyebrow", group: "Landing page", label: "Access eyebrow", defaultText: "Open beta" },
  { key: "landing.access.title", group: "Landing page", label: "Access heading", defaultText: "Just play. Right now." },
  {
    key: "landing.access.body",
    group: "Landing page",
    label: "Access body",
    multiline: true,
    defaultText:
      "No whitelist, no waves, no wallet. It's all paper money while we're in beta, so the only thing you're risking is your ego. Bring a wallet later if you want. You don't need one to play.",
  },
  { key: "landing.access.step1.title", group: "Landing page", label: "Access step 1 title", defaultText: "Pick a name" },
  {
    key: "landing.access.step1.body",
    group: "Landing page",
    label: "Access step 1 body",
    multiline: true,
    defaultText: "No email, no wallet, no forms. Choose a handle and you have an account.",
  },
  { key: "landing.access.step2.title", group: "Landing page", label: "Access step 2 title", defaultText: "Get your paper stack" },
  {
    key: "landing.access.step2.body",
    group: "Landing page",
    label: "Access step 2 body",
    multiline: true,
    defaultText:
      "We stake your starter pETH into your Cook Out Balance automatically. It's paper. Nothing to deposit, nothing at risk.",
  },
  { key: "landing.access.step3.title", group: "Landing page", label: "Access step 3 title", defaultText: "Walk into a match" },
  {
    key: "landing.access.step3.body",
    group: "Landing page",
    label: "Access step 3 body",
    multiline: true,
    defaultText: "There's always one running. You're trading against the room in under a minute.",
  },
  { key: "landing.access.cta", group: "Landing page", label: "Access button", defaultText: "Play Now →" },
  { key: "landing.access.chip1", group: "Landing page", label: "Access chip 1", defaultText: "No whitelist" },
  { key: "landing.access.chip2", group: "Landing page", label: "Access chip 2", defaultText: "No deposit" },
  { key: "landing.access.chip3", group: "Landing page", label: "Access chip 3", defaultText: "No wallet needed" },
  { key: "landing.access.chip4", group: "Landing page", label: "Access chip 4", defaultText: "Instant" },
  {
    key: "landing.access.safety",
    group: "Landing page",
    label: "Safety notice",
    multiline: true,
    note: "{handle} is replaced with the official X account.",
    defaultText:
      "Safety: {handle} is our only official account. We will never DM you first, never ask for a seed phrase, and never charge you to play.",
  },
  // The slogan is three coloured fragments, so each is its own string.
  { key: "landing.slogan.a", group: "Landing page", label: "Slogan, part 1", defaultText: "Same price.", note: "Shown in the hero and the Fair Open band." },
  { key: "landing.slogan.b", group: "Landing page", label: "Slogan, part 2", defaultText: "Same second." },
  { key: "landing.slogan.c", group: "Landing page", label: "Slogan, part 3", defaultText: "Everyone." },

  // ---------------------------------------------------------------- docs
  { key: "docs.title", group: "Docs", label: "Page title", defaultText: "Menu" },
  {
    key: "docs.intro",
    group: "Docs",
    label: "Page intro",
    multiline: true,
    defaultText:
      "Everything you need before you pull up. Five minutes to read; a lifetime to master the exit.",
  },
  { key: "docs.section.what", group: "Docs", label: "Section: What is The Cookout?", defaultText: "What is The Cookout?" },
  { key: "docs.section.account", group: "Docs", label: "Section: account", defaultText: "Getting In & Your Account" },
  { key: "docs.section.round", group: "Docs", label: "Section: round", defaultText: "Anatomy of a Round" },
  { key: "docs.section.auction", group: "Docs", label: "Section: auction", defaultText: "The Fair Open" },
  { key: "docs.section.trading", group: "Docs", label: "Section: trading", defaultText: "Live Trading" },
  { key: "docs.section.endings", group: "Docs", label: "Section: endings", defaultText: "Rugs, Redemption & Graduation" },
  { key: "docs.section.modes", group: "Docs", label: "Section: modes", defaultText: "Game Modes" },
  { key: "docs.section.pit", group: "Docs", label: "Section: pit", defaultText: "The Pit (vs Swarm AI)" },
  { key: "docs.section.reputation", group: "Docs", label: "Section: reputation", defaultText: "Reputation & Rug Bans" },
  { key: "docs.section.tiers", group: "Docs", label: "Section: tiers", defaultText: "Risk Tiers (under the hood)" },
  { key: "docs.section.progression", group: "Docs", label: "Section: progression", defaultText: "XP, Levels & Titles" },
  { key: "docs.section.jackpot", group: "Docs", label: "Section: jackpot", defaultText: "The Weekly Jackpot" },
  { key: "docs.section.quests", group: "Docs", label: "Section: quests", defaultText: "Quests & Earning XP" },
  { key: "docs.section.badges", group: "Docs", label: "Section: badges", defaultText: "Badges & Achievements" },
  { key: "docs.section.grill", group: "Docs", label: "Section: grill", defaultText: "The Grill (Chat)" },
  { key: "docs.section.creators", group: "Docs", label: "Section: creators", defaultText: "Launching Your Own Coin" },
  { key: "docs.section.faq", group: "Docs", label: "Section: faq", defaultText: "FAQ" },

  // ------------------------------------------------------------ site chrome
  { key: "nav.matches", group: "Navigation", label: "Nav: Cook Out", defaultText: "Cook Out" },
  { key: "nav.pit", group: "Navigation", label: "Nav: The Pit", defaultText: "The Pit" },
  { key: "nav.vote", group: "Navigation", label: "Nav: Vote", defaultText: "Vote" },
  { key: "nav.launch", group: "Navigation", label: "Nav: Launch a Coin", defaultText: "Launch a Coin" },
  { key: "nav.leaderboard", group: "Navigation", label: "Nav: Boards", defaultText: "Boards" },
  { key: "nav.jackpot", group: "Navigation", label: "Nav: Jackpot", defaultText: "Jackpot" },
  { key: "nav.docs", group: "Navigation", label: "Nav: Docs", defaultText: "Docs" },

  // ----------------------------------------------------------- cook out page
  { key: "cookout.title", group: "Cook Out page", label: "Page title", defaultText: "The Cook Out" },
  {
    key: "cookout.intro",
    group: "Cook Out page",
    label: "Page intro",
    multiline: true,
    defaultText:
      "Live now, up next, and every past result. Each match is a real token launched through a fair batch auction: one clearing price, pro-rata fills, auditable settlement.",
  },
  { key: "cookout.upNext", group: "Cook Out page", label: "Up Next heading", defaultText: "Up Next" },
  { key: "cookout.endurance.title", group: "Cook Out page", label: "Endurance rail heading", defaultText: "🕛 Endurance" },
  {
    key: "cookout.endurance.blurb",
    group: "Cook Out page",
    label: "Endurance rail blurb",
    multiline: true,
    defaultText:
      "No timer. These run until the coin completes its bonding curve — pure PvP, no bots, no modifiers.",
  },
  { key: "cookout.pastResults", group: "Cook Out page", label: "Past Results heading", defaultText: "Past Results" },
  {
    key: "cookout.empty.title",
    group: "Cook Out page",
    label: "Empty state title",
    defaultText: "The grill is empty. Someone needs to launch a coin.",
  },
  {
    key: "cookout.empty.body",
    group: "Cook Out page",
    label: "Empty state body",
    multiline: true,
    defaultText:
      "Every match starts with the community: launch a coin, the crowd votes it through, and it lands right here at the Cook Out at your chosen tier.",
  },

  // ------------------------------------------------------------- the pit page
  { key: "pit.title", group: "The Pit page", label: "Page title", defaultText: "The Pit" },
  {
    key: "pit.intro",
    group: "The Pit page",
    label: "Page intro",
    multiline: true,
    defaultText:
      "This is where you prove it. Step into the Prediction Market and call it — Graduate, Rug, or Timer — then stack the House Special and Double Down for the big score. Think you can out-trade the machine? Battle the Flame Goon Squad head to head and take the whole pool. Or go it alone in the Flame Trial: one player, one stake, one PnL target — clear the bar and walk away with your stake plus XP, titles, and badges. Read the market. Beat the Goons. Own The Pit.",
  },
  { key: "pit.live", group: "The Pit page", label: "Live shelf heading", defaultText: "Live Matches" },
  { key: "pit.queue", group: "The Pit page", label: "Queue shelf heading", defaultText: "Queue" },
  { key: "pit.results", group: "The Pit page", label: "Results shelf heading", defaultText: "Recent Results" },

  // ---------------------------------------------------------- launchpad page
  { key: "launch.eyebrow", group: "Launchpad", label: "Eyebrow", defaultText: "Launch a Coin" },
  { key: "launch.title", group: "Launchpad", label: "Heading", defaultText: "Put your coin on the grill." },
  {
    key: "launch.intro",
    group: "Launchpad",
    label: "Intro",
    multiline: true,
    defaultText:
      "Supply the name, art, and story. Your token deploys from the platform-audited template, so there are no mint, pause, or blacklist controls. Pick a game mode, rally the votes, and it heads straight to the Cook Out.",
  },
];

/**
 * Copy derived from structured content, so a mode's blurb or a quest's name is
 * editable in exactly the same place as page text — without duplicating the
 * definition that already exists in code.
 */
function derivedCopy(): CopyEntry[] {
  const out: CopyEntry[] = [];
  for (const m of GAME_MODES) {
    out.push(
      { key: `mode.${m.key}.name`, group: "Game modes", label: `${m.name} — name`, defaultText: m.name },
      { key: `mode.${m.key}.tagline`, group: "Game modes", label: `${m.name} — tagline`, defaultText: m.tagline },
      { key: `mode.${m.key}.blurb`, group: "Game modes", label: `${m.name} — blurb`, defaultText: m.blurb, multiline: true },
    );
  }
  for (const m of MISSIONS) {
    const g = m.period === "daily" ? "Quests · daily" : "Quests · weekly";
    out.push(
      { key: `mission.${m.id}.name`, group: g, label: `${m.name} — name`, defaultText: m.name },
      { key: `mission.${m.id}.description`, group: g, label: `${m.name} — description`, defaultText: m.description },
    );
  }
  for (const a of ACHIEVEMENTS) {
    out.push(
      { key: `achievement.${a.id}.name`, group: "Achievements", label: `${a.name} — name`, defaultText: a.name },
      { key: `achievement.${a.id}.description`, group: "Achievements", label: `${a.name} — description`, defaultText: a.description },
    );
  }
  for (const t of LEVEL_TITLES)
    out.push({
      key: `levelTitle.${t.minLevel}`,
      group: "Level titles",
      label: `Level ${t.minLevel}+`,
      defaultText: t.title,
    });
  for (const h of HOUSE_SPECIALS)
    out.push(
      { key: `houseSpecial.${h.kind}.name`, group: "Pit · House Specials", label: `${h.name} — name`, defaultText: h.name },
      { key: `houseSpecial.${h.kind}.blurb`, group: "Pit · House Specials", label: `${h.name} — blurb`, defaultText: h.blurb, multiline: true },
    );
  return out;
}

export const COPY_ENTRIES: CopyEntry[] = [...STATIC_COPY, ...derivedCopy()];

export const COPY_MAP: Record<string, CopyEntry> = Object.fromEntries(
  COPY_ENTRIES.map((e) => [e.key, e]),
);

/** Every key at its shipped default. */
export const COPY_DEFAULTS: Record<string, string> = Object.fromEntries(
  COPY_ENTRIES.map((e) => [e.key, e.defaultText]),
);

/** Defaults with the stored overrides applied. Unknown keys are ignored, so a
 *  stale override left behind by a removed string can't leak into the site. */
export function resolveCopy(overrides: Record<string, string> | undefined): Record<string, string> {
  const out = { ...COPY_DEFAULTS };
  for (const [key, value] of Object.entries(overrides ?? {}))
    if (key in COPY_DEFAULTS && typeof value === "string") out[key] = value;
  return out;
}

/** Look up one string. Falls back to the default, then to the key itself, so a
 *  missing entry is visible in development rather than rendering as blank. */
export function copyText(map: Record<string, string> | undefined, key: string): string {
  return map?.[key] ?? COPY_DEFAULTS[key] ?? key;
}

/** A multiline entry (like the ticker) as its individual lines. */
export function copyLines(map: Record<string, string> | undefined, key: string): string[] {
  return copyText(map, key)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Substitute {placeholders} in a string. */
export function copyFormat(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Groups in a sensible editing order. */
export function copyGroups(): string[] {
  return [...new Set(COPY_ENTRIES.map((e) => e.group))];
}
