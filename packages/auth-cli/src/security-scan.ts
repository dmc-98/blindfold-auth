/**
 * Security configuration scanner — the static half of `blindfold doctor`.
 *
 * Pure function over an env map (injectable for tests; the CLI passes
 * process.env) so every check is unit-testable without spawning anything.
 * Complements the runtime smoke in @dmc--98/blindfold-mcp/doctor: the smoke
 * proves the integration works, this proves the deployment isn't footgunned.
 *
 * Severities: critical (exploitable / broken-by-config), warning (risky
 * default worth fixing before production), info (hygiene).
 */

export interface SecurityFinding {
  code: string;
  severity: "critical" | "warning" | "info";
  message: string;
  fix: string;
}

const PLACEHOLDER_FRAGMENTS = ["changeme", "change-me", "example", "secret", "password", "blindfold-dev", "doctor-secret", "test-", "dev-"];
const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARS = 10;

export function scanSecurityConfig(env: Record<string, string | undefined>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const isProduction = env.NODE_ENV === "production";

  // ── Secret quality ─────────────────────────────────────────────────────────
  const secret = env.BLINDFOLD_SECRET;
  if (!secret) {
    findings.push({
      code: "secret-missing",
      severity: "critical",
      message: "BLINDFOLD_SECRET is not set — sessions and tokens cannot be signed safely.",
      fix: "Set BLINDFOLD_SECRET to a random value: export BLINDFOLD_SECRET=$(openssl rand -hex 32)",
    });
  } else {
    const lower = secret.toLowerCase();
    if (PLACEHOLDER_FRAGMENTS.some((p) => lower.includes(p))) {
      findings.push({
        code: "secret-placeholder",
        severity: "critical",
        message: "BLINDFOLD_SECRET looks like a placeholder or example value.",
        fix: "Generate a unique random secret: openssl rand -hex 32 — never reuse documentation values.",
      });
    }
    if (secret.length < MIN_SECRET_LENGTH) {
      findings.push({
        code: "secret-too-short",
        severity: "critical",
        message: `BLINDFOLD_SECRET is ${secret.length} characters; minimum recommended is ${MIN_SECRET_LENGTH}.`,
        fix: "Generate a longer secret: openssl rand -hex 32 (64 hex characters).",
      });
    } else if (new Set(secret).size < MIN_DISTINCT_CHARS) {
      findings.push({
        code: "secret-low-entropy",
        severity: "critical",
        message: "BLINDFOLD_SECRET has very low character diversity (likely a repeated or patterned value).",
        fix: "Use a cryptographically random secret: openssl rand -hex 32",
      });
    }
  }

  // ── Database transport & credentials ──────────────────────────────────────
  const dbUrl = env.BLINDFOLD_DATABASE_URL;
  if (dbUrl) {
    if (/sslmode=disable/i.test(dbUrl) || (isProduction && !/sslmode=(require|verify-ca|verify-full)/i.test(dbUrl) && !/[?&]ssl=true/i.test(dbUrl))) {
      findings.push({
        code: "db-tls-disabled",
        severity: isProduction ? "critical" : "warning",
        message: "BLINDFOLD_DATABASE_URL does not enforce TLS — credentials and session data travel in cleartext.",
        fix: "Append sslmode=verify-full (or at minimum sslmode=require) to the connection string.",
      });
    }
    if (/\/\/(postgres|root|admin):(postgres|root|admin|password)@/i.test(dbUrl)) {
      findings.push({
        code: "db-default-credentials",
        severity: "critical",
        message: "BLINDFOLD_DATABASE_URL uses well-known default credentials.",
        fix: "Create a dedicated database role with a unique password and least privileges for the auth schema.",
      });
    }
  } else if (isProduction) {
    findings.push({
      code: "prod-no-database",
      severity: "warning",
      message: "NODE_ENV=production but BLINDFOLD_DATABASE_URL is not set — the workspace would fall back to file/memory storage.",
      fix: "Point BLINDFOLD_DATABASE_URL at the production Postgres lane (see docs/contracts/CONFIG_CONTRACT.md).",
    });
  }

  // ── Studio exposure ────────────────────────────────────────────────────────
  const studioHost = env.BLINDFOLD_STUDIO_HOST;
  if (studioHost && studioHost !== "127.0.0.1" && studioHost !== "localhost") {
    findings.push({
      code: "studio-exposed",
      severity: "warning",
      message: `Studio is configured to bind ${studioHost} — the operator UI would be reachable beyond localhost.`,
      fix: "Keep BLINDFOLD_STUDIO_HOST=127.0.0.1 and reach Studio over an SSH tunnel or VPN instead of exposing it.",
    });
  }

  // ── Workspace identity hygiene ────────────────────────────────────────────
  if (isProduction && (env.BLINDFOLD_WORKSPACE_ID === undefined || env.BLINDFOLD_WORKSPACE_ID === "workspace_local")) {
    findings.push({
      code: "workspace-default-id",
      severity: "info",
      message: "Production is using the default workspace id (workspace_local).",
      fix: "Set BLINDFOLD_WORKSPACE_ID to a unique, environment-specific identifier.",
    });
  }

  return findings;
}

/** True when any finding is critical — used by the CLI for its exit code. */
export function hasCriticalFinding(findings: SecurityFinding[]): boolean {
  return findings.some((f) => f.severity === "critical");
}
