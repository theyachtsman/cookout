/**
 * Phase 2 compliance controls.
 *
 * WHAT THIS CAN AND CANNOT DO — read before relying on it.
 *
 * Chain rounds are non-custodial and permissionless: players trade from their
 * own wallets straight against the round contracts, and the server only mirrors
 * what already happened. No server-side check can stop an on-chain trade, and
 * anything claiming otherwise would be theatre.
 *
 * What the platform genuinely controls is the front door and the parts it
 * operates itself:
 *   - the session (no session, no site, no round data, no UI)
 *   - coin creation (createRound is signed by the platform's operator key)
 *   - which address a creator's fee stream is pointed at
 *
 * So the gates live there. That is also how the controls should be described
 * externally: access control over an interface, not custody over funds.
 *
 * Nothing here is legal advice, and none of these defaults have been reviewed
 * by counsel. They are the technical scaffolding a review would need to exist.
 */

/** A single evaluated decision about one visitor. */
export interface ComplianceDecision {
  allowed: boolean;
  /** Machine-readable cause, for audit rows and tests. */
  reason?:
    | "blocked_region"
    | "sanctioned_address"
    | "self_excluded"
    | "terms_not_accepted"
    | "unknown_region";
  /** Player-facing explanation. Deliberately plain and non-negotiable. */
  message?: string;
  /** When a self-exclusion lifts, if that is the cause. */
  until?: number;
}

export interface ComplianceSettings {
  /** Master switch. Off on the paper beta, on for real funds. */
  enabled: boolean;
  /** ISO 3166-1 alpha-2 codes refused entry. */
  blockedCountries: string[];
  /** Sub-national blocks, as "US-NY" style codes, for states/provinces. */
  blockedRegions: string[];
  /**
   * Refuse visitors whose country can't be determined. Fails closed, which is
   * correct for a licensing gate and wrong for a normal product — a proxy or a
   * missing header shouldn't quietly become an exemption.
   */
  blockUnknownRegion: boolean;
  /** Wallet addresses refused entry (sanctions lists, law-enforcement notices). */
  deniedAddresses: string[];
  /** Bump to force everyone to re-accept the terms. */
  termsVersion: number;
  /** Minimum self-attested age. */
  minimumAge: number;
  /** Self-exclusion durations offered to players, in days. */
  selfExclusionDays: number[];
  /** Halt everything the platform itself signs (coin creation). Rounds already
   *  on-chain keep running — nothing here can or should stop them. */
  haltNewLaunches: boolean;
}

/**
 * Comprehensively sanctioned jurisdictions (OFAC country programmes).
 *
 * The starting point, not the answer. Whether to add the US — or specific
 * states — is a licensing question about your own operation, not something a
 * default can decide. Left out on purpose so the choice is explicit.
 */
export const OFAC_COMPREHENSIVE = ["CU", "IR", "KP", "SY", "RU", "BY"] as const;

export function freshComplianceSettings(): ComplianceSettings {
  return {
    enabled: false,
    blockedCountries: [...OFAC_COMPREHENSIVE],
    blockedRegions: [],
    blockUnknownRegion: false,
    deniedAddresses: [],
    termsVersion: 1,
    minimumAge: 18,
    selfExclusionDays: [1, 7, 30, 90, 365],
    haltNewLaunches: false,
  };
}

/** Merge stored settings over defaults so new fields appear without clobbering. */
export function mergeComplianceSettings(
  stored: Partial<ComplianceSettings> | undefined,
): ComplianceSettings {
  const base = freshComplianceSettings();
  if (!stored) return base;
  return {
    ...base,
    ...stored,
    blockedCountries: stored.blockedCountries ?? base.blockedCountries,
    blockedRegions: stored.blockedRegions ?? base.blockedRegions,
    deniedAddresses: stored.deniedAddresses ?? base.deniedAddresses,
    selfExclusionDays: stored.selfExclusionDays ?? base.selfExclusionDays,
  };
}

/** What we know about whoever is asking. */
export interface Visitor {
  /** ISO 3166-1 alpha-2, or undefined when it can't be resolved. */
  country?: string;
  /** ISO 3166-2 subdivision ("NY"), when the edge provides one. */
  region?: string;
  address?: string;
  /** Terms version this account has accepted, if any. */
  acceptedTerms?: number;
  /** Self-exclusion expiry, if the player set one. */
  excludedUntil?: number;
}

const ALLOW: ComplianceDecision = { allowed: true };

/**
 * The whole decision, as one pure function.
 *
 * Pure because this is the rule that decides whether a real person can use the
 * product: it should be readable end to end, testable without a server, and
 * identical everywhere it runs.
 *
 * Order matters. Sanctions and region are checked before self-exclusion and
 * terms, so a blocked visitor is never told "just accept the terms" — that
 * would read as a workaround.
 */
export function evaluateCompliance(
  settings: ComplianceSettings,
  visitor: Visitor,
  now = Date.now(),
): ComplianceDecision {
  if (!settings.enabled) return ALLOW;

  const address = visitor.address?.toLowerCase();
  if (address && settings.deniedAddresses.some((a) => a.toLowerCase() === address))
    return {
      allowed: false,
      reason: "sanctioned_address",
      message: "This wallet can't be used here. If you believe that's an error, contact support.",
    };

  const country = visitor.country?.toUpperCase();
  if (!country) {
    if (settings.blockUnknownRegion)
      return {
        allowed: false,
        reason: "unknown_region",
        message:
          "We couldn't determine your location, and access is limited by region. Turn off any VPN or proxy and try again.",
      };
  } else {
    if (settings.blockedCountries.some((c) => c.toUpperCase() === country))
      return {
        allowed: false,
        reason: "blocked_region",
        message: "The Cook Out isn't available in your region.",
      };
    const sub = visitor.region ? `${country}-${visitor.region.toUpperCase()}` : undefined;
    if (sub && settings.blockedRegions.some((r) => r.toUpperCase() === sub))
      return {
        allowed: false,
        reason: "blocked_region",
        message: "The Cook Out isn't available in your region.",
      };
  }

  if (visitor.excludedUntil && visitor.excludedUntil > now)
    return {
      allowed: false,
      reason: "self_excluded",
      until: visitor.excludedUntil,
      message: `You've self-excluded until ${new Date(visitor.excludedUntil).toLocaleDateString()}. We can't lift it early.`,
    };

  if ((visitor.acceptedTerms ?? 0) < settings.termsVersion)
    return {
      allowed: false,
      reason: "terms_not_accepted",
      message: "Please review and accept the terms to continue.",
    };

  return ALLOW;
}

/** One acceptance, recorded. Kept per account for the audit trail. */
export interface TermsAcceptance {
  version: number;
  at: number;
  /** Where they were when they accepted — the fact under dispute later. */
  country?: string;
  ageAttested: number;
}
