import express, { type Express, type Request, type Response } from "express";
import {
  COSMETICS,
  MAX_TOKEN_SUPPLY,
  MIN_TOKEN_SUPPLY,
  TIER_UNLOCK_LEVEL,
  unlockedCosmetics,
  type CosmeticType,
  type RiskTier,
  type TokenConcept,
} from "@cookout/shared";
import {
  issueNonce,
  nonceMessage,
  requireAdmin,
  requireAuth,
  verifyAndCreateSession,
  type AuthedRequest,
} from "./auth.js";
import { Err, type Broadcast, type RoundEngine } from "./engine.js";
import { rateLimit } from "./ratelimit.js";
import type { Store, StoredUser } from "./store.js";
import { spotPrice } from "@cookout/shared";

const PAUSE_LIMIT = 3;
const PAUSE_WINDOW_MS = 60 * 60 * 1000;

export function createApp(
  store: Store,
  engine: RoundEngine,
  adminKey: string,
  broadcast: Broadcast = () => {},
): Express {
  const app = express();
  // Body limit covers client-downscaled data-URL images (coin art, avatars).
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    // Set CORS_ORIGIN to your web origin in production (e.g. https://cookout.vercel.app).
    res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN ?? "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  const auth = requireAuth(store);
  const admin = requireAdmin(adminKey);

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
      const nonce = issueNonce(store, address);
      res.json({ nonce, message: nonceMessage(address, nonce) });
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

  app.get(
    "/api/me",
    auth,
    wrap((req, res) => res.json(publicProfile(store.getOrCreateUser(req.userAddress!), true))),
  );

  app.patch(
    "/api/me",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      const { displayName, avatarUrl } = req.body as { displayName?: string; avatarUrl?: string };
      if (displayName !== undefined) u.displayName = String(displayName).slice(0, 24);
      if (avatarUrl !== undefined) u.avatarUrl = sanitizeImageUrl(avatarUrl);
      res.json(publicProfile(u, true));
    }),
  );

  app.get(
    "/api/missions",
    auth,
    wrap((req, res) => res.json(store.missionStatus(req.userAddress!))),
  );

  app.get(
    "/api/me/cosmetics",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      res.json({ unlocked: unlockedCosmetics(u), equipped: u.equipped, all: COSMETICS });
    }),
  );

  app.patch(
    "/api/me/cosmetics",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      const unlockedIds = new Set(unlockedCosmetics(u).map((c) => c.id));
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
      const u = store.users.get(req.params.address!.toLowerCase());
      if (!u) throw new Err(404, "profile not found");
      res.json(publicProfile(u));
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
      const rounds = [...store.rounds.values()]
        .filter((r) => r.creatorAddress === address && (r.state === "results" || r.state === "live"))
        .sort((a, b) => b.scheduledAt - a.scheduledAt)
        .map((r) => ({
          round: r,
          summary: store.summaries.get(r.id) ?? null,
        }));
      const launched = rounds.filter((r) => r.round.state === "results");
      const totalVotes = concepts.reduce((s, c) => s + c.votes, 0);
      res.json({
        address,
        displayName: u.displayName,
        level: u.level,
        title: u.title,
        creatorReputation: u.creatorReputation,
        feesEarned: u.feesEarned,
        concepts,
        rounds,
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
      const { autoSchedule, tier, leadSeconds } = req.body as {
        autoSchedule?: boolean;
        tier?: RiskTier;
        leadSeconds?: number;
      };
      if (autoSchedule !== undefined) store.settings.autoSchedule = !!autoSchedule;
      if (tier && ["rookie", "standard", "degen"].includes(tier)) store.settings.tier = tier;
      if (leadSeconds !== undefined)
        store.settings.leadSeconds = Math.max(5, Math.min(3600, Number(leadSeconds) || 15));
      store.logAdmin("settings", JSON.stringify(store.settings));
      res.json(store.settings);
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
        approved: true, // beta period gating is flipped via BETA_WHITELIST env
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
    wrap((_req, res) =>
      res.json([...store.betaSignups.values()].sort((a, b) => a.at - b.at)),
    ),
  );

  // ---- creator submissions & community voting ----
  app.post(
    "/api/concepts",
    auth,
    wrap((req, res) => {
      const { name, symbol, theme, pitch, artworkUrl } = req.body as Record<string, string>;
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
      // Creator vetting (spec §5.2): cooldown + rug-flag screen, audit-trailed.
      const flagged = creator.creatorReputation < 0;
      const recent = [...store.concepts.values()].filter(
        (c) => c.creatorAddress === creator.address && Date.now() - c.createdAt < 60 * 60 * 1000,
      );
      if (flagged) throw new Err(403, "creator wallet is flagged from a prior rug");
      if (recent.length >= 3) throw new Err(429, "creator cooldown: max 3 submissions per hour");
      const concept: TokenConcept = {
        id: store.id(),
        creatorAddress: creator.address,
        name: String(name).slice(0, 48),
        symbol: String(symbol).toUpperCase().slice(0, 8),
        theme: String(theme).slice(0, 140),
        pitch: pitch ? String(pitch).slice(0, 1000) : undefined,
        artworkUrl: artworkUrl ? sanitizeImageUrl(artworkUrl) : undefined,
        totalSupply,
        status: "submitted",
        votes: 0,
        createdAt: Date.now(),
      };
      store.concepts.set(concept.id, concept);
      store.logAdmin(
        "vetting",
        `concept ${concept.id} (${concept.symbol}) accepted: template-only deploy, rug-flag check passed, cooldown ok`,
      );
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
      res.json(list);
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
      });
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
      res.json({
        position: pos,
        intents,
        balance: store.getOrCreateUser(req.userAddress!).paperBalance,
        prediction: store.predictions.get(round.id)?.get(req.userAddress!)?.call ?? null,
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
      res.json({ trade, balance: user.paperBalance, position: pos });
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
            const slice = u.history.filter((h) => h.at >= windowStart);
            value =
              metric === "wins"
                ? slice.filter((h) => h.pnl > 0).length
                : slice.reduce((s, h) => s + h.pnl, 0);
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
        feedbackCount: store.feedback.length,
        settings: store.settings,
        log: store.adminLog.slice(-50),
      });
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
      const minutes = Math.min(24 * 60, Math.max(1, Number((req.body as { minutes?: number }).minutes ?? 15)));
      store.muted.set(address, Date.now() + minutes * 60_000);
      store.logAdmin("mute", `${address} for ${minutes}m`);
      res.json({ ok: true, until: store.muted.get(address) });
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

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  return app;
}

/**
 * Wallet isolation: profiles are public per spec §11 (history, PnL, stats,
 * achievements, level), but session-internal fields — paper balance, referral
 * code/earnings, who referred you — are only ever returned to the wallet that
 * owns them (`self`). Positions, intents, missions, and cosmetics-equip are
 * separately auth-scoped per session token.
 */
function sanitizeImageUrl(value: unknown): string | undefined {
  const s = String(value ?? "");
  if (!s) return undefined;
  if (/^https?:\/\//.test(s) && s.length <= 500) return s;
  if (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= 800_000)
    return s;
  throw new Err(400, "image must be an https URL or a small png/jpg/webp/gif upload");
}

function publicProfile(u: StoredUser, self = false) {
  const {
    seasons,
    activity,
    missionsDone,
    history,
    paperBalance,
    referralCode,
    referredBy,
    referralCount,
    referralEarnings,
    ...rest
  } = u;
  void activity;
  void missionsDone;
  void history; // served via /api/profile/:address/history
  const d = new Date();
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const base = { ...rest, season: seasons[key] ?? { pnl: 0, xp: 0, wins: 0, trades: 0 } };
  if (!self) return base;
  return { ...base, paperBalance, referralCode, referredBy, referralCount, referralEarnings };
}
