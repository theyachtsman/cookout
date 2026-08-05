import express, { type Express, type Request, type Response } from "express";
import {
  COSMETICS,
  DEV_DUMP_FRACTION,
  GAME_MODE_MAP,
  MATCH_MINUTE_OPTIONS,
  MAX_TOKEN_SUPPLY,
  MIN_TOKEN_SUPPLY,
  NOTIFY_CATEGORIES,
  TIER_UNLOCK_LEVEL,
  resolveNotifyPrefs,
  isEnduranceMode,
  activeTheme,
  MEDIA_MAX_BYTES,
  unlockedCosmetics,
  dayKey,
  weekKey,
  marketCap,
  HOUSE_SPECIALS,
  PIT_DURATION_MAP,
  PIT_DURATIONS,
  type AccountTrade,
  type CoinModifiers,
  type CoinSocials,
  type CosmeticType,
  BATTLE_TIERS,
  type Address,
  type BattleTier,
  type GameMode,
  type HouseSpecialKind,
  type MyFill,
  type NotifyCategory,
  type PitCall,
  type PitDurationKey,
  type PitEntry,
  type RiskTier,
  type TokenConcept,
} from "@cookout/shared";
import { mountCommandCenter } from "./command-center.js";
import { ComplianceService, locationOf } from "./compliance.js";
import { CollectionError, CollectionService } from "./collection.js";
import { MediaService, readAsset } from "./media.js";
import { StaffService, requireStaff } from "./staff.js";
import { enterPit, pitEntryCost, withdrawPit } from "./pit-pools.js";
import { awardBurger, awardBurgerOneTime, purchaseBurgers, adminAdjustBurgers, burgerAnalytics } from "./burger.js";
import { linkDeepLink } from "./telegram/index.js";
import {
  createSessionForAddress,
  isDevWallet,
  issueNonce,
  requireAuth,
  optionalAuth,
  verifyAndCreateSession,
  type AuthedRequest,
} from "./auth.js";
import { resolvePrivyLogin, type PrivyResolver } from "./privy.js";
import { Err, type Broadcast, type RoundEngine } from "./engine.js";
import { jackpotStatus } from "./jackpot.js";
import { rateLimit } from "./ratelimit.js";
import { activeRugBan, type Store, type StoredUser } from "./store.js";
import { GLOBAL_ROOM, spotPrice } from "@cookout/shared";

const PAUSE_LIMIT = 3;
const PAUSE_WINDOW_MS = 60 * 60 * 1000;

/** Pit round states that still occupy the coin: it can't be relaunched yet.
 *  Deliberately an allow-list — "cancelled" and "results" are done, and a
 *  deny-list of just "results" is what used to strand timed-out matches. */
export const PIT_PENDING_STATES = new Set<import("@cookout/shared").RoundState>([
  "scheduled",
  "lobby",
  "queue_open",
  "settling",
  "live",
  "ended",
]);

export function createApp(
  store: Store,
  engine: RoundEngine,
  adminKey: string,
  broadcast: Broadcast = () => {},
  chain?: import("./chain.js").ChainService,
  /** Live social layer: who's online and what they're doing. */
  presence: () => import("@cookout/shared").PresenceUser[] = () => [],
  /** Verifies a Privy access token → account address. Injectable for tests. */
  resolvePrivy: PrivyResolver = resolvePrivyLogin,
  /** The Telegram companion, or null when TELEGRAM_BOT_TOKEN is unset. */
  pitBoss: import("./telegram/index.js").PitBoss | null = null,
): Express {
  const app = express();
  const compliance = new ComplianceService(store);
  // Body limit covers client-downscaled data-URL images (coin art, avatars).
  app.use(express.json({ limit: "2mb" }));
  // Media Library uploads are base64 data URLs and are deliberately allowed to
  // be much larger (audio, full-bleed theme art). Scoped to the upload routes
  // so the player-facing API keeps its tight 2mb ceiling.
  app.use(
    ["/api/cc/media", "/api/cc/media/:id/replace"],
    express.json({ limit: `${Math.ceil((MEDIA_MAX_BYTES * 4) / 3 / 1_048_576) + 2}mb` }),
  );

  // CORS_ORIGIN is a comma-separated allowlist of web origins (the API and the
  // web app are on different hosts in production: API behind a tunnel, web on
  // Vercel). An entry of "*" allows any origin; an entry may contain a single
  // "*" wildcard, e.g. "https://*.vercel.app" for preview deploys. The matching
  // request Origin is echoed back so multiple front-end hosts work.
  const corsAllow = (process.env.CORS_ORIGIN ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const originAllowed = (origin: string) =>
    corsAllow.some((a) => {
      if (a === origin) return true;
      const star = a.indexOf("*");
      if (star === -1) return false;
      const pre = a.slice(0, star);
      const post = a.slice(star + 1);
      return (
        origin.length >= pre.length + post.length &&
        origin.startsWith(pre) &&
        origin.endsWith(post)
      );
    });
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allow = corsAllow.includes("*")
      ? "*"
      : origin && originAllowed(origin)
        ? origin
        : (corsAllow[0] ?? "*");
    res.setHeader("Access-Control-Allow-Origin", allow);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const auth = requireAuth(store);
  const maybeAuth = optionalAuth(store);
  // The legacy admin surface now accepts EITHER a Command Center staff session
  // or the shared admin key, so an operator signed into the Command Center can
  // drive the existing ops routes without also holding the raw key. The key
  // itself keeps working as break-glass.
  const ccStaff = new StaffService(store);
  const admin = requireStaff(ccStaff, adminKey);

  // Baseline abuse protection (per IP; Cloudflare-aware). Reads are generous,
  // identity and writes are tight.
  app.use("/api/", rateLimit("global", 300, 10_000));
  app.use("/api/auth/", rateLimit("auth", 20, 60_000));
  app.use("/api/beta/signup", rateLimit("signup", 6, 3_600_000));
  app.use("/api/concepts", (req, res, next) =>
    req.method === "POST" ? rateLimit("submit", 6, 3_600_000)(req, res, next) : next(),
  );
  app.use(/^\/api\/rounds\/[^/]+\/trade$/, rateLimit("trade", 40, 10_000));
  app.use("/api/feedback", rateLimit("feedback", 4, 60_000));

  const wrap =
    (fn: (req: AuthedRequest, res: Response) => unknown | Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req as AuthedRequest, res);
      } catch (e) {
        const status = e instanceof Err ? e.status : ((e as { status?: number }).status ?? 500);
        res.status(status).json({ error: (e as Error).message });
      }
    };

  // ---- auth ----
  app.post(
    "/api/auth/nonce",
    wrap((req, res) => {
      const { address } = req.body as { address?: string };
      if (!address?.startsWith("0x")) throw new Err(400, "address required");
      const { nonce, message } = issueNonce(store, address);
      res.json({ nonce, message });
    }),
  );

  app.post(
    "/api/auth/verify",
    wrap(async (req, res) => {
      const { address, signature, referralCode } = req.body as {
        address?: string;
        signature?: `0x${string}`;
        referralCode?: string;
      };
      if (!address || !signature) throw new Err(400, "address and signature required");
      const { token } = await verifyAndCreateSession(store, address, signature, referralCode);
      res.json({ token, profile: publicProfile(store.getOrCreateUser(address), true) });
    }),
  );

  /** Privy login: the browser proves identity to Privy (email/social/wallet),
   *  we verify the returned access token server-side and issue our session,
   *  keyed to the account's embedded wallet. This is the primary auth path. */
  app.post(
    "/api/auth/privy",
    wrap(async (req, res) => {
      const { token, referralCode } = req.body as { token?: string; referralCode?: string };
      if (!token) throw new Err(400, "token required");
      const { address, displayName } = await resolvePrivy(token);

      // The compliance gate. Chain trades are non-custodial and permissionless,
      // so this is the only point the platform can actually refuse someone —
      // no session, no site. Terms are the one refusal a player can resolve
      // themselves, so it returns the prompt instead of a flat rejection.
      const decision = compliance.check(req, address);
      if (!decision.allowed) {
        if (decision.reason === "terms_not_accepted") {
          res.status(451).json({
            error: decision.message,
            needsTerms: true,
            termsVersion: compliance.settings().termsVersion,
            minimumAge: compliance.settings().minimumAge,
          });
          return;
        }
        store.logAdmin(
          "compliance",
          `session refused for ${address}: ${decision.reason}${
            locationOf(req).country ? ` (${locationOf(req).country})` : ""
          }`,
        );
        throw new Err(451, decision.message ?? "unavailable in your region");
      }

      const { token: sessionToken, isNew } = createSessionForAddress(store, address, referralCode);
      const u = store.getOrCreateUser(address);
      // Seed a friendly handle from their Privy login on first sign-in only.
      if (isNew && displayName && !u.displayName) u.displayName = displayName;
      res.json({ token: sessionToken, profile: publicProfile(u, true) });
    }),
  );

  app.get(
    "/api/me",
    auth,
    wrap((req, res) =>
      res.json({
        ...publicProfile(store.getOrCreateUser(req.userAddress!), true),
        // Dev-wallet flag: the client uses it to gate the admin page UI.
        // Real authorization stays on ADMIN_KEY for every admin API call.
        isDev: isDevWallet(req.userAddress!),
        // Whether this environment lets players clear their own rug ban.
        selfServeUnban: store.settings.selfServeUnban,
      }),
    ),
  );

  app.patch(
    "/api/me",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      const { displayName, avatarUrl, bannerUrl } = req.body as {
        displayName?: string;
        avatarUrl?: string;
        bannerUrl?: string;
      };
      if (displayName !== undefined) u.displayName = String(displayName).slice(0, 24);
      if (avatarUrl !== undefined) u.avatarUrl = sanitizeImageUrl(avatarUrl);
      // Empty string clears the banner (revert to the default wash).
      if (bannerUrl !== undefined) u.bannerUrl = bannerUrl === "" ? undefined : sanitizeImageUrl(bannerUrl);
      res.json(publicProfile(u, true));
    }),
  );

  // ---- Telegram companion (The Pit Boss) ----------------------------------

  const tgStatus = (u: import("./store.js").StoredUser) => ({
    configured: !!pitBoss,
    linked: !!u.telegram,
    username: u.telegram?.username ?? null,
    linkedAt: u.telegram?.linkedAt ?? null,
    prefs: resolveNotifyPrefs(u.notifyPrefs),
    founderNumber: u.founderNumber ?? null,
    groupInvite: pitBoss?.config.groupInvite ?? null,
  });

  app.get(
    "/api/me/telegram",
    auth,
    wrap((req, res) => res.json(tgStatus(store.getOrCreateUser(req.userAddress!)))),
  );

  // Start linking: mint a one-time token and hand back the bot deep link.
  app.post(
    "/api/me/telegram/link",
    auth,
    wrap((req, res) => {
      if (!pitBoss) throw new Err(503, "Telegram isn't configured on this server yet");
      const token = store.createTelegramLinkToken(req.userAddress!);
      res.json({ url: linkDeepLink(pitBoss.config.botUsername, token), token });
    }),
  );

  app.delete(
    "/api/me/telegram",
    auth,
    wrap((req, res) => {
      store.unlinkTelegram(req.userAddress!);
      res.json(tgStatus(store.getOrCreateUser(req.userAddress!)));
    }),
  );

  // Update notification switches (partial; unknown keys ignored).
  app.patch(
    "/api/me/telegram/prefs",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      const body = (req.body?.prefs ?? {}) as Record<string, unknown>;
      const valid = new Set(NOTIFY_CATEGORIES.map((c) => c.key));
      const next = { ...(u.notifyPrefs ?? {}) };
      for (const [k, v] of Object.entries(body))
        if (valid.has(k as NotifyCategory)) next[k as NotifyCategory] = !!v;
      u.notifyPrefs = next;
      res.json(tgStatus(u));
    }),
  );

  // Claim a permanent Founding Member number.
  app.post(
    "/api/me/founder",
    auth,
    wrap((req, res) => {
      const n = store.claimFounder(req.userAddress!);
      if (n === undefined) throw new Err(409, "all Founding Member seats are claimed");
      res.json({ founderNumber: n });
    }),
  );

  // Public founders roll — for a founders page and the Telegram /founders card.
  app.get(
    "/api/founders",
    wrap((_req, res) =>
      res.json({
        founders: store.founders().map((u) => ({
          founderNumber: u.founderNumber,
          address: u.address,
          displayName: u.displayName,
          avatarUrl: u.avatarUrl,
          founderSince: u.founderSince,
        })),
      }),
    ),
  );

  // Admin: Pit Boss status + broadcasts to the community feed.
  app.get(
    "/api/admin/telegram/status",
    admin,
    wrap((_req, res) =>
      res.json({
        configured: !!pitBoss,
        botUsername: pitBoss?.config.botUsername ?? null,
        group: !!pitBoss?.config.groupChatId,
        channel: !!pitBoss?.config.announcementChatId,
        linkedUsers: store.linkedTelegramUsers().length,
        founders: store.founders().length,
      }),
    ),
  );

  app.post(
    "/api/admin/telegram/broadcast",
    admin,
    wrap((req, res) => {
      const { text, kind } = req.body as { text?: string; kind?: "announce" | "patch" };
      const body = String(text ?? "").trim();
      if (!body) throw new Err(400, "text required");
      if (!pitBoss) throw new Err(503, "Telegram isn't configured");
      if (kind === "patch") pitBoss.notifier.patchNotes(body);
      else pitBoss.notifier.announce(body);
      res.json({ ok: true });
    }),
  );

  // Admin: post + pin the Welcome / Useful Links / Founding Members messages.
  app.post(
    "/api/admin/telegram/setup",
    admin,
    wrap(async (req, res) => {
      if (!pitBoss) throw new Err(503, "Telegram isn't configured");
      const force = !!(req.body as { force?: boolean }).force;
      res.json(await pitBoss.setupPins(force));
    }),
  );

  /** Paper-beta self-service: clear your own rug ban. The record stays on the
   *  profile — lifting a ban never erases the history. Wait-out environments
   *  (selfServeUnban off) refuse: time or an admin lifts those. */
  app.post(
    "/api/me/reputation/unban",
    auth,
    wrap((req, res) => {
      if (!store.settings.selfServeUnban)
        throw new Err(403, "bans here lift on a schedule: wait it out or appeal to a moderator");
      const u = store.getOrCreateUser(req.userAddress!);
      const ban = activeRugBan(u);
      if (!ban) throw new Err(400, "no active ban on this wallet");
      ban.liftedAt = Date.now();
      ban.liftedBy = "self";
      store.logAdmin("self_unban", `${u.address} cleared their own rug ban (offense #${ban.offense})`);
      res.json(publicProfile(u, true));
    }),
  );

  /** Link the caller's arena (burner session) wallet. Chain events from that
   *  address then credit this profile's XP/positions/quests. */
  app.post(
    "/api/me/arena",
    auth,
    wrap((req, res) => {
      const { address } = req.body as { address?: string };
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Err(400, "bad address");
      store.setArenaAddress(req.userAddress!, address);
      res.json(publicProfile(store.getOrCreateUser(req.userAddress!), true));
    }),
  );

  /** Move pETH between the bank and the arena balance matches spend. */
  app.post(
    "/api/me/arena/transfer",
    auth,
    wrap((req, res) => {
      const { amount, direction } = req.body as {
        amount?: number;
        direction?: "deposit" | "withdraw";
      };
      const amt = Number(amount);
      if (!(amt > 0)) throw new Err(400, "amount must be positive");
      const u =
        direction === "withdraw"
          ? store.arenaWithdraw(req.userAddress!, amt)
          : store.arenaDeposit(req.userAddress!, amt);
      res.json(publicProfile(u, true));
    }),
  );

  /** The caller's Cook Out balance history (newest first): stakes, unstakes,
   *  redemptions from ended rounds, and creator fees. */
  app.get(
    "/api/me/ledger",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      res.json({ ledger: [...(u.ledger ?? [])].reverse() });
    }),
  );

  // ---- Compliance: the two things a player can do themselves ----

  /** What the gate currently requires, for the acceptance screen. */
  app.get(
    "/api/compliance",
    wrap((req, res) => {
      const s = compliance.settings();
      res.json({
        enabled: s.enabled,
        termsVersion: s.termsVersion,
        minimumAge: s.minimumAge,
        selfExclusionDays: s.selfExclusionDays,
        country: locationOf(req).country ?? null,
      });
    }),
  );

  /**
   * Accept the terms. Unauthenticated on purpose: the session is refused until
   * the terms are accepted, so requiring a session to accept them is a deadlock.
   * The Privy token proves who is accepting.
   */
  app.post(
    "/api/compliance/accept",
    wrap(async (req, res) => {
      const { token, age } = req.body as { token?: string; age?: number };
      if (!token) throw new Err(400, "token required");
      const attested = Number(age);
      const minimum = compliance.settings().minimumAge;
      if (!Number.isFinite(attested) || attested < minimum)
        throw new Err(403, `you must be ${minimum} or older to use this site`);
      const { address } = await resolvePrivy(token);
      // Region and sanctions still apply — accepting terms is not a way past them.
      const gate = compliance.check(req, address);
      if (!gate.allowed && gate.reason !== "terms_not_accepted")
        throw new Err(451, gate.message ?? "unavailable in your region");
      res.json(compliance.acceptTerms(address, req, attested));
    }),
  );

  /**
   * Self-exclude. One-way: it can be extended, never shortened, and there is no
   * staff route to lift it. That is the entire point of the control.
   */
  app.post(
    "/api/me/self-exclude",
    auth,
    wrap((req, res) => {
      const days = Number((req.body as { days?: number }).days);
      try {
        const until = compliance.selfExclude(req.userAddress!, days);
        store.revokeSessionsFor(req.userAddress!);
        res.json({ until });
      } catch (e) {
        throw new Err(400, (e as Error).message);
      }
    }),
  );

  /** The caller's Cookout Wallet history (newest first), recorded from mirrored
   *  chain events: pull-ups, cancels, buys and sells, with the coin and token
   *  amounts a raw transaction hash can't tell you. The client merges its own
   *  local log on top for sends and outside deposits. */
  app.get(
    "/api/me/chain-ledger",
    auth,
    wrap((req, res) => {
      res.json({ ledger: store.chainLedgerOf(req.userAddress!) });
    }),
  );

  // ---- Burger economy ($BURG) ----
  /** The caller's Burger balance, lifetime stats, purchase rate, and recent
   *  transactions (newest first). Drives the Burger balance UI + shop. */
  app.get(
    "/api/me/burger",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      const cfg = store.settings.burger;
      res.json({
        enabled: cfg.enabled,
        balance: u.burgerBalance ?? 0,
        earned: u.burgerEarned ?? 0,
        purchased: u.burgerPurchased ?? 0,
        spent: u.burgerSpent ?? 0,
        burgersPerEth: cfg.burgersPerEth,
        arenaBalance: u.arenaBalance ?? 0,
        ledger: [...(u.burgerLedger ?? [])].reverse().slice(0, 100),
      });
    }),
  );

  /** The caller's full Burger transaction history, newest first. */
  app.get(
    "/api/me/burger/ledger",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      res.json({ ledger: [...(u.burgerLedger ?? [])].reverse() });
    }),
  );

  /** Buy $BURG with Cook Out balance. Body: { eth }. Routes revenue by the
   *  configured allocation. Returns the new balances. */
  app.post(
    "/api/me/burger/purchase",
    auth,
    wrap((req, res) => {
      const { eth } = req.body as { eth?: number };
      try {
        const out = purchaseBurgers(store, req.userAddress!, Number(eth));
        res.json({ ok: true, ...out });
      } catch (e) {
        throw new Err(400, (e as Error).message);
      }
    }),
  );

  /** The caller's full trade log across every round (newest first): each buy
   *  and sell joined to its coin, for the wallet's trade-history table. */
  app.get(
    "/api/me/trades",
    auth,
    wrap((req, res) => {
      const me = req.userAddress!;
      const out: AccountTrade[] = [];
      for (const [roundId, list] of store.trades) {
        const round = store.rounds.get(roundId);
        for (const t of list) {
          if (t.userAddress !== me) continue;
          out.push({
            id: t.id,
            roundId,
            symbol: round?.token.symbol ?? "?",
            name: round?.token.name ?? "",
            side: t.side,
            ethAmount: t.ethAmount,
            tokenAmount: t.tokenAmount,
            price: t.price,
            fee: t.fee,
            at: t.at,
          });
        }
      }
      out.sort((a, b) => b.at - a.at);
      res.json({ trades: out });
    }),
  );

  app.get(
    "/api/missions",
    auth,
    wrap((req, res) => res.json(store.missionStatus(req.userAddress!))),
  );

  app.get(
    "/api/progress",
    auth,
    wrap((req, res) => res.json(store.progressStatus(req.userAddress!))),
  );

  // Cosmetics unlock also considers this month's season XP (season-pass tiers).
  const cosmeticsUser = (u: StoredUser) => ({
    level: u.level,
    achievements: u.achievements,
    bestSeasonRank: u.bestSeasonRank,
    monthlyXp: u.seasons[store.seasonKey()]?.xp ?? 0,
    founder: !!u.founderNumber,
  });

  app.get(
    "/api/me/cosmetics",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      res.json({ unlocked: unlockedCosmetics(cosmeticsUser(u)), equipped: u.equipped, all: COSMETICS });
    }),
  );

  app.patch(
    "/api/me/cosmetics",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      const unlockedIds = new Set(unlockedCosmetics(cosmeticsUser(u)).map((c) => c.id));
      const body = req.body as Partial<Record<"title" | "badge" | "chatColor" | "frame", string | null>>;
      const slots: Array<["title" | "badge" | "chatColor" | "frame", CosmeticType]> = [
        ["title", "title"],
        ["badge", "badge"],
        ["chatColor", "chat_color"],
        ["frame", "frame"],
      ];
      for (const [slot, type] of slots) {
        if (!(slot in body)) continue;
        const id = body[slot];
        if (id === null) {
          delete u.equipped[slot];
          continue;
        }
        const def = COSMETICS.find((c) => c.id === id);
        if (!def || def.type !== type) throw new Err(400, `invalid ${slot} cosmetic`);
        if (!unlockedIds.has(def.id)) throw new Err(403, `${def.name} is not unlocked`);
        u.equipped[slot] = def.id;
      }
      res.json({ equipped: u.equipped });
    }),
  );

  app.get(
    "/api/profile/:address",
    wrap((req, res) => {
      const key = req.params.address!.toLowerCase();
      // Accept a wallet address OR a Flame Goon Squad handle (/profile/ghost).
      const u = key.startsWith("0x") ? store.users.get(key) : store.goonByHandle(key);
      if (!u) throw new Err(404, "profile not found");
      const base = publicProfile(u) as Record<string, unknown>;
      // Attach the live persona (bio, rarity, catchphrase, speech style) so a
      // Goon profile reads as a real resident, not an empty account.
      if (u.isAI) {
        const persona = store.settings.goons.personas.find((p) => p.address === u.address);
        if (persona) {
          base.goon = {
            handle: persona.handle,
            rarity: persona.rarity,
            bio: persona.bio,
            speechStyle: persona.speechStyle,
            catchphrase: persona.catchphrase,
            favoriteTopics: persona.favoriteTopics,
            rivals: persona.rivals,
          };
        }
      }
      res.json(base);
    }),
  );

  app.get(
    "/api/profile/:address/history",
    wrap((req, res) => {
      const u = store.users.get(req.params.address!.toLowerCase());
      if (!u) throw new Err(404, "profile not found");
      res.json([...u.history].reverse());
    }),
  );

  /** Creator profile view (spec §5.4): submissions, rounds, aggregates. */
  app.get(
    "/api/creator/:address",
    wrap((req, res) => {
      const address = req.params.address!.toLowerCase();
      const u = store.users.get(address);
      if (!u) throw new Err(404, "creator not found");
      const concepts = [...store.concepts.values()]
        .filter((c) => c.creatorAddress === address)
        .sort((a, b) => b.createdAt - a.createdAt);
      const mine = [...store.rounds.values()]
        .filter((r) => r.creatorAddress === address)
        .sort((a, b) => b.scheduledAt - a.scheduledAt);
      const rounds = mine
        .filter((r) => r.state === "results" || r.state === "live")
        .map((r) => ({
          round: r,
          summary: store.summaries.get(r.id) ?? null,
        }));
      // Pit matches whose queue timed out. They never traded, so they aren't
      // part of the public launch record — but the creator can run them back,
      // so they're surfaced separately rather than dropped.
      const cancelled = mine
        .filter((r) => r.state === "cancelled")
        .map((r) => ({ round: r, summary: null }));
      const launched = rounds.filter((r) => r.round.state === "results");
      const totalVotes = concepts.reduce((s, c) => s + c.votes, 0);
      res.json({
        address,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        bannerUrl: u.bannerUrl,
        level: u.level,
        title: u.title,
        creatorReputation: u.creatorReputation,
        banned: !!activeRugBan(u),
        rugBans: u.rugBans ?? [],
        feesEarned: u.feesEarned,
        concepts,
        rounds,
        cancelled,
        aggregates: {
          submissions: concepts.length,
          roundsLaunched: launched.length,
          graduations: launched.filter((r) => r.round.graduated).length,
          rugs: launched.filter(
            (r) =>
              r.round.endReason === "rug_detected" || r.round.endReason === "liquidity_removed",
          ).length,
          totalVotes,
          totalVolume: launched.reduce((s, r) => s + (r.summary?.totalVolume ?? 0), 0),
        },
      });
    }),
  );

  // ---- The Pit (PvE vs Swarm AI) ----
  /** Public queue view: live / lobby / queued / recent results + carryover. */
  const pitPools = (r: import("@cookout/shared").Round) => ({
    prediction: {
      pot: r.pit!.prediction.pot + r.pit!.prediction.carryIn,
      participants: r.pit!.prediction.participants,
      carryIn: r.pit!.prediction.carryIn,
    },
    trading: {
      pot: r.pit!.trading.pot + r.pit!.trading.carryIn,
      participants: r.pit!.trading.participants,
      carryIn: r.pit!.trading.carryIn,
    },
  });
  const pitView = (r: import("@cookout/shared").Round) => ({
    round: r,
    ...pitPools(r),
    summary: store.summaries.get(r.id) ?? null,
    mcap: r.pool ? marketCap(r.pool) : 0,
  });

  app.get(
    "/api/pit",
    wrap((_req, res) => {
      const now = Date.now();
      const all = [...store.rounds.values()].filter((r) => r.matchType === "pit");
      const live = all
        .filter((r) => r.state === "live")
        .sort((a, b) => (a.liveAt ?? 0) - (b.liveAt ?? 0))
        .map(pitView);
      const lobby = all
        .filter((r) => r.state === "lobby" && now < (r.queueOpensAt ?? 0))
        .sort((a, b) => (a.queueOpensAt ?? 0) - (b.queueOpensAt ?? 0))
        .map(pitView);
      const queue = all
        .filter((r) => r.state === "lobby" && now >= (r.queueOpensAt ?? 0))
        .sort((a, b) => (a.queueOpensAt ?? 0) - (b.queueOpensAt ?? 0))
        .map(pitView);
      // Finished matches, including the ones cancelled by a queue timeout — a
      // cancelled match still belongs on the board so its creator can see what
      // happened and run it back, instead of it vanishing while still blocking
      // the coin.
      const results = all
        .filter((r) => r.state === "results" || r.state === "cancelled")
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
        .slice(0, 12)
        .map(pitView);
      const s = store.settings.pit;
      res.json({
        live,
        lobby,
        queue,
        results,
        carry: store.pitCarry,
        config: {
          tradingFee: s.tradingFee,
          startingStack: s.startingStack,
          maxConcurrent: s.maxConcurrent,
          minBet: s.minBet,
          maxBet: s.maxBet,
          quickChips: s.quickChips,
          durations: PIT_DURATIONS.filter((d) => s.durations.includes(d.key)),
          // Battle the Goon Squad is a fixed price per difficulty. Both the USD
          // figure and its current pETH/ETH equivalent go out, so the lobby can
          // show what it costs without re-deriving the conversion itself.
          battleTiers: BATTLE_TIERS.filter((k) => store.settings.game.battleTiers[k]?.enabled).map(
            (key) => {
              const t = store.settings.game.battleTiers[key];
              return {
                key,
                label: t.label,
                entryUsd: t.entryUsd,
                entryEth: t.entryUsd / (store.ethUsd || 1),
                feeBps: t.feeBps,
              };
            },
          ),
        },
      });
    }),
  );

  /** The caller's own state in a Pit match: their entry + remaining stack. */
  app.get(
    "/api/pit/:id/me",
    auth,
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round || round.matchType !== "pit") throw new Err(404, "pit match not found");
      const addr = req.userAddress!;
      res.json({
        entry: store.pitEntryOf(round.id, addr) ?? null,
        stack: store.pitStackOf(round.id, addr),
      });
    }),
  );

  /** Launch a Pit match directly (no vote). Creator picks the coin + duration. */
  app.post(
    "/api/pit/launch",
    auth,
    wrap((req, res) => {
      if (!store.flag("pit")) throw new Err(503, "The Pit is closed right now");
      const body = req.body as {
        name?: string;
        symbol?: string;
        theme?: string;
        pitch?: string;
        artworkUrl?: string;
        bannerUrl?: string;
        duration?: string;
        modes?: { prediction?: boolean; trading?: boolean; trial?: boolean };
      };
      const { name, symbol, theme } = body;
      if (!name || !symbol || !theme) throw new Err(400, "name, symbol, theme required");
      const duration = (body.duration ?? "standard") as PitDurationKey;
      if (!PIT_DURATION_MAP[duration] || !store.settings.pit.durations.includes(duration))
        throw new Err(400, "unknown or disabled Pit duration");
      // Which game modes this match runs. Default to both when unspecified (legacy).
      const modes = {
        prediction: body.modes ? !!body.modes.prediction : true,
        trading: body.modes ? !!body.modes.trading : true,
        trial: body.modes ? !!body.modes.trial : false,
      };
      if (!modes.prediction && !modes.trading && !modes.trial)
        throw new Err(400, "pick at least one game mode");
      if (modes.trial && modes.trading)
        throw new Err(400, "Flame Trial is single-player and can't run with Battle the Goon Squad");
      const creator = store.getOrCreateUser(req.userAddress!);
      const ban = activeRugBan(creator);
      if (ban)
        throw new Err(
          403,
          "this wallet is banned from launching coins after a rug. Check the Reputation section on your Profile page",
        );
      const recent = [...store.concepts.values()].filter(
        (c) => c.creatorAddress === creator.address && Date.now() - c.createdAt < 60 * 60 * 1000,
      );
      if (recent.length >= 3) throw new Err(429, "creator cooldown: max 3 launches per hour");
      const concept: TokenConcept = {
        id: store.id(),
        creatorAddress: creator.address,
        name: String(name).slice(0, 48),
        symbol: String(symbol).toUpperCase().slice(0, 8),
        theme: String(theme).slice(0, 140),
        pitch: body.pitch ? String(body.pitch).slice(0, 1000) : undefined,
        socials: sanitizeSocials((req.body as { socials?: unknown }).socials),
        artworkUrl: body.artworkUrl ? sanitizeImageUrl(body.artworkUrl) : undefined,
        bannerUrl: body.bannerUrl ? sanitizeImageUrl(body.bannerUrl) : undefined,
        tier: "degen",
        matchType: "pit",
        pitDuration: duration,
        pitModes: modes,
        status: "submitted",
        votes: 0,
        createdAt: Date.now(),
      };
      store.concepts.set(concept.id, concept);
      const round = engine.schedulePitRound(concept, Date.now());
      store.logAdmin("pit", `pit match ${round.id} (${concept.symbol}, ${duration}) launched by ${creator.address}`);
      res.json({ round });
    }),
  );

  /** Run a finished Pit match back: the creator relaunches the same coin, with
   *  an optional new duration, into a fresh Pit lobby. No new vote. */
  app.post(
    "/api/pit/:id/runback",
    auth,
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round || round.matchType !== "pit") throw new Err(404, "pit match not found");
      // A match that timed out in the queue is finished too — it's cancelled and
      // every deposit was refunded. Not letting the creator run that one back was
      // the whole reason a timed-out coin felt permanently stuck.
      if (round.state !== "results" && round.state !== "cancelled")
        throw new Err(400, "this match hasn't finished yet");
      if (round.creatorAddress.toLowerCase() !== req.userAddress!.toLowerCase())
        throw new Err(403, "only this match's creator can run it back");
      const creator = store.getOrCreateUser(req.userAddress!);
      if (activeRugBan(creator))
        throw new Err(403, "this wallet is banned from launching coins after a rug");
      const body = req.body as {
        duration?: string;
        modes?: { prediction?: boolean; trading?: boolean; trial?: boolean };
      };
      const duration = (body.duration ?? round.pit!.duration) as PitDurationKey;
      if (!PIT_DURATION_MAP[duration] || !store.settings.pit.durations.includes(duration))
        throw new Err(400, "unknown or disabled Pit duration");
      const modes = body.modes
        ? { prediction: !!body.modes.prediction, trading: !!body.modes.trading, trial: !!body.modes.trial }
        : { prediction: round.pit!.predictionMode, trading: round.pit!.tradingMode, trial: round.pit!.trialMode };
      if (!modes.prediction && !modes.trading && !modes.trial)
        throw new Err(400, "pick at least one game mode");
      if (modes.trial && modes.trading)
        throw new Err(400, "Flame Trial is single-player and can't run with Battle the Goon Squad");
      const concept = store.concepts.get(round.conceptId);
      if (!concept) throw new Err(404, "the original concept is gone");
      // "Pending" means genuinely still in play. Cancelled and finished matches
      // stay in the store forever, so testing `state !== "results"` counted every
      // queue-timeout as a live match and blocked the coin from ever running
      // again ("this coin already has a pending Pit match").
      const pending = [...store.rounds.values()].some(
        (r) =>
          r.conceptId === round.conceptId &&
          r.matchType === "pit" &&
          PIT_PENDING_STATES.has(r.state),
      );
      if (pending) throw new Err(409, "this coin already has a pending Pit match");
      concept.pitDuration = duration;
      concept.pitModes = modes;
      const fresh = engine.schedulePitRound(concept, Date.now());
      store.logAdmin("pit", `pit run-it-back ${fresh.id} (${concept.symbol}, ${duration}) by ${creator.address}`);
      res.json({ round: fresh });
    }),
  );

  /** Place or edit a Pit entry: Main prediction, House Special, and/or trading,
   *  each with a player-chosen wager. Re-posting replaces the current entry. */
  app.post(
    "/api/pit/:id/enter",
    auth,
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round || round.matchType !== "pit") throw new Err(404, "pit match not found");
      if (!store.flag("pit")) throw new Err(503, "The Pit is closed right now");
      if (round.state !== "lobby") throw new Err(409, "the lobby for this match is closed");
      const addr = req.userAddress!;
      const pit = round.pit!;
      // Each pool switches independently: a prediction pool can be closed —
      // it is the piece with the most classification risk — without taking
      // the trading pool or the Trial down with it.
      const closed = (what: string) => new Err(503, `${what} is closed right now`);
      const body = req.body as {
        prediction?: string;
        predictionStake?: number;
        houseSpecial?: boolean;
        houseSpecialStake?: number;
        trading?: boolean;
        tradingStake?: number;
        trial?: boolean;
        trialStake?: number;
      };
      const entry: PitEntry = {};
      const user = store.getOrCreateUser(addr);
      // Wagers are bounded by the match's configured min/max (pETH).
      const resolveStake = (raw: unknown, label: string): number => {
        const v = Number(raw);
        if (!Number.isFinite(v)) throw new Err(400, `${label} is required`);
        if (v < pit.minBet - 1e-12) throw new Err(400, `${label} is below the ${pit.minBet} pETH minimum`);
        if (v > pit.maxBet + 1e-12) throw new Err(400, `${label} is above the ${pit.maxBet} pETH maximum`);
        return v;
      };
      if (body.prediction !== undefined && body.prediction !== null) {
        if (!store.flag("pit_prediction")) throw closed("The prediction market");
        if (!pit.predictionMode) throw new Err(400, "this match has no prediction market");
        if (!["graduate", "rug", "timer"].includes(String(body.prediction)))
          throw new Err(400, "prediction must be graduate, rug, or timer");
        entry.prediction = body.prediction as PitCall;
        entry.predictionStake = resolveStake(body.predictionStake, "prediction bet");
      }
      if (body.houseSpecial) {
        if (!store.flag("pit_prediction")) throw closed("The prediction market");
        if (!pit.predictionMode || !pit.houseSpecial) throw new Err(400, "this match has no House Special");
        entry.houseSpecial = true;
        entry.houseSpecialStake = resolveStake(body.houseSpecialStake, "house special bet");
      }
      if (body.trading) {
        if (!store.flag("pit_trading")) throw closed("Battle the Goon Squad");
        if (!pit.tradingMode) throw new Err(400, "this match has no trading pool");
        // The entry is the tier's price, not a number the player sends. Taking
        // an amount from the request would reintroduce exactly what the fixed
        // ladder exists to prevent: entering for less than everyone else and
        // still winning the whole pot.
        const tierKey = String((req.body as { battleTier?: string }).battleTier ?? "easy");
        if (!BATTLE_TIERS.includes(tierKey as BattleTier))
          throw new Err(400, `battleTier must be one of: ${BATTLE_TIERS.join(", ")}`);
        const tier = store.settings.game.battleTiers[tierKey as BattleTier];
        if (!tier?.enabled) throw closed(`The ${tierKey} tier`);
        entry.trading = true;
        entry.battleTier = tierKey as BattleTier;
        entry.tradingStake = tier.entryUsd / (store.ethUsd || 1);
      }
      if (body.trial) {
        if (!store.flag("flame_trial")) throw closed("The Flame Trial");
        if (!pit.trialMode) throw new Err(400, "this match has no Flame Trial");
        if (round.creatorAddress.toLowerCase() !== addr.toLowerCase())
          throw new Err(403, "Flame Trial is single-player: only the match creator can play it");
        const raw = Number(body.trialStake);
        if (!Number.isFinite(raw) || raw <= 0) throw new Err(400, "Flame Trial stake is required");
        const usd = raw * (store.ethUsd || 0);
        if (usd < pit.trialMinUsd - 1e-9)
          throw new Err(400, `Flame Trial stake is below the $${pit.trialMinUsd} minimum`);
        if (usd > pit.trialMaxUsd + 1e-9)
          throw new Err(400, `Flame Trial stake is above the $${pit.trialMaxUsd} maximum`);
        entry.trial = true;
        entry.trialStake = raw;
      }
      if (!entry.prediction && !entry.houseSpecial && !entry.trading && !entry.trial)
        throw new Err(400, "place at least one bet");
      // Editing refunds the current entry first, so account for that headroom.
      const existing = store.pitEntryOf(round.id, addr);
      const refundable = existing ? pitEntryCost(round, existing) : 0;
      const cost = pitEntryCost(round, entry);
      if ((user.arenaBalance ?? 0) + refundable < cost - 1e-9)
        throw new Err(400, "not enough in your Cook Out balance for those bets");
      enterPit(store, round, addr, entry);
      engine.armPitLobby(round, Date.now());
      engine.emitLobbyPublic(round);
      res.json({ ok: true, entry, stack: store.pitStackOf(round.id, addr), ...pitPools(round) });
    }),
  );

  /** Withdraw a Pit entry (full refund) during the lobby, before it goes live. */
  app.post(
    "/api/pit/:id/withdraw",
    auth,
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round || round.matchType !== "pit") throw new Err(404, "pit match not found");
      if (round.state !== "lobby") throw new Err(409, "the round has started — nothing to withdraw");
      const addr = req.userAddress!;
      if (!store.pitEntryOf(round.id, addr)) throw new Err(404, "you have no entry to withdraw");
      withdrawPit(store, round, addr);
      engine.emitLobbyPublic(round);
      res.json({ ok: true, ...pitPools(round) });
    }),
  );

  /** A player's recent Pit matches (for the profile's The Pit tab). */
  app.get(
    "/api/pit/history/:address",
    wrap((req, res) => {
      const addr = req.params.address!.toLowerCase();
      const rows = [...store.summaries.values()]
        .filter((s) => s.pit && s.pit.players.some((p) => p.address === addr))
        .map((s) => ({
          round: store.rounds.get(s.roundId) ?? null,
          summary: s,
          me: s.pit!.players.find((p) => p.address === addr) ?? null,
        }))
        .filter((r) => r.round)
        .sort((a, b) => (b.round!.endedAt ?? 0) - (a.round!.endedAt ?? 0))
        .slice(0, 20);
      res.json(rows);
    }),
  );

  // ---- tester feedback (beta instrumentation) ----
  app.post(
    "/api/feedback",
    auth,
    wrap((req, res) => {
      const { text, page } = req.body as { text?: string; page?: string };
      const trimmed = String(text ?? "").trim();
      if (!trimmed) throw new Err(400, "feedback text required");
      const u = store.getOrCreateUser(req.userAddress!);
      store.feedback.push({
        id: store.id(),
        address: u.address,
        displayName: u.displayName,
        text: trimmed.slice(0, 1000),
        page: page ? String(page).slice(0, 120) : undefined,
        at: Date.now(),
      });
      if (store.feedback.length > 2000) store.feedback.splice(0, store.feedback.length - 2000);
      res.json({ ok: true });
    }),
  );

  app.get(
    "/api/admin/feedback",
    admin,
    wrap((_req, res) => res.json([...store.feedback].reverse().slice(0, 500))),
  );

  // ---- live-ops settings (round cadence etc.) ----
  app.post(
    "/api/admin/settings",
    admin,
    wrap((req, res) => {
      const {
        autoSchedule,
        tier,
        leadSeconds,
        bots,
        announceTips,
        announceEveryMin,
        pinnedAnnouncement,
        selfServeUnban,
        rugBanHours,
        pit,
        burger,
        goons,
      } = req.body as {
        autoSchedule?: boolean;
        tier?: RiskTier;
        leadSeconds?: number;
        bots?: boolean;
        announceTips?: string[];
        announceEveryMin?: number;
        pinnedAnnouncement?: string;
        selfServeUnban?: boolean;
        rugBanHours?: number[];
        pit?: Partial<import("./store.js").PitSettings>;
        burger?: Partial<import("@cookout/shared").BurgerSettings>;
        goons?: Partial<import("@cookout/shared").GoonSettings>;
      };
      if (autoSchedule !== undefined) store.settings.autoSchedule = !!autoSchedule;
      if (bots !== undefined) store.settings.bots = !!bots;
      if (tier && ["rookie", "standard", "degen"].includes(tier)) store.settings.tier = tier;
      if (leadSeconds !== undefined)
        store.settings.leadSeconds = Math.max(5, Math.min(3600, Number(leadSeconds) || 15));
      if (Array.isArray(announceTips))
        store.settings.announceTips = announceTips
          .map((t) => String(t).trim().slice(0, 280))
          .filter(Boolean)
          .slice(0, 12);
      if (announceEveryMin !== undefined)
        store.settings.announceEveryMin = Math.max(0, Math.min(1440, Number(announceEveryMin) || 0));
      if (selfServeUnban !== undefined) store.settings.selfServeUnban = !!selfServeUnban;
      if (Array.isArray(rugBanHours) && rugBanHours.length > 0)
        store.settings.rugBanHours = rugBanHours
          .map((h) => Math.max(1, Math.min(24 * 365, Math.round(Number(h) || 0))))
          .slice(0, 10);
      if (pinnedAnnouncement !== undefined) {
        store.settings.pinnedAnnouncement = String(pinnedAnnouncement).trim().slice(0, 280);
        // Connected clients swap the pin live; "" clears it everywhere.
        broadcast(GLOBAL_ROOM, { type: "pinned", text: store.settings.pinnedAnnouncement });
      }
      if (pit && typeof pit === "object") {
        const p = store.settings.pit;
        const num = (v: unknown, lo: number, hi: number, dflt: number) =>
          Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : dflt));
        if (pit.tradingFee !== undefined) p.tradingFee = num(pit.tradingFee, 0, 100, p.tradingFee);
        if (pit.pitFeeBps !== undefined) p.pitFeeBps = Math.round(num(pit.pitFeeBps, 0, 5000, p.pitFeeBps));
        if (pit.startingStack !== undefined) p.startingStack = num(pit.startingStack, 0.01, 1000, p.startingStack);
        if (pit.lobbySeconds !== undefined) p.lobbySeconds = Math.round(num(pit.lobbySeconds, 5, 3600, p.lobbySeconds));
        if (pit.queueMaxSeconds !== undefined) p.queueMaxSeconds = Math.round(num(pit.queueMaxSeconds, 30, 7200, p.queueMaxSeconds));
        if (pit.maxConcurrent !== undefined) p.maxConcurrent = Math.round(num(pit.maxConcurrent, 1, 50, p.maxConcurrent));
        if (pit.carryover !== undefined) p.carryover = !!pit.carryover;
        if (pit.aggression !== undefined) p.aggression = num(pit.aggression, 0, 1, p.aggression);
        if (pit.difficulty !== undefined) p.difficulty = num(pit.difficulty, 0, 1, p.difficulty);
        if (pit.feeSplit && typeof pit.feeSplit === "object") p.feeSplit = { ...p.feeSplit, ...pit.feeSplit };
        // Prediction market betting config.
        if (pit.minBet !== undefined) p.minBet = num(pit.minBet, 0.0001, 1000, p.minBet);
        if (pit.maxBet !== undefined) p.maxBet = num(pit.maxBet, p.minBet, 100000, p.maxBet);
        if (Array.isArray(pit.quickChips))
          p.quickChips = pit.quickChips
            .map((c) => Number(c))
            .filter((c) => Number.isFinite(c) && c > 0)
            .slice(0, 8);
        if (pit.mainAllocationBps !== undefined || pit.houseAllocationBps !== undefined) {
          const main = Math.round(num(pit.mainAllocationBps ?? p.mainAllocationBps, 0, 10000, p.mainAllocationBps));
          p.mainAllocationBps = main;
          p.houseAllocationBps = 10000 - main; // the two always sum to 100%
        }
        if (pit.doubleDownBonus !== undefined) p.doubleDownBonus = num(pit.doubleDownBonus, 0, 1000, p.doubleDownBonus);
        if (Array.isArray(pit.houseSpecials))
          p.houseSpecials = pit.houseSpecials.filter((h): h is HouseSpecialKind =>
            HOUSE_SPECIALS.some((d) => d.kind === h),
          );
        if (Array.isArray(pit.durations))
          p.durations = pit.durations.filter((d): d is PitDurationKey =>
            ["blitz", "standard", "marathon"].includes(d as string),
          );
        // Flame Trial config.
        if (pit.trialRequiredPnlBps !== undefined)
          p.trialRequiredPnlBps = Math.round(num(pit.trialRequiredPnlBps, -10000, 100000, p.trialRequiredPnlBps));
        if (pit.trialMinUsd !== undefined) p.trialMinUsd = num(pit.trialMinUsd, 0, 100000, p.trialMinUsd);
        if (pit.trialMaxUsd !== undefined) p.trialMaxUsd = num(pit.trialMaxUsd, p.trialMinUsd, 1000000, p.trialMaxUsd);
        if (pit.trialLobbySeconds !== undefined)
          p.trialLobbySeconds = Math.round(num(pit.trialLobbySeconds, 3, 300, p.trialLobbySeconds));
        if (Array.isArray(pit.trialTiers))
          p.trialTiers = pit.trialTiers
            .filter((t) => t && typeof t === "object" && Number.isFinite(Number(t.minUsd)))
            .map((t) => ({
              name: String(t.name ?? "").slice(0, 24),
              minUsd: Number(t.minUsd),
              requiredPnlBps: Math.round(num(t.requiredPnlBps, -10000, 100000, p.trialRequiredPnlBps)),
              xp: Math.max(0, Math.round(Number(t.xp) || 0)),
              rarity: (["common", "rare", "epic", "legendary"].includes(t.rarity as string)
                ? t.rarity
                : "common") as "common" | "rare" | "epic" | "legendary",
            }))
            .sort((a, b) => a.minUsd - b.minUsd)
            .slice(0, 8);
      }
      if (burger && typeof burger === "object") {
        const b = store.settings.burger;
        const num = (v: unknown, lo: number, hi: number, dflt: number) =>
          Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : dflt));
        if (burger.enabled !== undefined) b.enabled = !!burger.enabled;
        if (burger.burgersPerEth !== undefined) b.burgersPerEth = num(burger.burgersPerEth, 0, 1_000_000, b.burgersPerEth);
        if (Array.isArray(burger.rules))
          b.rules = burger.rules
            .filter((r) => r && typeof r === "object" && typeof r.source === "string")
            .map((r) => ({
              source: r.source,
              label: String(r.label ?? r.source).slice(0, 40),
              amount: Math.round(num(r.amount, 0, 1_000_000, 0)),
              enabled: !!r.enabled,
              repeatable: r.repeatable !== false,
              cooldownSec: Math.round(num(r.cooldownSec, 0, 31_536_000, 0)),
              ...(Number.isFinite(Number(r.seasonalUntil)) && Number(r.seasonalUntil) > 0
                ? { seasonalUntil: Number(r.seasonalUntil) }
                : {}),
            }))
            .slice(0, 40);
        if (Array.isArray(burger.xpMilestones))
          b.xpMilestones = burger.xpMilestones
            .filter((m) => m && typeof m === "object" && Number.isFinite(Number(m.level)))
            .map((m) => ({
              level: Math.max(1, Math.round(Number(m.level))),
              amount: Math.round(num(m.amount, 0, 1_000_000, 0)),
              enabled: !!m.enabled,
            }))
            .sort((a, z) => a.level - z.level)
            .slice(0, 40);
        if (Array.isArray(burger.oneTimeMilestones))
          b.oneTimeMilestones = burger.oneTimeMilestones
            .filter((m) => m && typeof m === "object" && typeof m.id === "string")
            .map((m) => ({
              id: String(m.id).slice(0, 40),
              label: String(m.label ?? m.id).slice(0, 40),
              amount: Math.round(num(m.amount, 0, 1_000_000, 0)),
              enabled: !!m.enabled,
            }))
            .slice(0, 40);
        if (burger.revenueAllocation && typeof burger.revenueAllocation === "object") {
          for (const key of ["jackpot", "creator", "referral", "pit", "house"] as const) {
            const v = (burger.revenueAllocation as Record<string, unknown>)[key];
            if (v !== undefined) b.revenueAllocation[key] = num(v, 0, 1, b.revenueAllocation[key]);
          }
        }
      }
      if (goons && typeof goons === "object") {
        const g = store.settings.goons;
        const num = (v: unknown, lo: number, hi: number, dflt: number) =>
          Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : dflt));
        const unit = (v: unknown, dflt: number) => num(v, 0, 1, dflt);
        if (goons.enabled !== undefined) g.enabled = !!goons.enabled;
        if (goons.chatCooldownSec !== undefined) g.chatCooldownSec = num(goons.chatCooldownSec, 0, 3600, g.chatCooldownSec);
        if (goons.namedChancePerEvent !== undefined) g.namedChancePerEvent = unit(goons.namedChancePerEvent, g.namedChancePerEvent);
        if (goons.henchmanChancePerEvent !== undefined) g.henchmanChancePerEvent = unit(goons.henchmanChancePerEvent, g.henchmanChancePerEvent);
        if (goons.maxPerEvent !== undefined) g.maxPerEvent = Math.round(num(goons.maxPerEvent, 1, 5, g.maxPerEvent));
        if (goons.humanQuietSec !== undefined) g.humanQuietSec = num(goons.humanQuietSec, 0, 600, g.humanQuietSec);
        if (goons.ambientEverySec !== undefined) g.ambientEverySec = num(goons.ambientEverySec, 10, 3600, g.ambientEverySec);
        if (goons.memoryHours !== undefined) g.memoryHours = num(goons.memoryHours, 0, 8760, g.memoryHours);
        if (Array.isArray(goons.personas)) {
          const schedules = ["always", "random", "weekend", "tournament", "manual"];
          const rarities = ["legendary", "epic", "elite", "henchman"];
          g.personas = goons.personas
            .filter((p) => p && typeof p === "object" && typeof p.handle === "string" && typeof p.address === "string")
            .map((p) => ({
              handle: String(p.handle).slice(0, 24),
              address: String(p.address).toLowerCase(),
              name: String(p.name ?? p.handle).slice(0, 24),
              rarity: (rarities.includes(p.rarity as string) ? p.rarity : "epic") as import("@cookout/shared").GoonRarity,
              bio: String(p.bio ?? "").slice(0, 280),
              speechStyle: String(p.speechStyle ?? "").slice(0, 200),
              catchphrase: p.catchphrase ? String(p.catchphrase).slice(0, 120) : undefined,
              avatarUrl: p.avatarUrl ? sanitizeImageUrl(String(p.avatarUrl)) : undefined,
              chattiness: unit(p.chattiness, 0.4),
              aggression: unit(p.aggression, 0.4),
              confidence: unit(p.confidence, 0.5),
              optimism: unit(p.optimism, 0.5),
              sarcasm: unit(p.sarcasm, 0.4),
              humor: unit(p.humor, 0.4),
              rivals: Array.isArray(p.rivals) ? p.rivals.map((r) => String(r).slice(0, 24)).slice(0, 8) : [],
              favoriteTopics: Array.isArray(p.favoriteTopics) ? p.favoriteTopics.map((t) => String(t).slice(0, 40)).slice(0, 10) : [],
              schedule: (schedules.includes(p.schedule as string) ? p.schedule : "random") as import("@cookout/shared").GoonSchedule,
              enabled: p.enabled !== false,
              pools: sanitizeGoonPools(p.pools),
            }))
            .slice(0, 60);
        }
      }
      store.logAdmin("settings", JSON.stringify({ ...store.settings, goons: "[roster]" }));
      res.json(store.settings);
    }),
  );

  // ---- admin: Burger economy management ----
  /** Economy-health analytics for the Burger Economy Manager. */
  app.get(
    "/api/admin/burger/analytics",
    admin,
    wrap((_req, res) => {
      res.json({
        analytics: burgerAnalytics(store),
        revenueBuckets: store.burgerRevenueBuckets,
        revenue: [...store.burgerRevenueLedger].reverse().slice(0, 200),
      });
    }),
  );

  /** Preview a persona's dialogue: return a sample filled line for a category.
   *  Body: { handle, category }. Lets admins test a personality before saving. */
  app.post(
    "/api/admin/goons/preview",
    admin,
    wrap((req, res) => {
      const { handle, category } = req.body as { handle?: string; category?: string };
      const p = store.settings.goons.personas.find((x) => x.handle === String(handle));
      if (!p) throw new Err(404, "persona not found");
      const pool = (p.pools as Record<string, { text: string }[]>)[String(category)] ?? [];
      if (pool.length === 0) {
        res.json({ line: `(${p.name} has no ${category} lines)` });
        return;
      }
      const raw = pool[Math.floor(Math.random() * pool.length)]!.text;
      const rivalName =
        p.rivals.length > 0
          ? store.settings.goons.personas.find((x) => x.handle === p.rivals[0])?.name ?? p.rivals[0]
          : "someone";
      const line = raw
        .replace(/\{player\}/g, "trader")
        .replace(/\{winner\}/g, "trader")
        .replace(/\{symbol\}/g, "$DEMO")
        .replace(/\{rival\}/g, rivalName ?? "someone")
        .replace(/\{streak\}/g, "3");
      res.json({ line, name: p.name });
    }),
  );

  /** Grant (positive) or remove (negative) Burgers from a player. Body:
   *  { address, amount, note? }. Also accepts a source reward simulation. */
  app.post(
    "/api/admin/burger/grant",
    admin,
    wrap((req, res) => {
      const { address, amount, note } = req.body as { address?: string; amount?: number; note?: string };
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Err(400, "a valid wallet address is required (0x…)");
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt === 0) throw new Err(400, "a nonzero amount is required");
      const balance = adminAdjustBurgers(store, address.toLowerCase(), amt, String(note ?? "").slice(0, 60));
      store.logAdmin("burger_grant", `${amt > 0 ? "+" : ""}${Math.round(amt)} $BURG → ${address} (${note ?? ""})`);
      res.json({ ok: true, balance });
    }),
  );

  // ---- pre-launch beta signups ----
  app.post(
    "/api/beta/signup",
    wrap((req, res) => {
      const { address, xHandle } = req.body as { address?: string; xHandle?: string };
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address))
        throw new Err(400, "a valid wallet address is required (0x…)");
      const key = address.toLowerCase();
      if (store.betaSignups.has(key)) {
        res.json({ ok: true, already: true, count: store.betaSignups.size });
        return;
      }
      store.betaSignups.set(key, {
        address: key,
        xHandle: xHandle ? String(xHandle).replace(/^@/, "").slice(0, 32) : undefined,
        at: Date.now(),
        // Collected only — NOT access. Admin approves wallets at beta launch.
        approved: false,
      });
      res.json({ ok: true, count: store.betaSignups.size });
    }),
  );

  app.get(
    "/api/beta/count",
    wrap((_req, res) => res.json({ count: store.betaSignups.size })),
  );

  app.get(
    "/api/admin/beta",
    admin,
    wrap((_req, res) => {
      const signups = [...store.betaSignups.values()].sort((a, b) => a.at - b.at);
      res.json({
        signups,
        total: signups.length,
        approved: signups.filter((s) => s.approved).length,
        pending: signups.filter((s) => !s.approved).length,
        whitelistOn: process.env.BETA_WHITELIST === "1",
      });
    }),
  );

  const BETA_ADDR = /^0x[0-9a-fA-F]{40}$/;

  /** Approve one wallet (creating the signup if the admin is adding it directly). */
  app.post(
    "/api/admin/beta/approve",
    admin,
    wrap((req, res) => {
      const { address, xHandle } = req.body as { address?: string; xHandle?: string };
      if (!address || !BETA_ADDR.test(address)) throw new Err(400, "valid wallet address required");
      const key = address.toLowerCase();
      const existing = store.betaSignups.get(key);
      if (existing) existing.approved = true;
      else
        store.betaSignups.set(key, {
          address: key,
          xHandle: xHandle ? String(xHandle).replace(/^@/, "").slice(0, 32) : undefined,
          at: Date.now(),
          approved: true,
        });
      store.logAdmin("beta_approve", key);
      res.json({ ok: true, address: key, approved: true });
    }),
  );

  /** Bulk-approve every collected signup — the "open the beta" button. */
  app.post(
    "/api/admin/beta/approve-all",
    admin,
    wrap((_req, res) => {
      let approvedNow = 0;
      for (const s of store.betaSignups.values()) {
        if (!s.approved) {
          s.approved = true;
          approvedNow++;
        }
      }
      store.logAdmin("beta_approve_all", `${approvedNow} wallets`);
      res.json({ ok: true, approvedNow, total: store.betaSignups.size });
    }),
  );

  /** Remove a wallet from the collected list entirely (test/spam cleanup). */
  app.post(
    "/api/admin/beta/remove",
    admin,
    wrap((req, res) => {
      const { address } = req.body as { address?: string };
      if (!address || !BETA_ADDR.test(address)) throw new Err(400, "valid wallet address required");
      const key = address.toLowerCase();
      const existed = store.betaSignups.delete(key);
      store.logAdmin("beta_remove", key);
      res.json({ ok: true, address: key, removed: existed });
    }),
  );

  /** Bulk import (CSV upload): add + approve a list of wallets from X engagement. */
  app.post(
    "/api/admin/beta/import",
    admin,
    wrap((req, res) => {
      const { addresses } = req.body as { addresses?: unknown };
      if (!Array.isArray(addresses)) throw new Err(400, "addresses array required");
      let added = 0;
      let already = 0;
      let invalid = 0;
      for (const raw of addresses) {
        const a = String(raw).trim().toLowerCase();
        if (!BETA_ADDR.test(a)) {
          invalid++;
          continue;
        }
        const existing = store.betaSignups.get(a);
        if (existing) {
          if (!existing.approved) {
            existing.approved = true;
            added++;
          } else already++;
        } else {
          store.betaSignups.set(a, { address: a, at: Date.now(), approved: true });
          added++;
        }
      }
      store.logAdmin("beta_import", `${added} added/approved, ${already} existing, ${invalid} invalid`);
      res.json({ ok: true, added, already, invalid, total: addresses.length });
    }),
  );

  /** Revoke access for a wallet (keeps it on the collected list, unapproved). */
  app.post(
    "/api/admin/beta/revoke",
    admin,
    wrap((req, res) => {
      const { address } = req.body as { address?: string };
      if (!address || !BETA_ADDR.test(address)) throw new Err(400, "valid wallet address required");
      const key = address.toLowerCase();
      const s = store.betaSignups.get(key);
      if (s) s.approved = false;
      store.logAdmin("beta_revoke", key);
      res.json({ ok: true, address: key, approved: false });
    }),
  );

  // ---- creator submissions & community voting ----
  app.post(
    "/api/concepts",
    auth,
    wrap((req, res) => {
      const { name, symbol, theme, pitch, artworkUrl, bannerUrl } = req.body as Record<string, string>;
      const rawSupply = (req.body as { totalSupply?: number }).totalSupply;
      if (!name || !symbol || !theme) throw new Err(400, "name, symbol, theme required");
      let totalSupply: number | undefined;
      if (rawSupply !== undefined && rawSupply !== null && rawSupply !== ("" as unknown)) {
        totalSupply = Math.floor(Number(rawSupply));
        if (!Number.isFinite(totalSupply) || totalSupply < MIN_TOKEN_SUPPLY || totalSupply > MAX_TOKEN_SUPPLY)
          throw new Err(
            400,
            `totalSupply must be between ${MIN_TOKEN_SUPPLY.toLocaleString()} and ${MAX_TOKEN_SUPPLY.toLocaleString()}`,
          );
      }
      const creator = store.getOrCreateUser(req.userAddress!);
      // Launching is the other thing the platform actually signs (createRound
      // runs on the operator key), so it is gated separately from the session:
      // a halt has to stop new launches without evicting everyone mid-round.
      if (compliance.settings().haltNewLaunches)
        throw new Err(503, "new launches are paused right now — existing rounds are unaffected");
      const launchCheck = compliance.check(req, creator.address);
      if (!launchCheck.allowed) throw new Err(451, launchCheck.message ?? "unavailable");
      // The launchpad's single curated choice: a game mode bundles risk tier,
      // match length, and rug rules. Modes are level-gated (Endurance is
      // reserved). The legacy tier+matchMinutes path stays for back-compat.
      const rawMode = (req.body as { mode?: string }).mode;
      let mode: GameMode | undefined;
      let tier: RiskTier = "rookie";
      let matchMinutes: number | undefined;
      if (rawMode !== undefined) {
        if (!GAME_MODE_MAP[rawMode as GameMode]) throw new Err(400, "unknown game mode");
        const def = store.modeDef(rawMode as GameMode);
        if (def.disabled) throw new Err(403, `${def.name} isn't available yet — it unlocks later`);
        if (isEnduranceMode(def.key) && !store.flag("endurance"))
          throw new Err(503, "Endurance launches are paused right now");
        if (creator.level < def.unlockLevel)
          throw new Err(
            403,
            `reach level ${def.unlockLevel} to launch a ${def.name} coin (you're level ${creator.level})`,
          );
        mode = def.key;
        tier = def.tier;
        matchMinutes = def.minutes ?? undefined;
      } else {
        // Legacy: risk tier is creator-chosen but level-gated. Absent → rookie.
        const rawTier = (req.body as { tier?: string }).tier;
        if (rawTier !== undefined) {
          if (!["rookie", "standard", "degen"].includes(rawTier)) throw new Err(400, "bad tier");
          tier = rawTier as RiskTier;
          if (creator.level < TIER_UNLOCK_LEVEL[tier])
            throw new Err(
              403,
              `level ${TIER_UNLOCK_LEVEL[tier]} required to launch a ${tier} coin (you're level ${creator.level})`,
            );
        }
        const rawMinutes = (req.body as { matchMinutes?: number }).matchMinutes;
        if (rawMinutes !== undefined && rawMinutes !== null) {
          matchMinutes = Number(rawMinutes);
          if (!MATCH_MINUTE_OPTIONS.includes(matchMinutes as (typeof MATCH_MINUTE_OPTIONS)[number]))
            throw new Err(400, `matchMinutes must be one of ${MATCH_MINUTE_OPTIONS.join(", ")}`);
        }
      }
      // Creator vetting (spec §5.2): cooldown + rug-ban screen, audit-trailed.
      const ban = activeRugBan(creator);
      const recent = [...store.concepts.values()].filter(
        (c) => c.creatorAddress === creator.address && Date.now() - c.createdAt < 60 * 60 * 1000,
      );
      if (ban)
        throw new Err(
          403,
          "this wallet is banned from launching coins after a rug. Check the Reputation section on your Profile page",
        );
      if (recent.length >= 3) throw new Err(429, "creator cooldown: max 3 submissions per hour");
      const concept: TokenConcept = {
        id: store.id(),
        creatorAddress: creator.address,
        name: String(name).slice(0, 48),
        symbol: String(symbol).toUpperCase().slice(0, 8),
        theme: String(theme).slice(0, 140),
        pitch: pitch ? String(pitch).slice(0, 1000) : undefined,
        socials: sanitizeSocials((req.body as { socials?: unknown }).socials),
        // Endurance takes no modifiers — Over Time is meaningless with no clock.
        modifiers: isEnduranceMode(mode)
          ? undefined
          : sanitizeModifiers((req.body as { modifiers?: unknown }).modifiers),
        artworkUrl: artworkUrl ? sanitizeImageUrl(artworkUrl) : undefined,
        bannerUrl: bannerUrl ? sanitizeImageUrl(bannerUrl) : undefined,
        feeDestination: feeDestinationOf((req.body as { feeDestination?: unknown }).feeDestination),
        totalSupply,
        tier,
        mode,
        matchMinutes,
        status: "submitted",
        votes: 0,
        createdAt: Date.now(),
      };
      store.concepts.set(concept.id, concept);
      // Burger economy: launching a coin pays the creator + First Launch.
      awardBurger(store, creator.address, "coin_launch", { ref: concept.id });
      awardBurgerOneTime(store, creator.address, "first_launch");
      store.logAdmin(
        "vetting",
        `concept ${concept.id} (${concept.symbol}, ${tier}) accepted: template-only deploy, rug-flag check passed, cooldown ok`,
      );
      // Announce it in the Vote Shilling pit so the creator can rally votes.
      store.emitRoundEvent({
        kind: "submitted",
        roundId: concept.id,
        symbol: concept.symbol,
        name: concept.name,
        by: creator.displayName,
      });
      res.json(concept);
    }),
  );

  app.get(
    "/api/concepts",
    wrap((req, res) => {
      const status = req.query.status as string | undefined;
      let list = [...store.concepts.values()];
      if (status) list = list.filter((c) => c.status === status);
      list.sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt);
      // Tag each with whether its coin has graduated (edit is socials-only after
      // that). One pass over rounds, not one per concept.
      const graduatedConcepts = new Set(
        [...store.rounds.values()].filter((r) => r.graduated).map((r) => r.conceptId),
      );
      res.json(list.map((c) => ({ ...c, graduated: graduatedConcepts.has(c.id) })));
    }),
  );

  /** A single concept — public, powers the /coin/:id share page and its card. */
  app.get(
    "/api/concepts/:id",
    wrap((req, res) => {
      const concept = store.concepts.get(req.params.id!);
      if (!concept) throw new Err(404, "concept not found");
      res.json(pubConcept(store, concept));
    }),
  );

  /**
   * Edit a coin after launch — creator only. Socials can always be changed.
   * Everything else (name, theme, pitch, coin image, banner) can be edited right
   * up until the coin graduates; once it has graduated, only the socials are
   * editable. The ticker and supply are never editable. Edits reflect onto any
   * round of this concept so the live/cook-out card matches immediately.
   */
  app.patch(
    "/api/concepts/:id",
    auth,
    wrap((req, res) => {
      const concept = store.concepts.get(req.params.id!);
      if (!concept) throw new Err(404, "concept not found");
      if (concept.creatorAddress.toLowerCase() !== req.userAddress!.toLowerCase())
        throw new Err(403, "only this coin's creator can edit it");
      const roundsForConcept = [...store.rounds.values()].filter((r) => r.conceptId === concept.id);
      const graduated = roundsForConcept.some((r) => r.graduated);
      const body = req.body as Record<string, unknown>;

      // Socials: always editable.
      if ("socials" in body) concept.socials = sanitizeSocials(body.socials);
      // Everything else is locked once the coin has graduated.
      if (!graduated) {
        if (typeof body.name === "string" && body.name.trim())
          concept.name = body.name.trim().slice(0, 48);
        if (typeof body.theme === "string" && body.theme.trim())
          concept.theme = body.theme.trim().slice(0, 140);
        if ("pitch" in body)
          concept.pitch = body.pitch ? String(body.pitch).slice(0, 1000) : undefined;
        if ("artworkUrl" in body)
          concept.artworkUrl = body.artworkUrl ? sanitizeImageUrl(body.artworkUrl) : undefined;
        if ("bannerUrl" in body)
          concept.bannerUrl = body.bannerUrl ? sanitizeImageUrl(body.bannerUrl) : undefined;
        // Modifiers (e.g. Over Time) can be toggled until the coin launches.
        if ("modifiers" in body) concept.modifiers = sanitizeModifiers(body.modifiers);
      }

      // Reflect the edit onto any round(s) of this concept and push it live.
      for (const r of roundsForConcept) {
        r.token.name = concept.name;
        r.token.theme = concept.theme;
        r.token.artworkUrl = concept.artworkUrl;
        r.token.bannerUrl = concept.bannerUrl;
        r.token.socials = concept.socials;
        broadcast(r.id, { type: "round_state", round: r });
      }
      store.logAdmin(
        "concept_edit",
        `${req.userAddress} edited $${concept.symbol}${graduated ? " (socials only, graduated)" : ""}`,
      );
      res.json(pubConcept(store, concept));
    }),
  );

  /**
   * The concept's coin image as a real, fetchable file — so a shared /coin/:id
   * link unfurls with the coin's art on X/Telegram (crawlers can't read the
   * data-URL that lives in JSON). Data-URL uploads are decoded to bytes; plain
   * https artwork is redirected to; anything missing falls back to the site's
   * default share image.
   */
  app.get(
    "/api/concepts/:id/image",
    wrap((req, res) => {
      const concept = store.concepts.get(req.params.id!);
      const art = concept?.artworkUrl;
      const fallback =
        (process.env.WEB_BASE_URL ?? "https://www.thecookout.fun").replace(/\/$/, "") +
        "/opengraph-image";
      if (!art) return res.redirect(302, fallback);
      const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(art);
      if (m) {
        const buf = Buffer.from(m[2]!, "base64");
        res.setHeader("content-type", m[1]!);
        res.setHeader("cache-control", "public, max-age=86400, immutable");
        return res.end(buf);
      }
      if (/^https?:\/\//.test(art)) return res.redirect(302, art);
      return res.redirect(302, fallback);
    }),
  );

  app.post(
    "/api/concepts/:id/vote",
    auth,
    wrap((req, res) => {
      const concept = store.concepts.get(req.params.id!);
      if (!concept) throw new Err(404, "concept not found");
      if (concept.status !== "submitted" && concept.status !== "shortlisted")
        throw new Err(409, "voting closed for this concept");
      let voters = store.conceptVoters.get(concept.id);
      if (!voters) {
        voters = new Set();
        store.conceptVoters.set(concept.id, voters);
      }
      if (voters.has(req.userAddress!)) throw new Err(409, "already voted");
      voters.add(req.userAddress!);
      concept.votes++;
      res.json(concept);
    }),
  );

  // ---- calendar & rounds ----
  // ---- the social layer ----

  /** The always-on community room's recent history. */
  app.get(
    "/api/social/global",
    wrap((_req, res) => {
      res.json({
        messages: (store.chat.get(GLOBAL_ROOM) ?? []).slice(-120),
        online: presence(),
        pinned: store.settings.pinnedAnnouncement || undefined,
      });
    }),
  );

  /** Any room's recent history (global or a match room). */
  app.get(
    "/api/chat/:roomId",
    wrap((req, res) => {
      res.json({ messages: (store.chat.get(req.params.roomId!) ?? []).slice(-200) });
    }),
  );

  /** Who's online right now, with what they're doing. */
  /** The activity feed. scope=following filters to who you follow. */
  app.get(
    "/api/social/feed",
    wrap((req, res) => {
      const scope = String(req.query.scope ?? "all");
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const me = token ? store.sessionAddress(token) : undefined;
      let events = store.activity;
      if (scope === "following" && me) {
        const follows = new Set(store.getOrCreateUser(me).following ?? []);
        events = events.filter((e) => follows.has(e.address) || e.address === me);
      }
      res.json({
        events: events.slice(-80).reverse(),
        following: me ? (store.getOrCreateUser(me).following ?? []) : [],
      });
    }),
  );

  /** The caller's recent @-mention pings, newest first (seeds the Pings feed
   *  on load; live pings arrive over the socket). */
  app.get(
    "/api/social/pings",
    auth,
    wrap((req, res) => res.json({ pings: store.pings.get(req.userAddress!) ?? [] })),
  );

  /** Follow / unfollow a player. */
  app.post(
    "/api/me/follow",
    auth,
    wrap((req, res) => {
      const { address, follow } = req.body as { address?: string; follow?: boolean };
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Err(400, "bad address");
      const following = store.setFollowing(req.userAddress!, address, follow !== false);
      res.json({ following });
    }),
  );

  app.get(
    "/api/social/online",
    wrap((_req, res) => res.json({ online: presence() })),
  );

  app.get(
    "/api/calendar",
    wrap((_req, res) => {
      const rounds = [...store.rounds.values()].sort((a, b) => a.scheduledAt - b.scheduledAt);
      res.json(rounds);
    }),
  );

  app.get(
    "/api/rounds/:id",
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round) throw new Err(404, "round not found");
      const trades = store.trades.get(round.id) ?? [];
      res.json({
        round,
        killfeed: (store.killfeed.get(round.id) ?? []).slice(-50),
        chat: (store.chat.get(round.id) ?? []).slice(-50),
        trades: trades.slice(-100),
        candles: store.candles.get(round.id) ?? [],
        predictions: engine.predictionCounts(round.id),
        auction: store.auctionResults.get(round.id) ?? null,
        summary: store.summaries.get(round.id) ?? null,
        // The live ETH/USD peg, so the client can offer dollar entry even
        // before the live ticker starts (i.e. during the pull-up queue).
        ethUsd: store.ethUsd,
      });
    }),
  );

  /** Run It Back: a coin that didn't graduate gets another shot. Only the
   *  coin's developer can trigger it; the rerun re-schedules the ORIGINAL
   *  concept — same tier, same match length, same tokenomics — into the next
   *  free calendar slot, no new vote needed. Rug-banned wallets are refused
   *  the same way as a fresh launch. */
  app.post(
    "/api/rounds/:id/runback",
    auth,
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round) throw new Err(404, "round not found");
      if (round.state !== "results") throw new Err(400, "this match hasn't finished yet");
      if (round.graduated) throw new Err(400, "this coin served up; nothing to run back");
      if (round.creatorAddress.toLowerCase() !== req.userAddress!.toLowerCase())
        throw new Err(403, "only this coin's developer can run it back");
      const creator = store.getOrCreateUser(req.userAddress!);
      if (activeRugBan(creator))
        throw new Err(
          403,
          "this wallet is banned from launching coins after a rug. Check the Reputation section on your Profile page",
        );
      const concept = store.concepts.get(round.conceptId);
      if (!concept) throw new Err(404, "the original concept is gone");
      const pending = [...store.rounds.values()].some(
        (r) => r.conceptId === round.conceptId && r.state !== "results",
      );
      if (pending) throw new Err(409, "this coin is already back on the calendar");
      if (concept.status === "submitted" || concept.status === "shortlisted")
        throw new Err(409, "this coin is already back on the vote");
      // Run It Back now lets the dev pick a fresh mode. Absent → same setup as
      // the original round. The chosen mode re-derives tier, length, and rug
      // rules; it's stamped onto the concept so the re-vote (and its card)
      // reflect the new settings.
      const rawMode = (req.body as { mode?: string }).mode;
      if (rawMode !== undefined) {
        if (!GAME_MODE_MAP[rawMode as GameMode]) throw new Err(400, "unknown game mode");
        const def = store.modeDef(rawMode as GameMode);
        if (def.disabled) throw new Err(403, `${def.name} isn't available yet — it unlocks later`);
        if (isEnduranceMode(def.key) && !store.flag("endurance"))
          throw new Err(503, "Endurance launches are paused right now");
        if (creator.level < def.unlockLevel)
          throw new Err(
            403,
            `reach level ${def.unlockLevel} to run it back as ${def.name} (you're level ${creator.level})`,
          );
        concept.mode = def.key;
        concept.tier = def.tier;
        concept.matchMinutes = def.minutes ?? undefined;
      }
      // The dev can also flip modifiers (e.g. Over Time) on the re-run.
      if ("modifiers" in (req.body as object))
        concept.modifiers = sanitizeModifiers((req.body as { modifiers?: unknown }).modifiers);
      // …but never on Endurance, which has no clock for a modifier to act on.
      if (isEnduranceMode(concept.mode)) concept.modifiers = undefined;
      // Instead of jumping straight onto the calendar, a run-back sends the coin
      // back through the community vote: reset it to a fresh submission and let
      // the crowd decide if it cooks again. The chosen mode rides on the concept.
      concept.status = "submitted";
      concept.votes = 0;
      concept.createdAt = Date.now();
      store.conceptVoters.delete(concept.id);
      store.emitRoundEvent({
        kind: "submitted",
        roundId: concept.id,
        symbol: concept.symbol,
        name: concept.name,
        by: creator.displayName,
        mode: concept.mode,
        rerun: true,
      });
      store.logAdmin(
        "runback",
        `${req.userAddress} ran back $${concept.symbol} to the vote (round ${round.id} → concept ${concept.id})`,
      );
      res.json({ conceptId: concept.id, status: concept.status });
    }),
  );

  app.get(
    "/api/rounds/:id/me",
    auth,
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round) throw new Err(404, "round not found");
      const pos = store.position(round.id, req.userAddress!);
      const intents = (store.intents.get(round.id) ?? []).filter(
        (i) => i.userAddress === req.userAddress,
      );
      // Rug meter — creator-only. How close the dev is to auto-rugging their own
      // coin: a rug fires the instant cumulative sells cross DEV_DUMP_FRACTION of
      // the most they ever held. Only computed live, and only for the creator, so
      // nobody else can read the dev's hand.
      // Only when rug rules apply — Blitz/Reflex have no auto-rug, so no meter.
      let rug: { sold: number; maxHeld: number; threshold: number; fraction: number } | undefined;
      if (
        round.creatorAddress === req.userAddress &&
        round.state === "live" &&
        round.config.rugRules !== false
      ) {
        const m = engine.meta(round.id, req.userAddress!);
        const threshold = DEV_DUMP_FRACTION * m.maxTokens;
        rug = {
          sold: m.tokensSoldBeforeEnd,
          maxHeld: m.maxTokens,
          threshold,
          fraction: threshold > 0 ? Math.min(1, m.tokensSoldBeforeEnd / threshold) : 0,
        };
      }
      // Their own Fair Open result, so the round page can show — in the moment —
      // how much of their pull-up actually cleared vs refunded (the auction is
      // capped, so an oversubscribed pull fills pro-rata).
      let fill: MyFill | undefined;
      const auction = store.auctionResults.get(round.id);
      if (auction) {
        const mine = auction.fills.filter((f) => f.userAddress === req.userAddress);
        const committedEth = mine.reduce((s, f) => s + f.ethIn, 0);
        if (committedEth > 0) {
          const filledEth = mine.reduce((s, f) => s + f.ethFilled, 0);
          const refundEth = mine.reduce((s, f) => s + f.refund, 0);
          const tokens = mine.reduce((s, f) => s + f.tokensOut, 0);
          fill = { committedEth, filledEth, refundEth, ratio: filledEth / committedEth, tokens };
        }
      }
      res.json({
        position: pos,
        intents,
        balance: store.getOrCreateUser(req.userAddress!).arenaBalance ?? 0,
        prediction: store.predictions.get(round.id)?.get(req.userAddress!)?.call ?? null,
        rug,
        fill,
      });
    }),
  );

  app.post(
    "/api/rounds/:id/intents",
    auth,
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round) throw new Err(404, "round not found");
      const user = store.getOrCreateUser(req.userAddress!);
      if (user.level < TIER_UNLOCK_LEVEL[round.tier as RiskTier])
        throw new Err(403, `level ${TIER_UNLOCK_LEVEL[round.tier as RiskTier]} required for ${round.tier}`);
      const { ethAmount, maxPrice } = req.body as { ethAmount?: number; maxPrice?: number };
      const intent = engine.submitIntent(
        round.id,
        req.userAddress!,
        Number(ethAmount),
        maxPrice !== undefined ? Number(maxPrice) : undefined,
        Date.now(),
      );
      res.json(intent);
    }),
  );

  app.delete(
    "/api/rounds/:id/intents/:intentId",
    auth,
    wrap((req, res) => {
      engine.cancelIntent(req.params.id!, req.userAddress!, req.params.intentId!);
      res.json({ ok: true });
    }),
  );

  // During the queue the live bid board is public (who + size — the same
  // information everyone gets at one uniform price anyway); after settlement
  // the full intent list including limits is public so anyone can recompute
  // the clearing price and audit hash (spec §6/§13).
  app.get(
    "/api/rounds/:id/intents",
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round) throw new Err(404, "round not found");
      const intents = store.intents.get(round.id) ?? [];
      if (round.state === "lobby" || round.state === "queue_open" || round.state === "scheduled") {
        res.json({
          count: intents.length,
          totalEth: intents.reduce((s, i) => s + i.ethAmount, 0),
          bids: intents.map((i) => {
            const u = store.users.get(i.userAddress);
            return {
              userAddress: i.userAddress,
              displayName: u?.displayName,
              avatarUrl: u?.avatarUrl,
              ethAmount: i.ethAmount,
              limit: i.maxPrice !== undefined,
              at: i.submittedAt,
            };
          }),
        });
        return;
      }
      res.json({ intents });
    }),
  );

  /** Live top holders: biggest bags right now (live or alumni market). */
  app.get(
    "/api/rounds/:id/holders",
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round) throw new Err(404, "round not found");
      const price = round.pool ? spotPrice(round.pool) : 0;
      const holders = [...(store.positions.get(round.id)?.values() ?? [])]
        .filter((p) => p.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 10)
        .map((p) => {
          const u = store.users.get(p.userAddress);
          return {
            address: p.userAddress,
            displayName: u?.displayName,
            avatarUrl: u?.avatarUrl,
            badge: COSMETICS.find((c) => c.id === u?.equipped.badge)?.value,
            tokens: p.tokens,
            pctOfSupply: (p.tokens / round.config.totalSupply) * 100,
            valueEth: p.tokens * price,
          };
        });
      res.json({ holders, totalSupply: round.config.totalSupply });
    }),
  );

  app.get(
    "/api/rounds/:id/auction",
    wrap((req, res) => {
      const result = store.auctionResults.get(req.params.id!);
      if (!result) throw new Err(404, "auction not settled");
      res.json(result);
    }),
  );

  app.post(
    "/api/rounds/:id/trade",
    auth,
    wrap((req, res) => {
      const { side, eth, tokens, pct } = req.body as {
        side?: "buy" | "sell";
        eth?: number;
        tokens?: number;
        pct?: number;
      };
      if (side !== "buy" && side !== "sell") throw new Err(400, "side must be buy or sell");
      const trade = engine.trade(
        req.params.id!,
        req.userAddress!,
        side,
        {
          eth: eth !== undefined ? Number(eth) : undefined,
          tokens: tokens !== undefined ? Number(tokens) : undefined,
          pct: pct !== undefined ? Number(pct) : undefined,
        },
        Date.now(),
      );
      const user = store.getOrCreateUser(req.userAddress!);
      const pos = store.position(req.params.id!, req.userAddress!);
      res.json({ trade, balance: user.arenaBalance ?? 0, position: pos });
    }),
  );

  app.post(
    "/api/rounds/:id/predict",
    auth,
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round) throw new Err(404, "round not found");
      if (round.state === "ended" || round.state === "results")
        throw new Err(409, "round already ended");
      const { call } = req.body as { call?: "moon" | "rug" };
      if (call !== "moon" && call !== "rug") throw new Err(400, "call must be moon or rug");
      // The developer can't call rug on their own ruggable coin — they hold the
      // rug switch, so that'd be an insider bet. They can only call moon.
      const isDev = round.creatorAddress.toLowerCase() === req.userAddress!.toLowerCase();
      const ruggable = round.config.rugRules !== false;
      if (call === "rug" && isDev && ruggable)
        throw new Err(403, "the developer can only call moon on their own coin");
      let preds = store.predictions.get(round.id);
      if (!preds) {
        preds = new Map();
        store.predictions.set(round.id, preds);
      }
      if (preds.has(req.userAddress!)) throw new Err(409, "already predicted");
      preds.set(req.userAddress!, {
        roundId: round.id,
        userAddress: req.userAddress!,
        call,
        at: Date.now(),
      });
      store.trackActivity(req.userAddress!, "predictions");
      const counts = engine.predictionCounts(round.id);
      broadcast(round.id, { type: "prediction_update", roundId: round.id, ...counts });
      res.json({ ok: true, counts });
    }),
  );

  // ---- jackpot ----
  app.get(
    "/api/jackpot",
    wrap((_req, res) => res.json(jackpotStatus(store))),
  );

  // ---- leaderboards ----
  app.get(
    "/api/leaderboard",
    wrap((req, res) => {
      const scope = (req.query.scope as string) ?? "alltime"; // alltime | season | today | week | round
      const metric = (req.query.metric as string) ?? "pnl"; // pnl | xp | wins (today/week: pnl|wins only)
      const season = store.seasonKey();
      const row = (u: StoredUser, value: number) => ({
        address: u.address,
        displayName: u.displayName,
        level: u.level,
        title: u.title,
        badge: COSMETICS.find((c) => c.id === u.equipped.badge)?.value,
        value,
      });

      // Current-match leaderboard: live unrealized+realized PnL per position.
      if (scope === "round") {
        const round = store.rounds.get(String(req.query.roundId ?? ""));
        if (!round?.pool) {
          res.json({ scope, metric: "pnl", rows: [] });
          return;
        }
        const price = spotPrice(round.pool);
        const rows = [...(store.positions.get(round.id)?.values() ?? [])]
          .map((p) => {
            const u = store.getOrCreateUser(p.userAddress);
            return row(u, p.realizedPnl + p.tokens * price - p.costBasisEth);
          })
          .sort((a, b) => b.value - a.value)
          .slice(0, 100);
        res.json({ scope, metric: "pnl", rows });
        return;
      }

      // The Pit's own boards, computed from lifetime pitStats.
      if (scope === "pit") {
        const rows = [...store.users.values()]
          .filter((u) => u.pitStats && u.pitStats.matchesPlayed > 0 && !u.address.startsWith("0xb07"))
          .map((u) => {
            const ps = u.pitStats!;
            let value: number;
            switch (metric) {
              case "accuracy":
                value = ps.predictionsMade
                  ? Math.round((ps.predictionsCorrect / ps.predictionsMade) * 100)
                  : 0;
                break;
              case "predWins":
                value = ps.predictionWins;
                break;
              case "tradeWins":
                value = ps.tradingWins;
                break;
              case "double":
                value = ps.doubleWins;
                break;
              case "largest":
                value = ps.largestWin;
                break;
              case "streak":
                value = ps.longestProfitStreak;
                break;
              case "blitz":
                value = ps.byDuration.blitz.wins;
                break;
              case "standard":
                value = ps.byDuration.standard.wins;
                break;
              case "marathon":
                value = ps.byDuration.marathon.wins;
                break;
              case "earnings":
                value = ps.totalEarnings;
                break;
              case "trialWins":
                value = ps.trialsWon;
                break;
              case "trialXp":
                value = ps.trialXp;
                break;
              case "trialStreak":
                value = ps.bestTrialWinStreak;
                break;
              case "trialPnl":
                value = Math.round(ps.highestTrialPnlPct * 100);
                break;
              default:
                value = ps.highestPnl; // "profit": best single-match PnL
            }
            return row(u, value);
          })
          .sort((a, b) => b.value - a.value)
          .slice(0, 100);
        res.json({ scope, metric, rows });
        return;
      }

      // today/week: computed from each player's round history timestamps.
      const windowStart =
        scope === "today"
          ? new Date().setUTCHours(0, 0, 0, 0)
          : scope === "week"
            ? Date.now() - 7 * 86_400_000
            : 0;
      const rows = [...store.users.values()]
        .map((u) => {
          let value: number;
          if (scope === "today" || scope === "week") {
            if (metric === "xp") {
              // XP is bucketed per UTC day and per ISO week (the week reset
              // matches the jackpot). Today reads the day bucket, This Week the
              // week bucket.
              value =
                scope === "week"
                  ? (u.weeklyXp[weekKey()] ?? 0)
                  : (u.dailyXp[dayKey()] ?? 0);
            } else {
              const slice = u.history.filter((h) => h.at >= windowStart);
              value =
                metric === "wins"
                  ? slice.filter((h) => h.pnl > 0).length
                  : slice.reduce((s, h) => s + h.pnl, 0);
            }
          } else if (scope === "season") {
            const s = u.seasons[season];
            value = (s as unknown as Record<string, number> | undefined)?.[metric] ?? 0;
          } else {
            value = metric === "xp" ? u.xp : metric === "wins" ? u.stats.wins : u.stats.totalPnl;
          }
          return row(u, value);
        })
        .sort((a, b) => b.value - a.value)
        .slice(0, 100);
      res.json({ scope, metric, rows });
    }),
  );

  // ---- admin ----
  app.get(
    "/api/admin/overview",
    admin,
    wrap((_req, res) => {
      const rounds = [...store.rounds.values()];
      let fees = 0;
      for (const f of store.feesByRound.values()) fees += f;
      res.json({
        users: store.users.size,
        concepts: store.concepts.size,
        rounds: rounds.length,
        liveRounds: rounds.filter((r) => r.state === "live").length,
        totalFees: fees,
        betaSignups: store.betaSignups.size,
        whitelistOn: process.env.BETA_WHITELIST === "1",
        chainEnabled: !!chain?.enabled,
        feedbackCount: store.feedback.length,
        settings: store.settings,
        log: store.adminLog.slice(-50),
      });
    }),
  );

  /** DANGER — fresh-start reset for a new public phase. Wipes every player
   *  profile (XP, levels, balances, stats), all sessions, all chat logs, and
   *  the jackpot (pool, history, lifetime). Coins, match history, and the
   *  calendar are KEPT. Safe while live: bots re-seed their profiles on their
   *  next action, and Privy-authed players get a fresh account automatically
   *  on their next page load (the token exchange re-runs). */
  app.post(
    "/api/admin/reset-players",
    admin,
    wrap((_req, res) => {
      const cleared = {
        users: store.users.size,
        chatRooms: store.chat.size,
        jackpotPool: store.jackpotPool,
      };
      store.users.clear();
      store.sessions.clear();
      store.nonces.clear();
      store.chat.clear();
      store.jackpotPool = 0;
      store.jackpotHistory = [];
      store.jackpotLifetimeEth = 0;
      store.jackpotWeekKey = weekKey();
      store.logAdmin(
        "reset-players",
        `fresh start: ${cleared.users} users, ${cleared.chatRooms} chat rooms, ` +
          `${cleared.jackpotPool.toFixed(4)} jackpot pool cleared`,
      );
      res.json({ ok: true, cleared });
    }),
  );

  app.post(
    "/api/admin/concepts/:id/shortlist",
    admin,
    wrap((req, res) => {
      const concept = store.concepts.get(req.params.id!);
      if (!concept) throw new Err(404, "concept not found");
      concept.status = "shortlisted";
      store.logAdmin("shortlist", `concept ${concept.id} (${concept.symbol})`);
      res.json(concept);
    }),
  );

  app.post(
    "/api/admin/concepts/:id/schedule",
    admin,
    wrap((req, res) => {
      // CHAIN_ONLY deployments (the dev/staging stack) never run paper
      // simulation rounds — every launch goes through the factory.
      if (process.env.CHAIN_ONLY === "1")
        throw new Err(403, "this deployment is chain-only: use schedule-chain");
      const concept = store.concepts.get(req.params.id!);
      if (!concept) throw new Err(404, "concept not found");
      const { tier = "rookie", inSeconds = 30, config } = req.body as {
        tier?: RiskTier;
        inSeconds?: number;
        config?: Record<string, number>;
      };
      const round = engine.scheduleRound(concept, tier, Date.now() + Number(inSeconds) * 1000);
      if (config) Object.assign(round.config, config);
      store.logAdmin("schedule", `round ${round.id} (${concept.symbol}, ${tier})`);
      res.json(round);
    }),
  );

  /** Phase 2: schedule a REAL on-chain round through the deployed factory.
   *  Requires the chain service (CHAIN_RPC/CHAIN_ID/CHAIN_FACTORY/
   *  CHAIN_OPERATOR_KEY env). Players trade from their own wallets. */
  app.post(
    "/api/admin/concepts/:id/schedule-chain",
    admin,
    wrap(async (req, res) => {
      if (!chain?.enabled) throw new Err(503, "chain service is not configured");
      const concept = store.concepts.get(req.params.id!);
      if (!concept) throw new Err(404, "concept not found");
      const { tier = "rookie", inSeconds = 30, config } = req.body as {
        tier?: RiskTier;
        inSeconds?: number;
        config?: Record<string, number>;
      };
      const round = await chain.scheduleChainRound(
        concept,
        tier,
        Date.now() + Number(inSeconds) * 1000,
        config,
      );
      store.logAdmin(
        "schedule-chain",
        `round ${round.id} (${concept.symbol}, ${tier}) → pool ${round.chain!.pool} on chain ${round.chain!.chainId}`,
      );
      res.json(round);
    }),
  );

  app.post(
    "/api/admin/rounds/:id/pause",
    admin,
    wrap((req, res) => {
      // Emergency pause is rate-limited and logged (spec §13) — it must not
      // be usable selectively to protect the house.
      const recent = store.adminLog.filter(
        (e) => e.action === "pause" && Date.now() - e.at < PAUSE_WINDOW_MS,
      );
      if (recent.length >= PAUSE_LIMIT)
        throw new Err(429, `pause rate limit: ${PAUSE_LIMIT} per hour`);
      engine.setPaused(req.params.id!, true, Date.now());
      store.logAdmin("pause", `round ${req.params.id}`);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/rounds/:id/resume",
    admin,
    wrap((req, res) => {
      engine.setPaused(req.params.id!, false, Date.now());
      store.logAdmin("resume", `round ${req.params.id}`);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/rounds/:id/end",
    admin,
    wrap((req, res) => {
      const round = store.rounds.get(req.params.id!);
      if (!round) throw new Err(404, "round not found");
      engine.endRound(round, "admin", Date.now());
      store.logAdmin("end", `round ${round.id}`);
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/admin/rounds/:id/rug",
    admin,
    wrap((req, res) => {
      engine.simulateLiquidityPull(req.params.id!, Date.now());
      store.logAdmin("simulate_rug", `round ${req.params.id} (paper-mode test tool)`);
      res.json({ ok: true });
    }),
  );

  // ---- chat moderation (spec §9) — every action is audit-logged ----
  app.post(
    "/api/admin/users/:address/mute",
    admin,
    wrap((req, res) => {
      const address = req.params.address!.toLowerCase();
      // Up to 100 years — a "ban" is just a mute that outlives us all.
      const minutes = Math.min(
        100 * 365 * 24 * 60,
        Math.max(1, Number((req.body as { minutes?: number }).minutes ?? 15)),
      );
      store.muted.set(address, Date.now() + minutes * 60_000);
      const label = minutes >= 365 * 24 * 60 ? "BANNED" : `for ${minutes}m`;
      store.logAdmin("mute", `${address} ${label}`);
      res.json({ ok: true, until: store.muted.get(address) });
    }),
  );

  /** Every wallet with a rug-ban record — active bans first, then by most
   *  recent. Feeds the admin "Rug Bans" panel with one-click unban. */
  app.get(
    "/api/admin/banned",
    admin,
    wrap((_req, res) => {
      const rows = [...store.users.values()]
        .filter((u) => u.rugBans?.length)
        .map((u) => ({
          address: u.address,
          displayName: u.displayName,
          level: u.level,
          creatorReputation: u.creatorReputation,
          bans: u.rugBans!,
          active: !!activeRugBan(u),
        }))
        .sort(
          (a, b) =>
            Number(b.active) - Number(a.active) ||
            (b.bans[b.bans.length - 1]?.at ?? 0) - (a.bans[a.bans.length - 1]?.at ?? 0),
        );
      res.json({
        selfServeUnban: store.settings.selfServeUnban,
        rugBanHours: store.settings.rugBanHours,
        banned: rows,
      });
    }),
  );

  /** Lift a wallet's active rug ban (the record stays, marked "admin"). */
  app.post(
    "/api/admin/users/:address/unban",
    admin,
    wrap((req, res) => {
      const u = store.users.get(req.params.address!.toLowerCase());
      if (!u) throw new Err(404, "user not found");
      const ban = activeRugBan(u);
      if (!ban) throw new Err(400, "no active rug ban on this wallet");
      ban.liftedAt = Date.now();
      ban.liftedBy = "admin";
      store.logAdmin("unban", `${u.address} rug ban lifted by admin (offense #${ban.offense})`);
      res.json({ ok: true });
    }),
  );

  // Creator vetting override: clears a rug flag (negative reputation) so the
  // wallet can submit again. Logged like every admin action.
  app.post(
    "/api/admin/users/:address/clear-flags",
    admin,
    wrap((req, res) => {
      const u = store.users.get(req.params.address!.toLowerCase());
      if (!u) throw new Err(404, "user not found");
      const before = u.creatorReputation;
      if (u.creatorReputation < 0) u.creatorReputation = 0;
      store.logAdmin("clear_flags", `${u.address} reputation ${before} → ${u.creatorReputation}`);
      res.json({ ok: true, creatorReputation: u.creatorReputation });
    }),
  );

  app.post(
    "/api/admin/users/:address/unmute",
    admin,
    wrap((req, res) => {
      store.muted.delete(req.params.address!.toLowerCase());
      store.logAdmin("unmute", req.params.address!);
      res.json({ ok: true });
    }),
  );

  app.delete(
    "/api/admin/chat/:roundId/:messageId",
    admin,
    wrap((req, res) => {
      const list = store.chat.get(req.params.roundId!);
      const idx = list?.findIndex((m) => m.id === req.params.messageId) ?? -1;
      if (!list || idx === -1) throw new Err(404, "message not found");
      const [removed] = list.splice(idx, 1);
      broadcast(req.params.roundId!, {
        type: "chat_delete",
        roundId: req.params.roundId!,
        messageId: req.params.messageId!,
      });
      store.logAdmin("chat_delete", `${removed!.userAddress}: "${removed!.text.slice(0, 60)}"`);
      res.json({ ok: true });
    }),
  );

  /** Censor: the message stays in the log but its text is redacted — softer
   *  than deletion when the conversation around it should keep its shape. */
  app.post(
    "/api/admin/chat/:roundId/:messageId/censor",
    admin,
    wrap((req, res) => {
      const list = store.chat.get(req.params.roundId!);
      const msg = list?.find((m) => m.id === req.params.messageId);
      if (!msg) throw new Err(404, "message not found");
      const original = msg.text;
      msg.text = "‹ removed by a moderator ›";
      broadcast(req.params.roundId!, { type: "chat_update", message: msg });
      store.logAdmin("chat_censor", `${msg.userAddress}: "${original.slice(0, 60)}"`);
      res.json({ ok: true });
    }),
  );

  // ---- The Flame Goon Squad Collection ----
  const collection = new CollectionService(store);

  /** The catalogue plus, when signed in, what the caller owns. Missing cards
   *  are still listed — silhouettes are the point, so a player always knows
   *  something exists without knowing what it is. */
  app.get(
    "/api/collection",
    // Optional: the catalogue is public, but a signed-in caller also gets their
    // roster, progress and Burger balance. Without this the route always looked
    // signed-out — which is why the crate page showed 0 Burgers.
    maybeAuth,
    wrap((req, res) => {
      const address = req.userAddress;
      const owned = address ? collection.collectionOf(address).owned : {};
      res.json({
        enabled: store.settings.collection.enabled,
        cards: collection.catalogue().map((c) => {
          const own = owned[c.id];
          // An uncollected card reveals its number, rarity and set membership
          // and nothing else. That's the silhouette.
          if (!own)
            return {
              id: c.id,
              cardNumber: c.cardNumber,
              rarity: c.rarity,
              sets: c.sets,
              releaseSeason: c.releaseSeason,
              owned: false,
            };
          return { ...c, owned: true, quantity: own.quantity, acquiredAt: own.firstAcquiredAt };
        }),
        packs: store.settings.collection.packs,
        progress: address ? collection.progress(address) : null,
        sets: address ? collection.setProgress(address) : collection.sets().map((set) => ({ set })),
        burgerBalance: address ? (store.getOrCreateUser(address).burgerBalance ?? 0) : 0,
      });
    }),
  );

  /** Another player's collection, for the public profile's Collection tab. */
  app.get(
    "/api/collection/:address",
    wrap((req, res) => {
      const address = req.params.address!.toLowerCase();
      if (!store.users.has(address)) throw new Err(404, "player not found");
      const owned = collection.collectionOf(address).owned;
      res.json({
        progress: collection.progress(address),
        sets: collection.setProgress(address),
        cards: collection
          .catalogue()
          .filter((c) => owned[c.id])
          .map((c) => ({ ...c, quantity: owned[c.id]!.quantity, acquiredAt: owned[c.id]!.firstAcquiredAt }))
          .sort((a, b) => b.acquiredAt - a.acquiredAt),
      });
    }),
  );

  /** Buy and open a Recruit Crate pack. The server decides every pull. */
  app.post(
    "/api/collection/open",
    auth,
    rateLimit("crate_open", 30, 60_000),
    wrap((req, res) => {
      if (!store.flag("loot_boxes")) throw new Err(503, "Recruit Crates are closed right now");
      const { pack } = req.body as { pack?: string };
      try {
        res.json(collection.openPack(req.userAddress!, String(pack ?? "x1")));
      } catch (e) {
        if (e instanceof CollectionError) throw new Err(e.status, e.message);
        throw e;
      }
    }),
  );

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  /** Feature flags, resolved. Public and unauthenticated on purpose: the player
   *  client needs them on every load to know which modes are switched on. */
  app.get("/api/flags", (_req, res) => res.json({ flags: store.flags() }));

  // Media Library files, served read-only from disk. Public by design: these
  // are logos, theme art and sounds the player client has to fetch. The
  // filename is validated inside pathFor, which is what stops a crafted name
  // from walking out of the media directory.
  const media = new MediaService(store);
  const pruned = media.reconcile();
  if (pruned.length) console.log(`media: pruned ${pruned.length} asset(s) with no file on disk`);
  app.get("/media/:filename", (req, res) => {
    const path = media.pathFor(String(req.params.filename));
    if (!path) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const asset = [...store.media.values()].find((a) => a.filename === req.params.filename);
    res.setHeader("content-type", asset?.mime ?? "application/octet-stream");
    // Content is immutable per filename (a replace mints a new one), so it can
    // be cached hard — that's the whole point of storing by id.
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.send(readAsset(path));
  });

  /** Presentation the player client needs on every load: branding, the live
   *  theme (if any) and sound overrides. Public and unauthenticated. */
  app.get("/api/presentation", (_req, res) => {
    res.json({
      branding: store.settings.branding,
      theme: activeTheme(store.settings.themes),
      audio: store.settings.audio,
      copy: store.copyMap(),
    });
  });

  // The Command Center — the internal ops platform. Mounted last so its
  // /api/cc/* namespace can't shadow any player route.
  mountCommandCenter(app, store, adminKey, media, pitBoss, broadcast);

  return app;
}

/**
 * Wallet isolation: profiles are public per spec §11 (history, PnL, stats,
 * achievements, level), but session-internal fields — paper balance, referral
 * code/earnings, who referred you — are only ever returned to the wallet that
 * owns them (`self`). Positions, intents, missions, and cosmetics-equip are
 * separately auth-scoped per session token.
 */
/** A concept for the client, tagged with whether its coin has graduated (which
 *  limits editing to socials only). */
function pubConcept(store: Store, c: TokenConcept) {
  const graduated = [...store.rounds.values()].some((r) => r.conceptId === c.id && r.graduated);
  return { ...c, graduated };
}

function sanitizeImageUrl(value: unknown): string | undefined {
  const s = String(value ?? "");
  if (!s) return undefined;
  if (/^https?:\/\//.test(s) && s.length <= 500) return s;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= 800_000)
    return s;
  throw new Err(400, "image must be an https URL or a small png/jpg/webp/gif upload");
}

/** Coin socials: keep the raw handle or URL the creator entered (the client
 *  normalizes each to a full link), trimmed and length-capped, with any embedded
 *  markup stripped. Returns undefined when nothing usable was provided. */
/**
 * The creator's post-graduation fee destination.
 *
 * Validated hard on the way in, because this address is burned into an
 * immutable FeeSplitter at graduation: nobody — not the creator, not an
 * admin — can correct it afterwards, and fees sent to a wrong address are
 * gone permanently. Absent means "my own wallet", resolved at graduation.
 */
export function feeDestinationOf(value: unknown): Address | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = String(value).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) throw new Err(400, "fee destination must be a 0x address");
  if (/^0x0{40}$/i.test(raw)) throw new Err(400, "fee destination can't be the zero address");
  return raw.toLowerCase() as Address;
}

function sanitizeSocials(value: unknown): CoinSocials | undefined {
  if (!value || typeof value !== "object") return undefined;
  const src = value as Record<string, unknown>;
  const clean = (v: unknown) =>
    String(v ?? "")
      .replace(/[<>"'\s]/g, "")
      .slice(0, 200);
  const out: CoinSocials = {};
  for (const key of ["x", "telegram", "youtube", "instagram", "website"] as const) {
    const v = clean(src[key]);
    if (v) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Mode modifiers a creator chose at launch. Only the ones set are kept. */
function sanitizeModifiers(value: unknown): CoinModifiers | undefined {
  if (!value || typeof value !== "object") return undefined;
  const src = value as Record<string, unknown>;
  const out: CoinModifiers = {};
  if (src.overtime === true) out.overtime = true;
  return Object.keys(out).length ? out : undefined;
}

const GOON_CATEGORIES = [
  "ambient", "greeting", "prediction", "bigBuy", "bigSell", "upset",
  "finalMinute", "leaderChange", "matchCreated", "winner", "rug", "sarcastic",
];

/** Coerce an admin-supplied dialogue-pools object into clean weighted lines. */
function sanitizeGoonPools(pools: unknown): import("@cookout/shared").GoonPersona["pools"] {
  const out: Record<string, { text: string; weight?: number }[]> = {};
  if (!pools || typeof pools !== "object") return {};
  for (const [k, v] of Object.entries(pools as Record<string, unknown>)) {
    if (!GOON_CATEGORIES.includes(k) || !Array.isArray(v)) continue;
    const lines = v
      .map((l) => {
        if (typeof l === "string") return { text: l.slice(0, 200) };
        if (l && typeof l === "object") {
          const rec = l as { text?: unknown; weight?: unknown };
          const text = String(rec.text ?? "").slice(0, 200);
          return Number.isFinite(Number(rec.weight))
            ? { text, weight: Math.max(0, Number(rec.weight)) }
            : { text };
        }
        return { text: "" };
      })
      .filter((l) => l.text.length > 0)
      .slice(0, 40);
    if (lines.length) out[k] = lines;
  }
  return out as import("@cookout/shared").GoonPersona["pools"];
}

function publicProfile(u: StoredUser, self = false) {
  const {
    seasons,
    weeklyXp,
    activity,
    missionsDone,
    history,
    paperBalance,
    arenaBalance,
    referralCode,
    referredBy,
    referralCount,
    referralEarnings,
    arenaAddress,
    ledger,
    ...rest
  } = u;
  void activity;
  void missionsDone;
  void weeklyXp; // internal jackpot ranking state, not public
  void history; // served via /api/profile/:address/history
  void ledger; // private balance movements — served via /api/me/ledger
  // rest still carries jackpotWinnings + jackpotWins — shown on profiles.
  const d = new Date();
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const base = {
    ...rest,
    season: seasons[key] ?? { pnl: 0, xp: 0, wins: 0, trades: 0 },
    // Reputation is public by design: the ban and its history (rest carries
    // rugBans) show on the public profile just like the owner's.
    banned: !!activeRugBan(u),
  };
  if (!self) return base;
  return {
    ...base,
    paperBalance,
    arenaBalance: arenaBalance ?? 0,
    burgerBalance: u.burgerBalance ?? 0,
    referralCode,
    referredBy,
    referralCount,
    referralEarnings,
    arenaAddress,
  };
}
