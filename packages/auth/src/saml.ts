import { SAML } from "@node-saml/node-saml";
import { normalizeEmail } from "./utils.js";

function formatPemCertificate(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  if (raw.includes("BEGIN CERTIFICATE")) {
    return raw;
  }

  const body = raw.replace(/\s+/g, "");
  return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join("\n") || body}\n-----END CERTIFICATE-----`;
}

export interface CreateSamlClientInput {
  application: any;
  provider: any;
  binding: any;
  callbackUrl: string;
  cacheProvider?: any;
  requestId?: string;
  validateInResponseTo?: "never" | "ifPresent" | "always";
}

export function createSamlClient({
  application,
  provider,
  binding,
  callbackUrl,
  cacheProvider,
  requestId = undefined,
  validateInResponseTo = binding.allowIdpInitiated ? "ifPresent" : "always"
}: CreateSamlClientInput): SAML {
  const entryPoint = binding.ssoUrl || provider.ssoUrl;
  if (!entryPoint) {
    throw new Error("SAML provider is missing ssoUrl");
  }

  const idpCert = formatPemCertificate(provider.x509Certificate || binding.x509Certificate);
  if (!idpCert) {
    throw new Error("SAML provider is missing x509Certificate");
  }

  const issuer = binding.entityId || `${application.slug || application.id}-blindfold-sp`;

  return new SAML({
    callbackUrl,
    entryPoint,
    issuer,
    audience: binding.audience || issuer,
    idpCert,
    idpIssuer: provider.issuer || undefined,
    cacheProvider,
    validateInResponseTo: validateInResponseTo as any,
    requestIdExpirationPeriodMs: 10 * 60_000,
    acceptedClockSkewMs: 60_000,
    authnRequestBinding: binding.authnRequestBinding,
    generateUniqueId: requestId ? () => requestId : undefined,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true
  } as any);
}

export function samlProfileToClaims(profile: Record<string, any> = {}): Record<string, any> {
  const email =
    normalizeEmail(
      profile.email ||
        profile.mail ||
        profile["urn:oid:0.9.2342.19200300.100.1.3"] ||
        profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] ||
        ""
    ) || null;

  return {
    sub: profile.nameID || profile.nameId || email || null,
    email,
    name:
      profile.displayName ||
      profile.cn ||
      profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] ||
      profile.nameID ||
      email,
    issuer: profile.issuer || null,
    nameID: profile.nameID || null,
    ...profile
  };
}
