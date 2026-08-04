/**
 * Command Center staff authentication and authorization.
 *
 * The player-facing site is wallet-only (see auth.ts) — that stays exactly as
 * it is. Staff are a separate identity space on purpose: an operator signing
 * into the ops platform should not depend on holding a particular wallet in a
 * particular browser, and the roles here have nothing to do with a player
 * account. The two never mix; a staff session grants no player privileges and
 * a player session grants no Command Center access.
 *
 * Security model:
 *  - passwords are scrypt-hashed with a per-account random salt, compared in
 *    constant time, and never leave the server in any form;
 *  - sessions are opaque 32-byte tokens with an idle timeout and a hard expiry;
 *  - optional TOTP second factor (RFC 6238, 30s step, ±1 window for clock drift);
 *  - failed logins are counted per account and per IP, with a lockout;
 *  - authorization is checked server-side on every request, from the stored
 *    account — never from anything the client sends.
 */
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
  ROLE_MAP,
  effectivePermissions,
  type AuditEntry,
  type CcModule,
  type Permission,
  type StaffAccount,
  type StaffRole,
} from "@cookout/shared";
import type { Store } from "./store.js";

/** Server-side staff record. The hash and TOTP secret stay in this file's world. */
export interface StoredStaff extends StaffAccount {
  /** scrypt: `salt:derivedKey`, both hex. */
  passwordHash: string;
  /** Base32 TOTP secret. Present only once 2FA has been confirmed. */
  totpSecret?: string;
  /** Consecutive failed sign-ins; cleared on success. */
  failedLogins: number;
  /** Locked out until this epoch ms, if currently locked. */
  lockedUntil?: number;
  /** Forces a password change on next sign-in (set when an admin resets one). */
  mustChangePassword?: boolean;
}

export interface StaffSession {
  token: string;
  staffId: string;
  createdAt: number;
  lastSeenAt: number;
  /** Hard expiry — a session cannot be refreshed past this. */
  expiresAt: number;
  ip?: string;
  userAgent?: string;
}

/** Idle timeout: a session dies after this long with no requests. */
export const STAFF_IDLE_MS = 60 * 60 * 1000; // 1 hour
/** Absolute lifetime, refresh or not. */
export const STAFF_SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours
/** Failed sign-ins before an account locks. */
export const STAFF_LOCK_THRESHOLD = 5;
/** How long an account stays locked. */
export const STAFF_LOCK_MS = 15 * 60 * 1000;

// ------------------------------------------------------------------ passwords

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const key = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${key}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const expected = Buffer.from(key, "hex");
  const actual = scryptSync(password, salt, expected.length);
  // Length is fixed by the stored hash, so this is a genuine constant-time
  // compare rather than a length oracle.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Minimum bar for a staff password. Deliberately about length, not symbols. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "password must be at least 12 characters";
  if (password.length > 200) return "password is too long";
  if (/^\s|\s$/.test(password)) return "password can't start or end with a space";
  return null;
}

// ----------------------------------------------------------------- TOTP (2FA)

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP for a 30-second step, 6 digits. */
export function totpCode(secret: string, at = Date.now(), stepSec = 30): string {
  const counter = Math.floor(at / 1000 / stepSec);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const bin =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Accept the current step ±1, so a slightly-off clock still authenticates. */
export function totpValid(secret: string, code: string, at = Date.now()): boolean {
  const given = code.replace(/\D/g, "");
  if (given.length !== 6) return false;
  for (const drift of [-1, 0, 1]) {
    const expected = totpCode(secret, at + drift * 30_000);
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** The otpauth:// URI an authenticator app scans. */
export function totpUri(username: string, secret: string): string {
  const label = encodeURIComponent(`The Cookout:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent("The Cookout")}&period=30&digits=6`;
}

// -------------------------------------------------------------------- service

export class StaffService {
  constructor(private store: Store) {}

  /** Public (hash-free) view of an account. */
  static toPublic(s: StoredStaff): StaffAccount {
    const {
      passwordHash: _p,
      totpSecret: _t,
      failedLogins: _f,
      lockedUntil: _l,
      mustChangePassword: _m,
      ...rest
    } = s;
    return rest;
  }

  list(): StoredStaff[] {
    return [...this.store.staff.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  byId(id: string): StoredStaff | undefined {
    return this.store.staff.get(id);
  }

  byUsername(username: string): StoredStaff | undefined {
    const key = username.trim().toLowerCase();
    return this.list().find((s) => s.username.toLowerCase() === key);
  }

  /** Is there an owner yet? Drives first-run bootstrap. */
  hasOwner(): boolean {
    return this.list().some((s) => s.role === "owner" && !s.disabled);
  }

  create(input: {
    username: string;
    password: string;
    role: StaffRole;
    displayName?: string;
    walletAddress?: string;
    extraPermissions?: Permission[];
    deniedPermissions?: Permission[];
    createdBy?: string;
  }): StoredStaff {
    const username = input.username.trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username))
      throw new Error("username must be 3–32 characters: letters, numbers, dot, dash, underscore");
    if (this.byUsername(username)) throw new Error("that username is taken");
    const problem = passwordProblem(input.password);
    if (problem) throw new Error(problem);
    if (!ROLE_MAP[input.role]) throw new Error("unknown role");

    const account: StoredStaff = {
      id: randomUUID(),
      username,
      displayName: input.displayName?.trim() || undefined,
      role: input.role,
      extraPermissions: input.extraPermissions ?? [],
      deniedPermissions: input.deniedPermissions ?? [],
      twoFactorEnabled: false,
      disabled: false,
      createdAt: Date.now(),
      createdBy: input.createdBy,
      walletAddress: input.walletAddress?.toLowerCase(),
      passwordHash: hashPassword(input.password),
      failedLogins: 0,
    };
    this.store.staff.set(account.id, account);
    return account;
  }

  /**
   * Sign in. Returns a session token, or a reason it failed. The failure
   * reasons deliberately don't distinguish "no such user" from "wrong
   * password" to the caller — see the route.
   */
  login(
    username: string,
    password: string,
    totp: string | undefined,
    ctx: { ip?: string; userAgent?: string; now?: number },
  ):
    | { ok: true; session: StaffSession; account: StoredStaff }
    | { ok: false; reason: "bad_credentials" | "locked" | "disabled" | "totp_required" | "totp_invalid" } {
    const now = ctx.now ?? Date.now();
    const account = this.byUsername(username);
    if (!account) {
      // Spend comparable time on an unknown user so the response time doesn't
      // reveal whether the account exists.
      hashPassword(password);
      return { ok: false, reason: "bad_credentials" };
    }
    if (account.lockedUntil && now < account.lockedUntil) return { ok: false, reason: "locked" };
    if (account.disabled) return { ok: false, reason: "disabled" };

    if (!verifyPassword(password, account.passwordHash)) {
      account.failedLogins += 1;
      if (account.failedLogins >= STAFF_LOCK_THRESHOLD) {
        account.lockedUntil = now + STAFF_LOCK_MS;
        account.failedLogins = 0;
      }
      return { ok: false, reason: "bad_credentials" };
    }

    if (account.twoFactorEnabled && account.totpSecret) {
      if (!totp) return { ok: false, reason: "totp_required" };
      if (!totpValid(account.totpSecret, totp, now)) {
        account.failedLogins += 1;
        if (account.failedLogins >= STAFF_LOCK_THRESHOLD) {
          account.lockedUntil = now + STAFF_LOCK_MS;
          account.failedLogins = 0;
        }
        return { ok: false, reason: "totp_invalid" };
      }
    }

    account.failedLogins = 0;
    account.lockedUntil = undefined;
    account.lastLoginAt = now;
    account.lastLoginIp = ctx.ip;

    const session: StaffSession = {
      token: randomBytes(32).toString("hex"),
      staffId: account.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + STAFF_SESSION_MS,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    };
    this.store.staffSessions.set(session.token, session);
    return { ok: true, session, account };
  }

  /** Resolve a bearer token to a live session + account, refreshing idle time. */
  resolve(token: string, now = Date.now()): { session: StaffSession; account: StoredStaff } | null {
    const session = this.store.staffSessions.get(token);
    if (!session) return null;
    if (now > session.expiresAt || now - session.lastSeenAt > STAFF_IDLE_MS) {
      this.store.staffSessions.delete(token);
      return null;
    }
    const account = this.store.staff.get(session.staffId);
    if (!account || account.disabled) {
      this.store.staffSessions.delete(token);
      return null;
    }
    session.lastSeenAt = now;
    return { session, account };
  }

  logout(token: string): void {
    this.store.staffSessions.delete(token);
  }

  /** Drop every session for an account — used on disable, role change, or reset. */
  revokeAll(staffId: string): number {
    let n = 0;
    for (const [token, s] of this.store.staffSessions) {
      if (s.staffId === staffId) {
        this.store.staffSessions.delete(token);
        n++;
      }
    }
    return n;
  }

  /** Sweep dead sessions. Called from the engine tick. */
  sweep(now = Date.now()): void {
    for (const [token, s] of this.store.staffSessions) {
      if (now > s.expiresAt || now - s.lastSeenAt > STAFF_IDLE_MS) this.store.staffSessions.delete(token);
    }
  }

  /**
   * May `actor` act on `target`? An Owner is untouchable by anyone who isn't an
   * Owner — that is the rule that keeps an Administrator from promoting
   * themselves or locking the Owner out.
   */
  canManageAccount(actor: StoredStaff, target: StoredStaff): boolean {
    if (actor.id === target.id) return true; // your own profile
    if (target.role === "owner" && actor.role !== "owner") return false;
    return ROLE_MAP[actor.role]?.canManage.includes(target.role) ?? false;
  }

  /** May `actor` hand out `role`? Same rule, for creation and promotion. */
  canAssignRole(actor: StoredStaff, role: StaffRole): boolean {
    return ROLE_MAP[actor.role]?.canManage.includes(role) ?? false;
  }
}

// ----------------------------------------------------------------- middleware

export interface StaffRequest extends Request {
  staff?: StoredStaff;
  staffSession?: StaffSession;
  staffPermissions?: Permission[];
  /** True when the legacy shared ADMIN_KEY was used instead of an account. */
  staffViaKey?: boolean;
}

/** The client IP, honouring a single proxy hop (the Cloudflare tunnel). */
export function clientIp(req: Request): string | undefined {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0];
  return (first ?? req.socket.remoteAddress ?? undefined)?.trim();
}

/**
 * Gate a Command Center route. Requires a live staff session (or the legacy
 * shared admin key, kept as break-glass so the platform is never locked out)
 * and, when given, the named permission.
 *
 * Authorization is read from the stored account on every request, so revoking
 * a permission takes effect immediately rather than at next sign-in.
 */
export function requireStaff(
  staffService: StaffService,
  adminKey: string,
  permission?: Permission,
) {
  const expectedKey = Buffer.from(adminKey);
  return (req: StaffRequest, res: Response, next: NextFunction) => {
    const header = String(req.headers.authorization ?? "");
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    // A Bearer token here may well be a *player* session — the legacy admin
    // routes are called from pages that also carry one. So a token that isn't a
    // staff session is not an error; it just isn't the credential we want, and
    // we fall through to the admin key rather than rejecting outright.
    if (token) {
      const resolved = staffService.resolve(token);
      if (resolved) {
        const perms = effectivePermissions(resolved.account);
        if (permission && !perms.includes(permission)) {
          res.status(403).json({ error: `this account lacks the "${permission}" permission` });
          return;
        }
        req.staff = resolved.account;
        req.staffSession = resolved.session;
        req.staffPermissions = perms;
        next();
        return;
      }
    }

    // Break-glass: the shared ADMIN_KEY still works and behaves as an Owner, so
    // an operator can always get in to repair a broken team configuration. Its
    // use is audited under a distinct actor id.
    const given = Buffer.from(String(req.headers["x-admin-key"] ?? ""));
    if (
      adminKey &&
      given.length === expectedKey.length &&
      timingSafeEqual(given, expectedKey)
    ) {
      req.staffViaKey = true;
      req.staffPermissions = effectivePermissions({ role: "owner" });
      next();
      return;
    }

    res.status(401).json({ error: "Command Center sign-in required" });
  };
}

// ------------------------------------------------------------------- auditing

/** Describe whoever is making the request, for the audit log. */
export function actorOf(req: StaffRequest): Pick<AuditEntry, "actorId" | "actorName" | "actorRole"> {
  if (req.staff)
    return {
      actorId: req.staff.id,
      actorName: req.staff.displayName ?? req.staff.username,
      actorRole: req.staff.role,
    };
  if (req.staffViaKey) return { actorId: "admin-key", actorName: "Shared admin key", actorRole: "owner" };
  return { actorId: "system", actorName: "System" };
}

/** Write one audit entry. Every Command Center mutation goes through here. */
export function audit(
  store: Store,
  req: StaffRequest,
  entry: {
    module: CcModule | "auth" | "system";
    action: string;
    target?: string;
    before?: unknown;
    after?: unknown;
    note?: string;
  },
): void {
  store.recordAudit({
    id: randomUUID(),
    at: Date.now(),
    ...actorOf(req),
    ip: clientIp(req),
    ...entry,
  });
}
