/**
 * Command Center API — the internal operations platform's own surface.
 *
 * Mounted under /api/cc. Everything here is staff-authenticated and audited;
 * nothing here is reachable with a player session. The existing /api/admin/*
 * routes keep working (they are the same operations behind the shared admin
 * key), so this is an expansion of the ops surface rather than a rewrite of it.
 */
import type { Express, Response } from "express";
import {
  ACHIEVEMENTS,
  ALL_PERMISSIONS,
  COPY_ENTRIES,
  COPY_MAP,
  copyGroups,
  BRANDING_SLOTS,
  SOUND_CUES,
  THEME_ASSET_SLOTS,
  activeTheme,
  freshTheme,
  type ThemeAssetSlot,
  FEATURE_FLAGS,
  GAME_MODES,
  MISSIONS,
  freshGameSettings,
  gameSettingProblem,
  PERMISSIONS,
  ROLES,
  ROLE_MAP,
  effectivePermissions,
  marketCap,
  type CcModule,
  type Permission,
  type SearchHit,
  type StaffRole,
} from "@cookout/shared";
import { MediaService } from "./media.js";
import { rateLimit } from "./ratelimit.js";
import {
  StaffService,
  actorOf,
  audit,
  clientIp,
  generateTotpSecret,
  hashPassword,
  passwordProblem,
  requireStaff,
  totpUri,
  totpValid,
  verifyPassword,
  type StaffRequest,
  type StoredStaff,
} from "./staff.js";
import type { Store } from "./store.js";

class CcError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (req: StaffRequest, res: Response) => void | Promise<void>;
const wrap =
  (fn: Handler) =>
  async (req: StaffRequest, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err instanceof CcError ? err.status : 500;
      res.status(status).json({ error: (err as Error).message });
    }
  };

/**
 * Mount the Command Center. `adminKey` stays supported as break-glass access
 * (see requireStaff) so a broken team configuration can always be repaired.
 */
export function mountCommandCenter(
  app: Express,
  store: Store,
  adminKey: string,
  media: MediaService,
): StaffService {
  const staffService = new StaffService(store);
  const gate = (permission?: Permission) => requireStaff(staffService, adminKey, permission);

  // ------------------------------------------------------------------ session

  /**
   * First-run state. Deliberately unauthenticated but says almost nothing: only
   * whether an owner exists, so the sign-in screen knows to offer bootstrap.
   */
  app.get(
    "/api/cc/bootstrap",
    wrap((_req, res) => {
      res.json({ needsOwner: !staffService.hasOwner() });
    }),
  );

  /**
   * Create the very first Owner. Only possible while no owner exists, and only
   * for a caller holding the shared admin key — so the account is created by
   * someone with server access, never by a stranger who finds the URL.
   */
  app.post(
    "/api/cc/bootstrap",
    rateLimit("cc_bootstrap", 5, 60_000),
    wrap((req, res) => {
      if (staffService.hasOwner()) throw new CcError(409, "an owner already exists");
      const key = String(req.headers["x-admin-key"] ?? "");
      if (!adminKey || key !== adminKey)
        throw new CcError(403, "the server admin key is required to create the first owner");
      const { username, password, displayName } = req.body as Record<string, string>;
      if (!username || !password) throw new CcError(400, "username and password are required");
      const account = staffService.create({
        username,
        password,
        displayName,
        role: "owner",
        createdBy: "bootstrap",
      });
      audit(store, req, {
        module: "team",
        action: "staff.bootstrap",
        target: account.username,
        after: { username: account.username, role: "owner" },
        note: "first owner created via the server admin key",
      });
      res.json({ ok: true, account: StaffService.toPublic(account) });
    }),
  );

  app.post(
    "/api/cc/login",
    // Brute-force guard on top of the per-account lockout: an attacker
    // spraying many usernames from one address is throttled too.
    rateLimit("cc_login", 10, 60_000),
    wrap((req, res) => {
      const { username, password, totp } = req.body as Record<string, string>;
      if (!username || !password) throw new CcError(400, "username and password are required");
      const result = staffService.login(username, password, totp, {
        ip: clientIp(req),
        userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200),
      });
      if (!result.ok) {
        // A 2FA prompt has to be distinguishable so the UI can ask for a code;
        // everything else collapses to one message so nothing is enumerable.
        if (result.reason === "totp_required") {
          res.status(401).json({ error: "two-factor code required", totpRequired: true });
          return;
        }
        const message =
          result.reason === "locked"
            ? "too many failed attempts — this account is locked, try again shortly"
            : result.reason === "disabled"
              ? "this account has been disabled"
              : "incorrect username, password or two-factor code";
        store.recordAudit({
          id: store.id(),
          at: Date.now(),
          actorId: "anonymous",
          actorName: username.slice(0, 64),
          module: "auth",
          action: "staff.login_failed",
          ip: clientIp(req),
          note: result.reason,
        });
        res.status(401).json({ error: message });
        return;
      }
      req.staff = result.account;
      audit(store, req, { module: "auth", action: "staff.login", target: result.account.username });
      res.json({
        token: result.session.token,
        expiresAt: result.session.expiresAt,
        account: StaffService.toPublic(result.account),
        permissions: effectivePermissions(result.account),
        mustChangePassword: !!result.account.mustChangePassword,
      });
    }),
  );

  app.post(
    "/api/cc/logout",
    gate(),
    wrap((req, res) => {
      if (req.staffSession) {
        audit(store, req, { module: "auth", action: "staff.logout" });
        staffService.logout(req.staffSession.token);
      }
      res.json({ ok: true });
    }),
  );

  /** Who am I, and what may I do? The UI calls this on every load. */
  app.get(
    "/api/cc/me",
    gate(),
    wrap((req, res) => {
      if (req.staffViaKey) {
        res.json({
          account: {
            id: "admin-key",
            username: "admin-key",
            displayName: "Shared admin key",
            role: "owner" as StaffRole,
            extraPermissions: [],
            deniedPermissions: [],
            twoFactorEnabled: false,
            disabled: false,
            createdAt: 0,
          },
          permissions: ALL_PERMISSIONS,
          viaKey: true,
        });
        return;
      }
      res.json({
        account: StaffService.toPublic(req.staff!),
        permissions: effectivePermissions(req.staff!),
        expiresAt: req.staffSession?.expiresAt,
        mustChangePassword: !!req.staff!.mustChangePassword,
      });
    }),
  );

  /** Change your own password. Requires the current one, even when signed in. */
  app.post(
    "/api/cc/me/password",
    gate(),
    wrap((req, res) => {
      const me = req.staff;
      if (!me) throw new CcError(400, "the shared admin key has no password to change");
      const { currentPassword, newPassword } = req.body as Record<string, string>;
      if (!verifyPassword(String(currentPassword ?? ""), me.passwordHash))
        throw new CcError(403, "current password is incorrect");
      const problem = passwordProblem(String(newPassword ?? ""));
      if (problem) throw new CcError(400, problem);
      me.passwordHash = hashPassword(newPassword);
      me.mustChangePassword = false;
      audit(store, req, { module: "team", action: "staff.password_change", target: me.username });
      // Every other session for this account dies, so a stolen token can't
      // outlive the password that leaked it.
      const keep = req.staffSession?.token;
      for (const [token, s] of store.staffSessions)
        if (s.staffId === me.id && token !== keep) store.staffSessions.delete(token);
      res.json({ ok: true });
    }),
  );

  // ---- two-factor enrolment (self-service) ----

  app.post(
    "/api/cc/me/2fa/start",
    gate(),
    wrap((req, res) => {
      const me = req.staff;
      if (!me) throw new CcError(400, "the shared admin key can't enrol in 2FA");
      // Held on the account but not enabled until a code is confirmed, so a
      // half-finished enrolment can never lock anyone out.
      me.totpSecret = generateTotpSecret();
      me.twoFactorEnabled = false;
      res.json({ secret: me.totpSecret, uri: totpUri(me.username, me.totpSecret) });
    }),
  );

  app.post(
    "/api/cc/me/2fa/confirm",
    gate(),
    wrap((req, res) => {
      const me = req.staff;
      if (!me?.totpSecret) throw new CcError(400, "start two-factor enrolment first");
      const { code } = req.body as Record<string, string>;
      if (!totpValid(me.totpSecret, String(code ?? ""))) throw new CcError(400, "that code didn't match");
      me.twoFactorEnabled = true;
      audit(store, req, { module: "team", action: "staff.2fa_enabled", target: me.username });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/cc/me/2fa/disable",
    gate(),
    wrap((req, res) => {
      const me = req.staff;
      if (!me) throw new CcError(400, "nothing to disable");
      const { password } = req.body as Record<string, string>;
      if (!verifyPassword(String(password ?? ""), me.passwordHash))
        throw new CcError(403, "password is incorrect");
      me.twoFactorEnabled = false;
      me.totpSecret = undefined;
      audit(store, req, { module: "team", action: "staff.2fa_disabled", target: me.username });
      res.json({ ok: true });
    }),
  );

  // --------------------------------------------------------------------- team

  app.get(
    "/api/cc/staff",
    gate("staff.view"),
    wrap((_req, res) => {
      res.json({
        accounts: staffService.list().map(StaffService.toPublic),
        roles: ROLES,
        permissions: PERMISSIONS,
      });
    }),
  );

  app.post(
    "/api/cc/staff",
    gate("staff.manage"),
    wrap((req, res) => {
      const body = req.body as {
        username?: string;
        password?: string;
        role?: StaffRole;
        displayName?: string;
        walletAddress?: string;
        extraPermissions?: Permission[];
        deniedPermissions?: Permission[];
      };
      const role = body.role ?? "moderator";
      // The shared key acts as an owner; a real account may only create roles
      // its own role is allowed to manage.
      if (req.staff && !staffService.canAssignRole(req.staff, role))
        throw new CcError(403, `your role can't create ${ROLE_MAP[role]?.label ?? role} accounts`);
      const account = staffService.create({
        username: String(body.username ?? ""),
        password: String(body.password ?? ""),
        role,
        displayName: body.displayName,
        walletAddress: body.walletAddress,
        extraPermissions: sanitizePerms(body.extraPermissions),
        deniedPermissions: sanitizePerms(body.deniedPermissions),
        createdBy: req.staff?.username ?? "admin-key",
      });
      audit(store, req, {
        module: "team",
        action: "staff.create",
        target: account.username,
        after: { role: account.role, extraPermissions: account.extraPermissions },
      });
      res.json({ account: StaffService.toPublic(account) });
    }),
  );

  app.patch(
    "/api/cc/staff/:id",
    gate("staff.manage"),
    wrap((req, res) => {
      const target = mustStaff(staffService, req.params.id!);
      if (req.staff && !staffService.canManageAccount(req.staff, target))
        throw new CcError(403, "your role can't modify this account");
      const body = req.body as {
        role?: StaffRole;
        displayName?: string;
        walletAddress?: string;
        disabled?: boolean;
        extraPermissions?: Permission[];
        deniedPermissions?: Permission[];
      };
      const before = {
        role: target.role,
        disabled: target.disabled,
        extraPermissions: [...target.extraPermissions],
        deniedPermissions: [...target.deniedPermissions],
      };

      if (body.role && body.role !== target.role) {
        if (req.staff && !staffService.canAssignRole(req.staff, body.role))
          throw new CcError(403, `your role can't assign ${ROLE_MAP[body.role]?.label ?? body.role}`);
        // Never leave the platform without an owner.
        if (target.role === "owner" && countActiveOwners(staffService, target.id) === 0)
          throw new CcError(400, "this is the last owner — promote another owner first");
        target.role = body.role;
      }
      if (body.displayName !== undefined) target.displayName = body.displayName.trim() || undefined;
      if (body.walletAddress !== undefined)
        target.walletAddress = body.walletAddress.trim().toLowerCase() || undefined;
      if (body.extraPermissions) target.extraPermissions = sanitizePerms(body.extraPermissions);
      if (body.deniedPermissions) target.deniedPermissions = sanitizePerms(body.deniedPermissions);
      if (body.disabled !== undefined) {
        if (body.disabled && target.role === "owner" && countActiveOwners(staffService, target.id) === 0)
          throw new CcError(400, "this is the last active owner — you can't disable it");
        target.disabled = body.disabled;
        if (body.disabled) staffService.revokeAll(target.id);
      }

      audit(store, req, {
        module: "team",
        action: "staff.update",
        target: target.username,
        before,
        after: {
          role: target.role,
          disabled: target.disabled,
          extraPermissions: target.extraPermissions,
          deniedPermissions: target.deniedPermissions,
        },
      });
      res.json({ account: StaffService.toPublic(target) });
    }),
  );

  /** Admin-set a new password. Forces a change at next sign-in. */
  app.post(
    "/api/cc/staff/:id/password",
    gate("staff.manage"),
    wrap((req, res) => {
      const target = mustStaff(staffService, req.params.id!);
      if (req.staff && !staffService.canManageAccount(req.staff, target))
        throw new CcError(403, "your role can't modify this account");
      const { password } = req.body as Record<string, string>;
      const problem = passwordProblem(String(password ?? ""));
      if (problem) throw new CcError(400, problem);
      target.passwordHash = hashPassword(password);
      target.mustChangePassword = true;
      target.failedLogins = 0;
      target.lockedUntil = undefined;
      const revoked = staffService.revokeAll(target.id);
      audit(store, req, {
        module: "team",
        action: "staff.password_reset",
        target: target.username,
        note: `${revoked} session(s) revoked`,
      });
      res.json({ ok: true });
    }),
  );

  app.delete(
    "/api/cc/staff/:id",
    gate("staff.manage"),
    wrap((req, res) => {
      const target = mustStaff(staffService, req.params.id!);
      if (req.staff && !staffService.canManageAccount(req.staff, target))
        throw new CcError(403, "your role can't delete this account");
      if (req.staff?.id === target.id) throw new CcError(400, "you can't delete your own account");
      if (target.role === "owner" && countActiveOwners(staffService, target.id) === 0)
        throw new CcError(400, "this is the last owner — promote another owner first");
      staffService.revokeAll(target.id);
      store.staff.delete(target.id);
      audit(store, req, {
        module: "team",
        action: "staff.delete",
        target: target.username,
        before: { role: target.role },
      });
      res.json({ ok: true });
    }),
  );

  /** Clear a lockout without changing the password. */
  app.post(
    "/api/cc/staff/:id/unlock",
    gate("staff.manage"),
    wrap((req, res) => {
      const target = mustStaff(staffService, req.params.id!);
      target.lockedUntil = undefined;
      target.failedLogins = 0;
      audit(store, req, { module: "team", action: "staff.unlock", target: target.username });
      res.json({ ok: true });
    }),
  );

  // ------------------------------------------------------- game configuration

  /** The live gameplay configuration, plus the compiled defaults so the editor
   *  can show what each value started as and offer a reset. */
  app.get(
    "/api/cc/game",
    gate("game.config"),
    wrap((_req, res) => {
      res.json({
        settings: store.settings.game,
        defaults: freshGameSettings(),
        // Labels and descriptions stay in code — only the numbers are tunable.
        catalog: {
          modes: GAME_MODES.map((m) => ({ key: m.key, name: m.name, tagline: m.tagline })),
          missions: MISSIONS.map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description,
            period: m.period,
            metric: m.metric,
          })),
          achievements: ACHIEVEMENTS.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
          })),
          xpEvents: Object.keys(freshGameSettings().xp),
        },
      });
    }),
  );

  /**
   * Patch gameplay configuration by dotted path, e.g.
   * `{ "tiers.standard.tradeFeeBps": 120, "modes.blitz.pullUpCap": 1.2 }`.
   *
   * Paths are validated against the existing shape, so a typo can't invent a
   * setting the engine will never read, and each value passes the guardrails
   * before anything is written. The whole patch is applied or none of it is.
   */
  app.patch(
    "/api/cc/game",
    gate("game.config"),
    wrap((req, res) => {
      const patch = req.body as Record<string, unknown>;
      if (!patch || typeof patch !== "object") throw new CcError(400, "expected a patch object");
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};

      // Validate everything first — a half-applied config is worse than none.
      for (const [path, value] of Object.entries(patch)) {
        const current = readPath(store.settings.game, path);
        if (current === undefined)
          throw new CcError(400, `"${path}" isn't a game setting`);
        if (typeof value !== typeof current && !(current === null || value === null))
          throw new CcError(400, `"${path}" expects a ${typeof current}`);
        const problem = gameSettingProblem(path, value);
        if (problem) throw new CcError(400, `${path}: ${problem}`);
        before[path] = current;
      }
      for (const [path, value] of Object.entries(patch)) {
        writePath(store.settings.game, path, value);
        after[path] = value;
      }

      audit(store, req, {
        module: "game",
        action: "game.config_update",
        target: Object.keys(patch).join(", "),
        before,
        after,
      });
      res.json({ settings: store.settings.game });
    }),
  );

  /** Reset the whole gameplay configuration back to the compiled defaults. */
  app.post(
    "/api/cc/game/reset",
    gate("game.config"),
    wrap((req, res) => {
      const before = structuredClone(store.settings.game);
      store.settings.game = freshGameSettings();
      audit(store, req, {
        module: "game",
        action: "game.config_reset",
        before,
        after: store.settings.game,
        note: "reset to compiled defaults",
      });
      res.json({ settings: store.settings.game });
    }),
  );

  // ------------------------------------------------------------ feature flags

  app.get(
    "/api/cc/flags",
    gate("flags.manage"),
    wrap((_req, res) => {
      res.json({ registry: FEATURE_FLAGS, values: store.flags(), overrides: store.featureFlags });
    }),
  );

  app.patch(
    "/api/cc/flags",
    gate("flags.manage"),
    wrap((req, res) => {
      const body = req.body as Record<string, unknown>;
      const before = store.flags();
      for (const [key, value] of Object.entries(body)) {
        if (!FEATURE_FLAGS.some((f) => f.key === key)) throw new CcError(400, `unknown flag "${key}"`);
        if (typeof value !== "boolean") throw new CcError(400, `flag "${key}" must be true or false`);
        store.featureFlags[key] = value;
      }
      const after = store.flags();
      const changed = Object.keys(body).filter((k) => before[k] !== after[k]);
      audit(store, req, {
        module: "flags",
        action: "flags.update",
        target: changed.join(", ") || "(no change)",
        before: Object.fromEntries(changed.map((k) => [k, before[k]])),
        after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      });
      res.json({ values: after });
    }),
  );

  // ------------------------------------------------------------ media library

  app.get(
    "/api/cc/media",
    gate("assets.manage"),
    wrap((req, res) => {
      const q = String(req.query.q ?? "").toLowerCase();
      const folder = String(req.query.folder ?? "");
      const kind = String(req.query.kind ?? "");
      let assets = media.list();
      if (folder) assets = assets.filter((a) => a.folder === folder || a.folder.startsWith(`${folder}/`));
      if (kind) assets = assets.filter((a) => a.kind === kind);
      if (q)
        assets = assets.filter((a) =>
          `${a.originalName} ${a.folder} ${a.tags.join(" ")}`.toLowerCase().includes(q),
        );
      res.json({
        assets,
        folders: [...new Set(media.list().map((a) => a.folder))].sort(),
        tags: [...new Set(media.list().flatMap((a) => a.tags))].sort(),
        totalBytes: media.totalBytes(),
        count: media.list().length,
      });
    }),
  );

  app.post(
    "/api/cc/media",
    gate("assets.manage"),
    wrap((req, res) => {
      const body = req.body as {
        dataUrl?: string;
        originalName?: string;
        folder?: string;
        tags?: string[];
      };
      if (!body.dataUrl) throw new CcError(400, "no file supplied");
      const { asset, duplicate } = media.upload({
        dataUrl: body.dataUrl,
        originalName: body.originalName,
        folder: body.folder,
        tags: body.tags,
        uploadedBy: actorOf(req).actorName,
      });
      if (!duplicate)
        audit(store, req, {
          module: "media",
          action: "media.upload",
          target: asset.originalName,
          after: { id: asset.id, folder: asset.folder, size: asset.size, mime: asset.mime },
        });
      res.json({ asset, duplicate });
    }),
  );

  app.patch(
    "/api/cc/media/:id",
    gate("assets.manage"),
    wrap((req, res) => {
      const body = req.body as { folder?: string; tags?: string[]; originalName?: string };
      const before = { ...media.get(req.params.id!) };
      const asset = media.update(req.params.id!, body);
      audit(store, req, {
        module: "media",
        action: "media.update",
        target: asset.originalName,
        before: { folder: before.folder, tags: before.tags, originalName: before.originalName },
        after: { folder: asset.folder, tags: asset.tags, originalName: asset.originalName },
      });
      res.json({ asset });
    }),
  );

  /** Swap the bytes behind an asset, keeping its id so every reference follows. */
  app.post(
    "/api/cc/media/:id/replace",
    gate("assets.manage"),
    wrap((req, res) => {
      const { dataUrl } = req.body as { dataUrl?: string };
      if (!dataUrl) throw new CcError(400, "no file supplied");
      const asset = media.replace(req.params.id!, dataUrl);
      audit(store, req, {
        module: "media",
        action: "media.replace",
        target: asset.originalName,
        after: { id: asset.id, size: asset.size, mime: asset.mime },
        note: `${media.referencesTo(asset.id).length} reference(s) follow the swap`,
      });
      res.json({ asset });
    }),
  );

  app.delete(
    "/api/cc/media/:id",
    gate("assets.manage"),
    wrap((req, res) => {
      const { asset, references } = media.remove(req.params.id!);
      audit(store, req, {
        module: "media",
        action: "media.delete",
        target: asset.originalName,
        before: { id: asset.id, folder: asset.folder, size: asset.size },
        note: references.length ? `was still used by: ${references.join(", ")}` : undefined,
      });
      res.json({ ok: true, references });
    }),
  );

  /** What currently points at an asset — checked before a delete. */
  app.get(
    "/api/cc/media/:id/references",
    gate("assets.manage"),
    wrap((req, res) => {
      res.json({ references: media.referencesTo(req.params.id!) });
    }),
  );

  // ---------------------------------------------------------------- branding

  app.get(
    "/api/cc/branding",
    gate("assets.manage"),
    wrap((_req, res) => {
      res.json({ branding: store.settings.branding, slots: BRANDING_SLOTS });
    }),
  );

  app.patch(
    "/api/cc/branding",
    gate("assets.manage"),
    wrap((req, res) => {
      const body = req.body as Partial<typeof store.settings.branding>;
      const before = structuredClone(store.settings.branding);
      const b = store.settings.branding;
      if (body.assets) {
        for (const [slot, id] of Object.entries(body.assets)) {
          if (!BRANDING_SLOTS.some((s) => s.key === slot)) throw new CcError(400, `unknown slot "${slot}"`);
          if (id && !media.get(id)) throw new CcError(400, `no media asset ${id}`);
          b.assets[slot as keyof typeof b.assets] = id;
        }
      }
      if (body.colors) {
        for (const [key, value] of Object.entries(body.colors)) {
          if (!(key in b.colors)) throw new CcError(400, `unknown colour "${key}"`);
          const problem = colorProblem(value);
          if (problem) throw new CcError(400, `${key}: ${problem}`);
          b.colors[key as keyof typeof b.colors] = value;
        }
      }
      if (body.siteName !== undefined) b.siteName = String(body.siteName).slice(0, 60);
      if (body.tagline !== undefined) b.tagline = String(body.tagline).slice(0, 160);
      audit(store, req, { module: "branding", action: "branding.update", before, after: structuredClone(b) });
      res.json({ branding: b });
    }),
  );

  // ------------------------------------------------------------- theme studio

  app.get(
    "/api/cc/themes",
    gate("themes.manage"),
    wrap((_req, res) => {
      res.json({
        settings: store.settings.themes,
        active: activeTheme(store.settings.themes),
        slots: THEME_ASSET_SLOTS,
        cues: SOUND_CUES,
      });
    }),
  );

  app.post(
    "/api/cc/themes",
    gate("themes.manage"),
    wrap((req, res) => {
      const { name, duplicateOf } = req.body as { name?: string; duplicateOf?: string };
      const label = String(name ?? "").trim();
      if (!label) throw new CcError(400, "a theme needs a name");
      const id = store.id();
      const source = duplicateOf ? store.settings.themes.themes[duplicateOf] : undefined;
      if (duplicateOf && !source) throw new CcError(404, "no such theme to duplicate");
      const theme = source
        ? {
            ...structuredClone(source),
            id,
            name: label,
            // A duplicate never inherits the original's schedule — two themes
            // silently competing for the same window is a trap.
            startsAt: undefined,
            endsAt: undefined,
            archived: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
        : freshTheme(id, label);
      store.settings.themes.themes[id] = theme;
      audit(store, req, {
        module: "themes",
        action: duplicateOf ? "theme.duplicate" : "theme.create",
        target: label,
        after: { id, duplicateOf },
      });
      res.json({ theme });
    }),
  );

  app.patch(
    "/api/cc/themes/:id",
    gate("themes.manage"),
    wrap((req, res) => {
      const theme = store.settings.themes.themes[req.params.id!];
      if (!theme) throw new CcError(404, "no such theme");
      const body = req.body as Partial<typeof theme>;
      const before = structuredClone(theme);

      if (body.name !== undefined) theme.name = String(body.name).slice(0, 60);
      if (body.description !== undefined) theme.description = String(body.description).slice(0, 300);
      if (body.colors) {
        for (const [key, value] of Object.entries(body.colors)) {
          if (!(key in theme.colors)) throw new CcError(400, `unknown colour "${key}"`);
          const problem = colorProblem(value);
          if (problem) throw new CcError(400, `${key}: ${problem}`);
          theme.colors[key as keyof typeof theme.colors] = value;
        }
      }
      if (body.assets) {
        for (const [slot, id] of Object.entries(body.assets)) {
          if (!THEME_ASSET_SLOTS.some((s) => s.key === slot)) throw new CcError(400, `unknown slot "${slot}"`);
          if (id && !media.get(id)) throw new CcError(400, `no media asset ${id}`);
          if (id) theme.assets[slot as ThemeAssetSlot] = id;
          else delete theme.assets[slot as ThemeAssetSlot];
        }
      }
      if (body.audio) {
        for (const [cue, id] of Object.entries(body.audio)) {
          if (!SOUND_CUES.some((c) => c.key === cue)) throw new CcError(400, `unknown sound cue "${cue}"`);
          if (id && !media.get(id)) throw new CcError(400, `no media asset ${id}`);
          if (id) theme.audio[cue] = id;
          else delete theme.audio[cue];
        }
      }
      if (body.effects) theme.effects = { ...theme.effects, ...body.effects };
      if ("startsAt" in body) theme.startsAt = body.startsAt ?? undefined;
      if ("endsAt" in body) theme.endsAt = body.endsAt ?? undefined;
      if (theme.startsAt !== undefined && theme.endsAt !== undefined && theme.endsAt <= theme.startsAt)
        throw new CcError(400, "the end of the window has to come after its start");
      if (body.archived !== undefined) {
        theme.archived = !!body.archived;
        // An archived theme can't stay pinned, or it would keep running.
        if (theme.archived && store.settings.themes.activeThemeId === theme.id)
          store.settings.themes.activeThemeId = "";
      }
      theme.updatedAt = Date.now();

      audit(store, req, {
        module: "themes",
        action: "theme.update",
        target: theme.name,
        before,
        after: structuredClone(theme),
      });
      res.json({ theme });
    }),
  );

  app.delete(
    "/api/cc/themes/:id",
    gate("themes.manage"),
    wrap((req, res) => {
      const theme = store.settings.themes.themes[req.params.id!];
      if (!theme) throw new CcError(404, "no such theme");
      delete store.settings.themes.themes[theme.id];
      if (store.settings.themes.activeThemeId === theme.id) store.settings.themes.activeThemeId = "";
      audit(store, req, { module: "themes", action: "theme.delete", target: theme.name, before: theme });
      res.json({ ok: true });
    }),
  );

  /** Pin a theme live, or clear the pin so the schedule takes over again. */
  app.post(
    "/api/cc/themes/activate",
    gate("themes.manage"),
    wrap((req, res) => {
      const { id, enabled } = req.body as { id?: string; enabled?: boolean };
      const before = {
        activeThemeId: store.settings.themes.activeThemeId,
        enabled: store.settings.themes.enabled,
      };
      if (id !== undefined) {
        if (id && !store.settings.themes.themes[id]) throw new CcError(404, "no such theme");
        if (id && store.settings.themes.themes[id]!.archived)
          throw new CcError(400, "that theme is archived — restore it first");
        store.settings.themes.activeThemeId = id;
      }
      if (enabled !== undefined) {
        store.settings.themes.enabled = !!enabled;
        // Keep the feature flag and the module's own switch in step, so the
        // two can't disagree about whether theming is on.
        store.featureFlags.seasonal_theme = !!enabled;
      }
      audit(store, req, {
        module: "themes",
        action: "theme.activate",
        target: store.settings.themes.activeThemeId || "(schedule)",
        before,
        after: {
          activeThemeId: store.settings.themes.activeThemeId,
          enabled: store.settings.themes.enabled,
        },
      });
      res.json({ settings: store.settings.themes, active: activeTheme(store.settings.themes) });
    }),
  );

  // ------------------------------------------------------------ audio manager

  app.get(
    "/api/cc/audio",
    gate("assets.manage"),
    wrap((_req, res) => {
      res.json({ audio: store.settings.audio, cues: SOUND_CUES });
    }),
  );

  app.patch(
    "/api/cc/audio",
    gate("assets.manage"),
    wrap((req, res) => {
      const body = req.body as {
        cues?: Record<string, string>;
        masterVolume?: number;
        groupVolume?: Record<string, number>;
      };
      const before = structuredClone(store.settings.audio);
      const a = store.settings.audio;
      for (const [cue, id] of Object.entries(body.cues ?? {})) {
        if (!SOUND_CUES.some((c) => c.key === cue)) throw new CcError(400, `unknown sound cue "${cue}"`);
        if (id) {
          const asset = media.get(id);
          if (!asset) throw new CcError(400, `no media asset ${id}`);
          if (asset.kind !== "audio") throw new CcError(400, `${asset.originalName} isn't an audio file`);
          a.cues[cue] = id;
        } else delete a.cues[cue];
      }
      if (body.masterVolume !== undefined) a.masterVolume = clamp01(body.masterVolume);
      for (const [group, vol] of Object.entries(body.groupVolume ?? {}))
        a.groupVolume[group] = clamp01(vol);
      audit(store, req, { module: "audio", action: "audio.update", before, after: structuredClone(a) });
      res.json({ audio: a });
    }),
  );

  // -------------------------------------------------------------- site copy

  /** Every editable string: its key, group, current value and shipped default. */
  app.get(
    "/api/cc/copy",
    gate("content.manage"),
    wrap((_req, res) => {
      const current = store.copyMap();
      res.json({
        entries: COPY_ENTRIES.map((e) => ({
          ...e,
          value: current[e.key] ?? e.defaultText,
          overridden: store.settings.copy[e.key] !== undefined,
        })),
        groups: copyGroups(),
        overrideCount: Object.keys(store.settings.copy).length,
      });
    }),
  );

  /**
   * Patch copy by key. Writing a value identical to the default clears the
   * override instead of storing it, so "overridden" always means "somebody
   * deliberately changed this" rather than "somebody once touched the field".
   */
  app.patch(
    "/api/cc/copy",
    gate("content.manage"),
    wrap((req, res) => {
      const patch = req.body as Record<string, unknown>;
      if (!patch || typeof patch !== "object") throw new CcError(400, "expected a patch object");
      const before: Record<string, string> = {};
      const after: Record<string, string> = {};
      for (const [key, value] of Object.entries(patch)) {
        const entry = COPY_MAP[key];
        if (!entry) throw new CcError(400, `"${key}" isn't a known copy key`);
        if (typeof value !== "string") throw new CcError(400, `"${key}" must be text`);
        if (value.length > 8000) throw new CcError(400, `"${key}" is too long (8000 character limit)`);
        before[key] = store.copyMap()[key] ?? entry.defaultText;
        if (value === entry.defaultText) delete store.settings.copy[key];
        else store.settings.copy[key] = value;
        after[key] = value;
      }
      audit(store, req, {
        module: "content",
        action: "copy.update",
        target: Object.keys(patch).join(", ").slice(0, 200),
        before,
        after,
      });
      res.json({ ok: true, overrideCount: Object.keys(store.settings.copy).length });
    }),
  );

  /** Reset specific keys, or every override when no keys are given. */
  app.post(
    "/api/cc/copy/reset",
    gate("content.manage"),
    wrap((req, res) => {
      const { keys } = req.body as { keys?: string[] };
      const before = { ...store.settings.copy };
      if (Array.isArray(keys) && keys.length) for (const k of keys) delete store.settings.copy[k];
      else store.settings.copy = {};
      audit(store, req, {
        module: "content",
        action: "copy.reset",
        target: keys?.length ? keys.join(", ").slice(0, 200) : "(all)",
        before,
        after: { ...store.settings.copy },
      });
      res.json({ ok: true, overrideCount: Object.keys(store.settings.copy).length });
    }),
  );

  // ---------------------------------------------------------------- audit log

  app.get(
    "/api/cc/audit",
    gate("audit.view"),
    wrap((req, res) => {
      const q = String(req.query.q ?? "").toLowerCase();
      const moduleFilter = String(req.query.module ?? "");
      const actor = String(req.query.actor ?? "");
      const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 200)));
      let rows = [...store.auditLog].reverse();
      if (moduleFilter) rows = rows.filter((e) => e.module === moduleFilter);
      if (actor) rows = rows.filter((e) => e.actorId === actor || e.actorName === actor);
      if (q)
        rows = rows.filter((e) =>
          `${e.actorName} ${e.action} ${e.target ?? ""} ${e.note ?? ""}`.toLowerCase().includes(q),
        );
      res.json({ entries: rows.slice(0, limit), total: store.auditLog.length });
    }),
  );

  // ---------------------------------------------------------------- dashboard

  app.get(
    "/api/cc/dashboard",
    gate(),
    wrap((_req, res) => {
      const now = Date.now();
      const rounds = [...store.rounds.values()];
      const live = rounds.filter((r) => r.state === "live");
      const activeStates = ["scheduled", "lobby", "queue_open", "settling", "live"];
      const dayAgo = now - 86_400_000;
      const players = [...store.users.values()].filter(
        (u) => !u.address.startsWith("0xb07") && !u.isAI,
      );
      // "Online" is best-effort: a live session that has been used recently.
      const activeSessions = [...store.sessions.values()].filter((s) => s.expiresAt > now).length;
      let volume24h = 0;
      for (const list of store.trades.values())
        for (const t of list) if (t.at >= dayAgo) volume24h += t.ethAmount;

      res.json({
        platform: {
          players: players.length,
          newPlayers24h: players.filter((u) => (u.createdAt ?? 0) >= dayAgo).length,
          activeSessions,
          liveMatches: live.length,
          activeMatches: rounds.filter((r) => activeStates.includes(r.state)).length,
          pitMatches: rounds.filter((r) => r.matchType === "pit" && r.state === "live").length,
          volume24hEth: volume24h,
          jackpotEth: store.jackpotPool,
          jackpotLifetimeEth: store.jackpotLifetimeEth,
          burgersOutstanding: players.reduce((s, u) => s + (u.burgerBalance ?? 0), 0),
          burgersEarned: players.reduce((s, u) => s + (u.burgerEarned ?? 0), 0),
          ethUsd: store.ethUsd,
        },
        infrastructure: {
          uptimeSeconds: Math.floor(process.uptime()),
          memoryMb: Math.round(process.memoryUsage().heapUsed / 1_048_576),
          persistence: process.env.DATABASE_URL ? "postgres" : "file",
          telegram: store.settings.telegramPinsDone !== undefined || !!process.env.TELEGRAM_BOT_TOKEN,
          bots: store.settings.bots,
          autoSchedule: store.settings.autoSchedule,
          staffSessions: store.staffSessions.size,
        },
        flags: store.flags(),
        recentActivity: [...store.auditLog].reverse().slice(0, 15),
      });
    }),
  );

  // ------------------------------------------------------------- global search

  /**
   * One search across everything the Command Center manages. Deliberately a
   * straight scan: the data set is small enough that an index would be more
   * machinery than the feature is worth, and it stays correct as modules grow.
   */
  app.get(
    "/api/cc/search",
    gate(),
    wrap((req, res) => {
      const q = String(req.query.q ?? "").trim().toLowerCase();
      if (q.length < 2) {
        res.json({ hits: [] });
        return;
      }
      const perms = req.staffPermissions ?? [];
      const can = (p: Permission) => perms.includes(p);
      const hits: SearchHit[] = [];
      const match = (...parts: (string | undefined)[]) =>
        parts.some((p) => p?.toLowerCase().includes(q));

      if (can("users.view"))
        for (const u of store.users.values()) {
          if (hits.length > 60) break;
          if (match(u.address, u.displayName)) {
            hits.push({
              kind: "user",
              id: u.address,
              title: u.displayName ?? `${u.address.slice(0, 8)}…`,
              subtitle: `Lv${u.level} · ${u.address.slice(0, 10)}… · ${(u.arenaBalance ?? 0).toFixed(3)} pETH`,
              module: "users",
              href: `/admin?module=users&user=${u.address}`,
            });
          }
        }

      for (const r of store.rounds.values()) {
        if (hits.length > 90) break;
        if (match(r.token.symbol, r.token.name, r.id)) {
          hits.push({
            kind: "coin",
            id: r.id,
            title: `$${r.token.symbol} — ${r.token.name}`,
            subtitle: `${r.matchType === "pit" ? "Pit" : r.mode ?? r.tier} · ${r.state}${
              r.pool ? ` · mc ${marketCap(r.pool).toFixed(2)}` : ""
            }`,
            module: "game",
            href: `/round/${r.id}`,
          });
        }
      }

      if (can("staff.view"))
        for (const s of staffService.list())
          if (match(s.username, s.displayName))
            hits.push({
              kind: "staff",
              id: s.id,
              title: s.displayName ?? s.username,
              subtitle: `${ROLE_MAP[s.role]?.label ?? s.role}${s.disabled ? " · disabled" : ""}`,
              module: "team",
            });

      if (can("flags.manage"))
        for (const f of FEATURE_FLAGS)
          if (match(f.key, f.label, f.description))
            hits.push({
              kind: "flag",
              id: f.key,
              title: f.label,
              subtitle: `${store.flag(f.key) ? "on" : "off"} · ${f.description}`,
              module: "flags",
            });

      // Settings are searched by their JSON path, so "pitFeeBps" finds the knob.
      for (const path of settingPaths(store.settings))
        if (path.toLowerCase().includes(q))
          hits.push({ kind: "setting", id: path, title: path, subtitle: "Game configuration", module: "game" });

      if (can("audit.view"))
        for (const e of [...store.auditLog].reverse().slice(0, 400))
          if (match(e.action, e.target, e.actorName))
            hits.push({
              kind: "audit",
              id: e.id,
              title: e.action,
              subtitle: `${e.actorName}${e.target ? ` · ${e.target}` : ""} · ${new Date(e.at).toLocaleString()}`,
              module: "audit",
            });

      for (const m of CC_MODULES)
        if (m.label.toLowerCase().includes(q))
          hits.push({ kind: "module", id: m.key, title: m.label, subtitle: "Command Center module", module: m.key });

      res.json({ hits: hits.slice(0, 40) });
    }),
  );

  // ------------------------------------------------------------------ backups

  /** Export the full configuration set — settings, flags and team (hash-free). */
  app.get(
    "/api/cc/backup/export",
    gate("backups.manage"),
    wrap((req, res) => {
      audit(store, req, { module: "backups", action: "config.export" });
      res.json({
        exportedAt: Date.now(),
        version: 1,
        settings: store.settings,
        featureFlags: store.featureFlags,
        staff: staffService.list().map(StaffService.toPublic),
      });
    }),
  );

  /**
   * Import a configuration export. Settings and flags only — accounts are never
   * restored from a file, because a backup carries no password hashes and
   * silently reviving a deleted operator is exactly the kind of thing an ops
   * tool should refuse to do quietly.
   */
  app.post(
    "/api/cc/backup/import",
    gate("backups.manage"),
    wrap((req, res) => {
      const body = req.body as { settings?: unknown; featureFlags?: Record<string, boolean> };
      const before = { settings: structuredClone(store.settings), flags: { ...store.featureFlags } };
      if (body.settings && typeof body.settings === "object")
        Object.assign(store.settings, body.settings);
      if (body.featureFlags && typeof body.featureFlags === "object") {
        for (const [k, v] of Object.entries(body.featureFlags))
          if (FEATURE_FLAGS.some((f) => f.key === k) && typeof v === "boolean") store.featureFlags[k] = v;
      }
      audit(store, req, {
        module: "backups",
        action: "config.import",
        before,
        after: { settings: store.settings, flags: store.featureFlags },
        note: "staff accounts are never imported",
      });
      res.json({ ok: true, settings: store.settings, flags: store.flags() });
    }),
  );

  return staffService;
}

/** Module registry — drives the nav, the search, and permission gating. */
export const CC_MODULES: Array<{
  key: CcModule;
  label: string;
  icon: string;
  /** Permission needed to see the module at all. */
  permission?: Permission;
}> = [
  { key: "dashboard", label: "Dashboard", icon: "📊" },
  { key: "users", label: "Players", icon: "👥", permission: "users.view" },
  { key: "game", label: "Game Configuration", icon: "🎛️", permission: "game.config" },
  { key: "economy", label: "Economy & BURGERS", icon: "🍔", permission: "game.config" },
  { key: "content", label: "Quests & Content", icon: "📜", permission: "content.manage" },
  { key: "branding", label: "Branding", icon: "🎨", permission: "assets.manage" },
  { key: "themes", label: "Theme Studio", icon: "🎭", permission: "themes.manage" },
  { key: "media", label: "Media Library", icon: "🖼️", permission: "assets.manage" },
  { key: "audio", label: "Audio Manager", icon: "🔊", permission: "assets.manage" },
  { key: "telegram", label: "Telegram", icon: "✈️", permission: "telegram.manage" },
  { key: "goons", label: "Flame Goon Squad", icon: "🔥", permission: "content.manage" },
  { key: "nft", label: "NFTs", icon: "🃏", permission: "content.manage" },
  { key: "moderation", label: "Moderation", icon: "🛡️", permission: "users.moderate" },
  { key: "analytics", label: "Analytics", icon: "📈", permission: "analytics.view" },
  { key: "flags", label: "Feature Flags", icon: "🚩", permission: "flags.manage" },
  { key: "team", label: "Team", icon: "🔑", permission: "staff.view" },
  { key: "audit", label: "Audit Log", icon: "📋", permission: "audit.view" },
  { key: "backups", label: "Backups", icon: "💾", permission: "backups.manage" },
];

function mustStaff(service: StaffService, id: string): StoredStaff {
  const account = service.byId(id);
  if (!account) throw new CcError(404, "no such staff account");
  return account;
}

/** Active owners other than `excludeId` — the last-owner guard. */
function countActiveOwners(service: StaffService, excludeId: string): number {
  return service.list().filter((s) => s.role === "owner" && !s.disabled && s.id !== excludeId).length;
}

function sanitizePerms(list: Permission[] | undefined): Permission[] {
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
}

/** Flatten a settings object into dotted paths, for the global search. */
function settingPaths(obj: unknown, prefix = "", depth = 0): string[] {
  if (depth > 3 || !obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push(path);
    out.push(...settingPaths(v, path, depth + 1));
  }
  return out;
}

/** Read a dotted path out of an object, or undefined when it doesn't exist. */
function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Write a dotted path. Only ever called after readPath proved it exists. */
function writePath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  let cur: unknown = obj;
  for (const key of keys) cur = (cur as Record<string, unknown>)[key];
  (cur as Record<string, unknown>)[last] = value;
}

/** Accept a CSS colour the browser will actually understand. Deliberately
 *  narrow: hex, rgb/rgba and hsl/hsla. A theme is styling, not a script. */
function colorProblem(value: unknown): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null; // empty = fall back to the built-in default
  if (v.length > 40) return "too long to be a colour";
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return null;
  if (/^(rgb|hsl)a?\([0-9.,\s%/-]+\)$/i.test(v)) return null;
  return "expected a hex, rgb() or hsl() colour";
}

function clamp01(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(0, v));
}
