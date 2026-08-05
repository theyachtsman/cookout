import type { Request } from "express";
import {
  evaluateCompliance,
  mergeComplianceSettings,
  type ComplianceDecision,
  type ComplianceSettings,
  type TermsAcceptance,
  type Visitor,
} from "@cookout/shared";
import type { Store } from "./store.js";

/**
 * Where compliance is actually enforced.
 *
 * The gate is the session, not the trade. Chain rounds are non-custodial and
 * permissionless — a player's buy goes from their wallet to the round contract
 * without touching this server — so no check here can stop one, and pretending
 * otherwise would be worse than not having the control at all.
 *
 * Two things the platform really does control, and so really can gate:
 *   1. the session, which is the only way to reach the site or its data;
 *   2. coin creation, which the platform signs with its own operator key.
 *
 * Everything else is downstream of those.
 */

/**
 * Resolve the visitor's location from edge headers.
 *
 * Cloudflare sits in front of the API (see DEPLOYMENT.md), and CF-IPCountry is
 * added by the edge, not the client — a browser cannot forge it, whereas
 * anything self-reported could be typed by hand. A VPN still defeats it; that
 * is a known and accepted limit of geo-gating, not a bug to fix here.
 */
export function locationOf(req: Request): { country?: string; region?: string } {
  const header = (name: string): string | undefined => {
    const raw = req.headers[name];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && value !== "XX" && value !== "T1" ? value : undefined;
  };
  return {
    country: header("cf-ipcountry")?.toUpperCase(),
    region: header("cf-region-code")?.toUpperCase(),
  };
}

export class ComplianceService {
  constructor(private store: Store) {}

  settings(): ComplianceSettings {
    return mergeComplianceSettings(this.store.settings.compliance);
  }

  save(next: Partial<ComplianceSettings>): ComplianceSettings {
    const merged = mergeComplianceSettings({ ...this.settings(), ...next });
    this.store.settings.compliance = merged;
    return merged;
  }

  /** Everything known about the caller, ready to evaluate. */
  visitorFor(req: Request, address?: string): Visitor {
    const user = address ? this.store.users.get(address.toLowerCase() as never) : undefined;
    return {
      ...locationOf(req),
      address,
      acceptedTerms: user?.termsAccepted?.version,
      excludedUntil: user?.excludedUntil,
    };
  }

  check(req: Request, address?: string, now = Date.now()): ComplianceDecision {
    return evaluateCompliance(this.settings(), this.visitorFor(req, address), now);
  }

  /**
   * Record an acceptance. Stores where they were and what age they attested,
   * because those are the facts anyone would later ask about, and neither can
   * be reconstructed after the fact.
   */
  acceptTerms(address: string, req: Request, ageAttested: number): TermsAcceptance {
    const settings = this.settings();
    const user = this.store.getOrCreateUser(address as never);
    const record: TermsAcceptance = {
      version: settings.termsVersion,
      at: Date.now(),
      country: locationOf(req).country,
      ageAttested,
    };
    user.termsAccepted = record;
    this.store.logAdmin(
      "compliance",
      `${address} accepted terms v${record.version} (age ${ageAttested}${
        record.country ? `, ${record.country}` : ""
      })`,
    );
    return record;
  }

  /**
   * Self-exclude for a number of days.
   *
   * One-way on purpose: it can be extended but never shortened, and there is no
   * staff route to lift one. A self-exclusion an operator can reverse on
   * request is not a self-exclusion — the entire value is that the decision
   * cannot be undone by the person in the moment they most want to undo it.
   */
  selfExclude(address: string, days: number): number {
    const settings = this.settings();
    if (!settings.selfExclusionDays.includes(days))
      throw new Error(`choose one of: ${settings.selfExclusionDays.join(", ")} days`);
    const user = this.store.getOrCreateUser(address as never);
    const until = Date.now() + days * 86_400_000;
    user.excludedUntil = Math.max(user.excludedUntil ?? 0, until);
    this.store.logAdmin(
      "compliance",
      `${address} self-excluded for ${days} days (until ${new Date(user.excludedUntil).toISOString()})`,
    );
    return user.excludedUntil;
  }
}
