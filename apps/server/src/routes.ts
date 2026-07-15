import express, { type Express, type Request, type Response } from "express";
import {
  COSMETICS,
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
import { Err, type RoundEngine } from "./engine.js";
import type { Store, StoredUser } from "./store.js";

const PAUSE_LIMIT = 3;
const PAUSE_WINDOW_MS = 60 * 60 * 1000;

export function createApp(store: Store, engine: RoundEngine, adminKey: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
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
      res.json({ token, profile: publicProfile(store.getOrCreateUser(address)) });
    }),
  );

  app.get(
    "/api/me",
    auth,
    wrap((req, res) => res.json(publicProfile(store.getOrCreateUser(req.userAddress!)))),
  );

  app.patch(
    "/api/me",
    auth,
    wrap((req, res) => {
      const u = store.getOrCreateUser(req.userAddress!);
      const { displayName, avatarUrl } = req.body as { displayName?: string; avatarUrl?: string };
      if (displayName !== undefined) u.displayName = String(displayName).slice(0, 24);
      if (avatarUrl !== undefined) u.avatarUrl = String(avatarUrl).slice(0, 500);
      res.json(publicProfile(u));
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

  // ---- creator submissions & community voting ----
  app.post(
    "/api/concepts",
    auth,
    wrap((req, res) => {
      const { name, symbol, theme, pitch, artworkUrl } = req.body as Record<string, string>;
      if (!name || !symbol || !theme) throw new Err(400, "name, symbol, theme required");
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
        artworkUrl: artworkUrl ? String(artworkUrl).slice(0, 500) : undefined,
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
      res.json({ position: pos, intents, balance: store.getOrCreateUser(req.userAddress!).paperBalance });
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

  // Auditability (spec §6/§13): during the queue only aggregates are visible
  // (no late-information gaming); after settlement the full intent list is
  // public so anyone can recompute the clearing price and audit hash.
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
      res.json({ ok: true, counts: engine.predictionCounts(round.id) });
    }),
  );

  // ---- leaderboards ----
  app.get(
    "/api/leaderboard",
    wrap((req, res) => {
      const scope = (req.query.scope as string) ?? "alltime"; // alltime | season
      const metric = (req.query.metric as string) ?? "pnl"; // pnl | xp | wins
      const season = store.seasonKey();
      const rows = [...store.users.values()]
        .map((u) => {
          const s = scope === "season" ? (u.seasons[season] ?? { pnl: 0, xp: 0, wins: 0, trades: 0 }) : null;
          const value =
            scope === "season"
              ? ((s as unknown as Record<string, number>)?.[metric] ?? 0)
              : metric === "xp"
                ? u.xp
                : metric === "wins"
                  ? u.stats.wins
                  : u.stats.totalPnl;
          return {
            address: u.address,
            displayName: u.displayName,
            level: u.level,
            title: u.title,
            badge: COSMETICS.find((c) => c.id === u.equipped.badge)?.value,
            value,
          };
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

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  return app;
}

function publicProfile(u: StoredUser) {
  const { seasons, activity, missionsDone, ...rest } = u;
  void activity;
  void missionsDone;
  const d = new Date();
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return { ...rest, season: seasons[key] ?? { pnl: 0, xp: 0, wins: 0, trades: 0 } };
}
