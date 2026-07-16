import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { Snapshot } from "./store.js";

const require = createRequire(import.meta.url);

/**
 * Durable storage behind the Store. Live-round state is deliberately
 * ephemeral (it is Redis-shaped and rebuilt each round); what persists is
 * the durable subset: users, concepts, votes, archived rounds, settlements,
 * summaries, and the admin audit log.
 *
 * Two adapters: PostgreSQL when DATABASE_URL is set, otherwise an atomic
 * JSON file snapshot so local dev needs no services.
 */
export interface Persistence {
  load(): Promise<Snapshot | null>;
  save(snapshot: Snapshot): Promise<void>;
  close(): Promise<void>;
}

export class FilePersistence implements Persistence {
  constructor(private path: string) {}

  async load(): Promise<Snapshot | null> {
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Snapshot;
    } catch {
      return null;
    }
  }

  async save(snapshot: Snapshot): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, this.path); // atomic on the same filesystem
  }

  async close(): Promise<void> {}
}

/**
 * JSONB-per-entity PostgreSQL adapter. One row per entity keeps the engine
 * decoupled from a relational schema while giving real durability, upserts,
 * and multi-instance readiness; normalizing hot columns out of JSONB is a
 * follow-up once query patterns settle.
 */
export class PgPersistence implements Persistence {
  private pool: import("pg").Pool;
  private ready: Promise<void>;

  constructor(databaseUrl: string) {
    // Lazy load so the pg dependency is only exercised when configured.
    const { Pool } = require("pg") as typeof import("pg");
    this.pool = new Pool({ connectionString: databaseUrl });
    this.ready = this.migrate();
  }

  private async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (address TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS concepts (id TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS concept_voters (concept_id TEXT PRIMARY KEY, voters JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS rounds_archive (id TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS auction_results (round_id TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS summaries (round_id TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS admin_log (id TEXT PRIMARY KEY, at BIGINT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS beta_signups (address TEXT PRIMARY KEY, data JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS state (id INT PRIMARY KEY, data JSONB NOT NULL);
    `);
  }

  /** Snapshot fields that are singletons (not one-row-per-entity): kept in a
   *  single `state` row so they survive restarts like everything else. */
  private static readonly STATE_KEYS = [
    "candles",
    "sessions",
    "feedback",
    "settings",
    "jackpotPool",
    "jackpotWeekKey",
    "jackpotHistory",
    "jackpotLifetimeEth",
  ] as const;

  async load(): Promise<Snapshot | null> {
    await this.ready;
    const [users, concepts, voters, rounds, auctions, summaries, log, beta, state] =
      await Promise.all([
        this.pool.query("SELECT data FROM users"),
        this.pool.query("SELECT data FROM concepts"),
        this.pool.query("SELECT concept_id, voters FROM concept_voters"),
        this.pool.query("SELECT data FROM rounds_archive"),
        this.pool.query("SELECT data FROM auction_results"),
        this.pool.query("SELECT data FROM summaries"),
        this.pool.query("SELECT id, at, action, detail FROM admin_log ORDER BY at ASC"),
        this.pool.query("SELECT data FROM beta_signups"),
        this.pool.query("SELECT data FROM state WHERE id = 1"),
      ]);
    if (users.rowCount === 0 && concepts.rowCount === 0 && state.rowCount === 0) return null;
    return {
      version: 1,
      users: users.rows.map((r) => r.data),
      concepts: concepts.rows.map((r) => r.data),
      conceptVoters: voters.rows.map((r) => [r.concept_id, r.voters]),
      archivedRounds: rounds.rows.map((r) => r.data),
      auctionResults: auctions.rows.map((r) => r.data),
      summaries: summaries.rows.map((r) => r.data),
      adminLog: log.rows.map((r) => ({ ...r, at: Number(r.at) })),
      betaSignups: beta.rows.map((r) => r.data),
      ...(state.rows[0]?.data ?? {}), // sessions, settings, jackpot*, feedback, candles
    };
  }

  async save(s: Snapshot): Promise<void> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const upsert = async (sql: string, rows: Array<[string, unknown]>) => {
        for (const [key, data] of rows)
          await client.query(sql, [key, JSON.stringify(data)]);
      };
      await upsert(
        "INSERT INTO users (address, data) VALUES ($1, $2) ON CONFLICT (address) DO UPDATE SET data = $2",
        s.users.map((u) => [u.address, u]),
      );
      await upsert(
        "INSERT INTO concepts (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2",
        s.concepts.map((c) => [c.id, c]),
      );
      await upsert(
        "INSERT INTO concept_voters (concept_id, voters) VALUES ($1, $2) ON CONFLICT (concept_id) DO UPDATE SET voters = $2",
        s.conceptVoters.map(([id, v]) => [id, v]),
      );
      await upsert(
        "INSERT INTO rounds_archive (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2",
        s.archivedRounds.map((r) => [r.id, r]),
      );
      await upsert(
        "INSERT INTO auction_results (round_id, data) VALUES ($1, $2) ON CONFLICT (round_id) DO UPDATE SET data = $2",
        s.auctionResults.map((a) => [a.roundId, a]),
      );
      await upsert(
        "INSERT INTO summaries (round_id, data) VALUES ($1, $2) ON CONFLICT (round_id) DO UPDATE SET data = $2",
        s.summaries.map((x) => [x.roundId, x]),
      );
      await upsert(
        "INSERT INTO beta_signups (address, data) VALUES ($1, $2) ON CONFLICT (address) DO UPDATE SET data = $2",
        (s.betaSignups ?? []).map((b) => [b.address, b]),
      );
      // Sync removals: drop rows no longer in the store (admin-removed signups)
      // so a deletion survives restart instead of being reloaded.
      await client.query("DELETE FROM beta_signups WHERE address <> ALL($1::text[])", [
        (s.betaSignups ?? []).map((b) => b.address),
      ]);
      for (const e of s.adminLog)
        await client.query(
          "INSERT INTO admin_log (id, at, action, detail) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
          [e.id, e.at, e.action, e.detail],
        );
      // Singleton state (sessions, settings, jackpot, feedback, candles) in one row.
      const state = Object.fromEntries(
        PgPersistence.STATE_KEYS.map((k) => [k, s[k]]),
      );
      await client.query(
        "INSERT INTO state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = $1",
        [JSON.stringify(state)],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
