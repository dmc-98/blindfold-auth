export const TABLES = [
  "workspace_config",
  "applications",
  "application_auth_config",
  "identity_providers",
  "application_identity_providers",
  "principals",
  "application_principals",
  "memberships",
  "roles",
  "role_permissions",
  "policy_rules",
  "direct_grants",
  "policy_versions",
  "webauthn_credentials",
  "federated_identities",
  "sessions",
  "revocations",
  "rate_limit_counters",
  "risk_events",
  "audit_events",
  "auth_challenges"
] as const;

export type TableName = (typeof TABLES)[number];

export const DEFAULT_SESSION_CONFIG = {
  accessTokenTtl: "15m",
  refreshTokenTtl: "30d",
  rotationGraceMs: 30_000
};

export const DEFAULT_SECURITY_CONFIG = {
  rateLimits: {
    login: { limit: 5, windowMs: 10 * 60_000, blockMs: 15 * 60_000 },
    api: { limit: 100, windowMs: 60_000, blockMs: 60_000 }
  },
  magicLinks: {
    returnTokenInResponse: false,
    requireRelativeRedirects: true
  },
  /**
   * Opt-in HIBP k-anonymity breach check on registration/password set.
   * true for defaults, or an options object ({ fetchImpl, apiBase,
   * timeoutMs }) passed through to checkPasswordBreached. Fail-open on
   * HIBP outages by design.
   */
  breachPasswordCheck: false
};

export const DEFAULT_AUTH_METHODS = {
  password: true,
  magicLink: true,
  passkey: true,
  oidc: true,
  saml: true,
  totp: true
};
