/**
 * sso doctor — static analysis of IdP metadata (PRD: SSO recipes <30 min).
 *
 * Catches the misconfigurations that burn the first half hour of every SSO
 * integration: expired/expiring signing certs, http endpoints, missing PKCE,
 * alg:none, absent SSO endpoints. Pure function over metadata content so
 * every check is unit-testable; the CLI handles fetching with an SSRF guard
 * (threat model: hostile metadata URLs pivoting into the internal network).
 */
import { X509Certificate } from "node:crypto";
import type { SecurityFinding } from "./security-scan.js";

const CERT_EXPIRY_WARNING_DAYS = 30;

function finding(code: string, severity: SecurityFinding["severity"], message: string, fix: string): SecurityFinding {
  return { code, severity, message, fix };
}

function isHttps(url: unknown): boolean {
  return typeof url === "string" && url.startsWith("https://");
}

function analyzeOidc(doc: Record<string, unknown>): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (!doc.issuer) {
    findings.push(finding("oidc-no-issuer", "critical", "Discovery document has no issuer.", "Verify the URL points at /.well-known/openid-configuration of the IdP."));
  }
  for (const key of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    const value = doc[key];
    if (value === undefined) {
      if (key !== "issuer") findings.push(finding(`oidc-missing-${key}`, "critical", `Discovery document is missing ${key}.`, "The IdP discovery document must define it; check the IdP configuration."));
    } else if (!isHttps(value)) {
      findings.push(finding("endpoint-not-https", "critical", `${key} is not https (${String(value)}).`, "All OIDC endpoints must be served over TLS."));
    }
  }
  const algs = (doc.id_token_signing_alg_values_supported as string[] | undefined) ?? [];
  if (algs.includes("none")) {
    findings.push(finding("oidc-alg-none", "critical", 'IdP advertises id_token signing alg "none".', "Disable the 'none' algorithm on the IdP — unsigned id_tokens are forgeable."));
  }
  const pkce = (doc.code_challenge_methods_supported as string[] | undefined) ?? [];
  if (!pkce.includes("S256")) {
    findings.push(finding("oidc-no-pkce", "warning", "IdP does not advertise PKCE S256 support.", "Enable PKCE (S256) on the IdP; it protects the code exchange even for confidential clients."));
  }
  return findings;
}

function analyzeSaml(xml: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  if (!/entityID\s*=\s*"[^"]+"/.test(xml)) {
    findings.push(finding("saml-no-entity-id", "critical", "SAML metadata has no entityID.", "Export metadata from the IdP rather than hand-writing it."));
  }
  const certMatch = xml.match(/<(?:[\w]+:)?X509Certificate>([\s\S]*?)<\/(?:[\w]+:)?X509Certificate>/);
  if (!certMatch) {
    findings.push(finding("saml-no-signing-cert", "critical", "SAML metadata contains no X509 signing certificate.", "Responses can't be verified without the IdP signing cert; re-export metadata with the signing key."));
  } else {
    const pem = `-----BEGIN CERTIFICATE-----\n${certMatch[1].replace(/\s+/g, "").replace(/(.{64})/g, "$1\n")}\n-----END CERTIFICATE-----`;
    try {
      const cert = new X509Certificate(pem);
      const expires = new Date(cert.validTo).getTime();
      const daysLeft = Math.floor((expires - Date.now()) / 86_400_000);
      if (daysLeft < 0) {
        findings.push(finding("cert-expired", "critical", `IdP signing certificate expired ${-daysLeft} day(s) ago (${cert.validTo}).`, "Rotate the IdP signing certificate and re-import metadata."));
      } else if (daysLeft < CERT_EXPIRY_WARNING_DAYS) {
        findings.push(finding("cert-expiring-soon", "warning", `IdP signing certificate expires in ${daysLeft} day(s) (${cert.validTo}).`, "Plan a certificate rotation now to avoid an outage."));
      }
    } catch {
      findings.push(finding("cert-unparseable", "warning", "The X509Certificate in the metadata could not be parsed.", "Re-export metadata from the IdP; the certificate block may be corrupted."));
    }
  }
  const sso = xml.match(/<(?:[\w]+:)?SingleSignOnService[^>]*Location\s*=\s*"([^"]+)"/);
  if (!sso) {
    findings.push(finding("saml-no-sso-endpoint", "critical", "SAML metadata defines no SingleSignOnService endpoint.", "The IdP metadata must include at least one HTTP-Redirect or HTTP-POST SSO binding."));
  } else if (!isHttps(sso[1])) {
    findings.push(finding("endpoint-not-https", "critical", `SingleSignOnService location is not https (${sso[1]}).`, "SSO endpoints must be served over TLS."));
  }
  return findings;
}

export function analyzeSsoMetadata({ content }: { content: string }): SecurityFinding[] {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      return analyzeOidc(JSON.parse(trimmed));
    } catch {
      return [finding("metadata-unrecognized", "critical", "Content looks like JSON but does not parse.", "Fetch the discovery document directly from /.well-known/openid-configuration.")];
    }
  }
  if (trimmed.includes("EntityDescriptor") || trimmed.startsWith("<")) {
    return analyzeSaml(trimmed);
  }
  return [finding("metadata-unrecognized", "critical", "Content is neither an OIDC discovery document nor SAML metadata.", "Pass the IdP's discovery JSON or metadata XML (file or URL).")];
}

/**
 * SSRF guard for metadata URLs. Returns null when safe, else a reason.
 * Blocks plain http and obvious private/loopback/link-local targets by
 * pattern; DNS-resolution pinning is a future hardening step (documented
 * in the threat model).
 */
export function checkSsoUrlSafety(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "https:") return "metadata must be fetched over https";
  const host = url.hostname.toLowerCase();
  const privatePatterns = [
    /^localhost$/,
    /^127\./, /^0\./, /^10\./, /^192\.168\./, /^169\.254\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^\[?::1\]?$/, /^\[?fc/, /^\[?fe80/,
  ];
  if (privatePatterns.some((p) => p.test(host))) return `host ${host} is private or loopback — refusing to fetch (SSRF guard)`;
  return null;
}

export async function fetchSsoMetadata(rawUrl: string): Promise<string> {
  const unsafe = checkSsoUrlSafety(rawUrl);
  if (unsafe) throw new Error(unsafe);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(rawUrl, { redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`metadata fetch failed: HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 1_000_000) throw new Error("metadata larger than 1MB — refusing to parse");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
