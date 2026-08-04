import assert from "node:assert/strict";
import { test } from "node:test";
import { effectivePermissions, hasPermission, resolveFlags, ROLE_MAP } from "@cookout/shared";
import {
  StaffService,
  STAFF_IDLE_MS,
  STAFF_LOCK_THRESHOLD,
  generateTotpSecret,
  requireStaff,
  hashPassword,
  passwordProblem,
  totpCode,
  totpValid,
  verifyPassword,
} from "./staff.js";
import { Store } from "./store.js";

const PW = "correct-horse-battery";

function setup() {
  const store = new Store();
  const staff = new StaffService(store);
  const owner = staff.create({ username: "owner", password: PW, role: "owner" });
  return { store, staff, owner };
}

test("passwords: scrypt hash round-trips and rejects the wrong password", () => {
  const hash = hashPassword(PW);
  assert.ok(!hash.includes(PW), "the password itself is never stored");
  assert.equal(verifyPassword(PW, hash), true);
  assert.equal(verifyPassword(PW + "x", hash), false);
  assert.equal(verifyPassword("", hash), false);
  // Two hashes of the same password differ — the salt is per-account.
  assert.notEqual(hashPassword(PW), hashPassword(PW));
});

test("passwords: the length bar is enforced", () => {
  assert.match(passwordProblem("short") ?? "", /12 characters/);
  assert.equal(passwordProblem(PW), null);
});

test("staff accounts are never serialised with their secrets", () => {
  const { staff, owner } = setup();
  owner.totpSecret = generateTotpSecret();
  const pub = StaffService.toPublic(owner) as Record<string, unknown>;
  assert.equal(pub.passwordHash, undefined);
  assert.equal(pub.totpSecret, undefined);
  assert.equal(pub.username, "owner");
  void staff;
});

test("login: succeeds, issues a session, and resolves back to the account", () => {
  const { staff, store } = setup();
  const result = staff.login("owner", PW, undefined, { ip: "10.0.0.1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(store.staffSessions.size, 1);
  const resolved = staff.resolve(result.session.token);
  assert.equal(resolved?.account.username, "owner");
  assert.equal(resolved?.account.lastLoginIp, "10.0.0.1");
});

test("login: username lookup is case-insensitive, password is not", () => {
  const { staff } = setup();
  assert.equal(staff.login("OWNER", PW, undefined, {}).ok, true);
  assert.equal(staff.login("owner", PW.toUpperCase(), undefined, {}).ok, false);
});

test("login: repeated failures lock the account, and a good password won't open it", () => {
  const { staff, owner } = setup();
  for (let i = 0; i < STAFF_LOCK_THRESHOLD; i++) {
    const r = staff.login("owner", "wrong-password-here", undefined, {});
    assert.equal(r.ok, false);
  }
  assert.ok(owner.lockedUntil && owner.lockedUntil > Date.now(), "the account is locked");
  const blocked = staff.login("owner", PW, undefined, {});
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.reason, "locked");

  // It opens again once the lockout elapses.
  owner.lockedUntil = Date.now() - 1;
  assert.equal(staff.login("owner", PW, undefined, {}).ok, true);
});

test("login: a disabled account can't sign in and its sessions are dead", () => {
  const { staff, owner } = setup();
  const first = staff.login("owner", PW, undefined, {});
  assert.equal(first.ok, true);
  if (!first.ok) return;
  owner.disabled = true;
  assert.equal(staff.resolve(first.session.token), null, "existing session stops resolving");
  const again = staff.login("owner", PW, undefined, {});
  assert.equal(again.ok, false);
  if (!again.ok) assert.equal(again.reason, "disabled");
});

test("sessions: expire on idle and on absolute lifetime", () => {
  const { staff, store } = setup();
  const r = staff.login("owner", PW, undefined, {});
  assert.ok(r.ok);
  if (!r.ok) return;
  const token = r.session.token;

  // Idle past the timeout → gone, and the token is dropped, not just refused.
  assert.equal(staff.resolve(token, Date.now() + STAFF_IDLE_MS + 1000), null);
  assert.equal(store.staffSessions.has(token), false);

  const second = staff.login("owner", PW, undefined, {});
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(staff.resolve(second.session.token, second.session.expiresAt + 1), null);
});

test("two-factor: TOTP validates the current step and survives clock drift", () => {
  const secret = generateTotpSecret();
  const now = 1_800_000_000_000;
  assert.equal(totpValid(secret, totpCode(secret, now), now), true);
  // ±30s of drift is tolerated; well outside it is not.
  assert.equal(totpValid(secret, totpCode(secret, now - 30_000), now), true);
  assert.equal(totpValid(secret, totpCode(secret, now + 30_000), now), true);
  assert.equal(totpValid(secret, totpCode(secret, now + 300_000), now), false);
  assert.equal(totpValid(secret, "000000", now), totpCode(secret, now) === "000000");
  assert.equal(totpValid(secret, "abc", now), false);
});

test("two-factor: an enrolled account needs a valid code", () => {
  const { staff, owner } = setup();
  owner.totpSecret = generateTotpSecret();
  owner.twoFactorEnabled = true;

  const noCode = staff.login("owner", PW, undefined, {});
  assert.equal(noCode.ok, false);
  if (!noCode.ok) assert.equal(noCode.reason, "totp_required");

  const badCode = staff.login("owner", PW, "111111", {});
  assert.equal(badCode.ok, false);

  owner.failedLogins = 0;
  const good = staff.login("owner", PW, totpCode(owner.totpSecret), {});
  assert.equal(good.ok, true);
});

test("permissions: roles resolve, and a denial beats the role grant", () => {
  // A moderator can moderate players but can't touch game config or the team.
  const mod = { role: "moderator" as const, extraPermissions: [], deniedPermissions: [] };
  assert.equal(hasPermission(mod, "users.moderate"), true);
  assert.equal(hasPermission(mod, "game.config"), false);
  assert.equal(hasPermission(mod, "staff.manage"), false);

  // Granular grant: this one moderator may also edit quests.
  const trusted = { ...mod, extraPermissions: ["content.manage" as const] };
  assert.equal(hasPermission(trusted, "content.manage"), true);

  // Granular denial removes a permission the role would otherwise give.
  const limited = { ...mod, deniedPermissions: ["users.moderate" as const] };
  assert.equal(hasPermission(limited, "users.moderate"), false);

  // Owner always holds everything, even if someone writes a denial onto it.
  const owner = { role: "owner" as const, extraPermissions: [], deniedPermissions: ["staff.manage" as const] };
  assert.equal(hasPermission(owner, "staff.manage"), true);
  assert.equal(effectivePermissions(owner).length, effectivePermissions({ role: "owner" }).length);
});

test("permissions: the documented role boundaries hold", () => {
  // Developer: configuration yes, team and security no.
  const dev = ROLE_MAP.developer.permissions;
  assert.ok(dev.includes("game.config") && dev.includes("flags.manage"));
  assert.ok(!dev.includes("staff.manage") && !dev.includes("security.manage"));
  // Content manager: content and assets, no moderation powers.
  const content = ROLE_MAP.content.permissions;
  assert.ok(content.includes("content.manage") && content.includes("themes.manage"));
  assert.ok(!content.includes("users.moderate"));
  // Administrator: everything except security.
  assert.ok(!ROLE_MAP.admin.permissions.includes("security.manage"));
  assert.ok(ROLE_MAP.admin.permissions.includes("game.config"));
});

test("an administrator can never act on an owner", () => {
  const { staff, owner } = setup();
  const admin = staff.create({ username: "admin", password: PW, role: "admin" });
  const mod = staff.create({ username: "mod", password: PW, role: "moderator" });

  assert.equal(staff.canManageAccount(admin, owner), false, "an admin can't touch an owner");
  assert.equal(staff.canManageAccount(admin, mod), true);
  assert.equal(staff.canAssignRole(admin, "owner"), false, "an admin can't mint an owner");
  assert.equal(staff.canAssignRole(admin, "moderator"), true);
  assert.equal(staff.canManageAccount(owner, admin), true);
  // A moderator manages nobody but themselves.
  assert.equal(staff.canManageAccount(mod, admin), false);
  assert.equal(staff.canManageAccount(mod, mod), true);
});

test("usernames are unique and validated", () => {
  const { staff } = setup();
  assert.throws(() => staff.create({ username: "owner", password: PW, role: "admin" }), /taken/);
  assert.throws(() => staff.create({ username: "a", password: PW, role: "admin" }), /3–32/);
  assert.throws(() => staff.create({ username: "has space", password: PW, role: "admin" }), /3–32/);
  assert.throws(() => staff.create({ username: "ok_name", password: "short", role: "admin" }), /12 characters/);
});

test("revoking sessions kicks every device for that account", () => {
  const { staff, owner } = setup();
  staff.login("owner", PW, undefined, {});
  staff.login("owner", PW, undefined, {});
  const other = staff.create({ username: "mod", password: PW, role: "moderator" });
  const kept = staff.login("mod", PW, undefined, {});
  assert.ok(kept.ok);
  assert.equal(staff.revokeAll(owner.id), 2);
  if (kept.ok) assert.ok(staff.resolve(kept.session.token), "other accounts are untouched");
  void other;
});

test("feature flags: registry defaults apply until overridden", () => {
  const { store } = setup();
  assert.equal(store.flag("pit"), true, "defaults come from the registry");
  assert.equal(store.flag("loot_boxes"), false);
  store.featureFlags.pit = false;
  assert.equal(store.flag("pit"), false, "an override wins");
  assert.equal(store.flags().flame_trial, true, "untouched flags keep their default");
  assert.equal(resolveFlags({}).maintenance, false);
  assert.equal(store.flag("no_such_flag"), false, "unknown flags are off, never on");
});

test("the audit log records structure and stays bounded", () => {
  const { store } = setup();
  store.recordAudit({
    id: "a1",
    at: 1,
    actorId: "s1",
    actorName: "owner",
    actorRole: "owner",
    module: "flags",
    action: "flags.update",
    target: "pit",
    before: { pit: true },
    after: { pit: false },
    ip: "10.0.0.1",
  });
  const entry = store.auditLog.at(-1)!;
  assert.equal(entry.action, "flags.update");
  assert.deepEqual(entry.before, { pit: true });
  assert.deepEqual(entry.after, { pit: false });

  for (let i = 0; i < 5200; i++)
    store.recordAudit({ id: `x${i}`, at: i, actorId: "s", actorName: "n", module: "system", action: "noop" });
  assert.equal(store.auditLog.length, 5000, "the log is trimmed, newest kept");
  assert.equal(store.auditLog.at(-1)!.id, "x5199");
});

test("staff accounts, audit log and flags survive a snapshot round-trip", () => {
  const { store, staff } = setup();
  staff.create({ username: "mod", password: PW, role: "moderator" });
  store.featureFlags.loot_boxes = true;
  store.recordAudit({ id: "a", at: 1, actorId: "s", actorName: "owner", module: "team", action: "staff.create" });
  const live = staff.login("owner", PW, undefined, {});
  assert.ok(live.ok);

  const restored = new Store();
  restored.hydrate(JSON.parse(JSON.stringify(store.snapshot())));
  assert.equal(restored.staff.size, 2);
  assert.equal(restored.flag("loot_boxes"), true);
  assert.equal(restored.auditLog.length, 1);
  // Sessions are deliberately NOT persisted: a restart signs operators out.
  assert.equal(restored.staffSessions.size, 0);
  const owner = [...restored.staff.values()].find((s) => s.role === "owner")!;
  assert.equal(verifyPassword(PW, owner.passwordHash), true, "the hash survives so sign-in still works");
});

test("requireStaff: a player Bearer token falls through to the admin key", async () => {
  const { store, staff } = setup();
  const gate = requireStaff(staff, "the-admin-key");

  const run = (headers: Record<string, string>) =>
    new Promise<{ status: number; nexted: boolean }>((resolve) => {
      let status = 200;
      const req = { headers, socket: {} } as unknown as Parameters<typeof gate>[0];
      const res = {
        status(code: number) {
          status = code;
          return this;
        },
        json() {
          resolve({ status, nexted: false });
          return this;
        },
      } as unknown as Parameters<typeof gate>[1];
      gate(req, res, () => resolve({ status, nexted: true }));
    });

  // A player session token is not a staff session — but the admin key alongside
  // it must still let the request through, or every legacy admin call made from
  // a signed-in page would break.
  assert.deepEqual(
    await run({ authorization: "Bearer a-player-session-token", "x-admin-key": "the-admin-key" }),
    { status: 200, nexted: true },
  );
  // The key alone works (break-glass).
  assert.deepEqual(await run({ "x-admin-key": "the-admin-key" }), { status: 200, nexted: true });
  // Neither credential → 401.
  assert.equal((await run({ authorization: "Bearer nope" })).status, 401);
  assert.equal((await run({ "x-admin-key": "wrong" })).status, 401);
  assert.equal((await run({})).status, 401);

  // A real staff session works with no key at all.
  const login = staff.login("owner", PW, undefined, {});
  assert.ok(login.ok);
  if (!login.ok) return;
  assert.deepEqual(await run({ authorization: `Bearer ${login.session.token}` }), {
    status: 200,
    nexted: true,
  });
  void store;
});

test("requireStaff: a permission the account lacks is refused with 403", async () => {
  const { staff } = setup();
  staff.create({ username: "mod", password: PW, role: "moderator" });
  const login = staff.login("mod", PW, undefined, {});
  assert.ok(login.ok);
  if (!login.ok) return;
  const gate = requireStaff(staff, "the-admin-key", "game.config");
  const status = await new Promise<number>((resolve) => {
    let code = 200;
    const req = {
      headers: { authorization: `Bearer ${login.session.token}` },
      socket: {},
    } as unknown as Parameters<typeof gate>[0];
    const res = {
      status(c: number) {
        code = c;
        return this;
      },
      json() {
        resolve(code);
        return this;
      },
    } as unknown as Parameters<typeof gate>[1];
    gate(req, res, () => resolve(code));
  });
  assert.equal(status, 403, "a moderator can't reach game configuration");
});
