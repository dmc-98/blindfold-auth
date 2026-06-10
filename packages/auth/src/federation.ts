import { escapeXml, normalizeEmail } from "./utils.js";

export function getEmailDomain(email: unknown): string | null {
  const normalized = normalizeEmail(email);
  const parts = normalized.split("@");
  return parts.length === 2 ? parts[1]! : null;
}

export interface MapFederationClaimsInput {
  claims?: Record<string, any>;
  claimMappings?: Record<string, string>;
}

export function mapFederationClaims({ claims = {}, claimMappings = {} }: MapFederationClaimsInput): {
  subject: any;
  email: string;
  displayName: any;
  rawClaims: Record<string, any>;
} {
  const subjectPath = claimMappings.subject || "sub";
  const emailPath = claimMappings.email || "email";
  const displayNamePath = claimMappings.displayName || "name";

  return {
    subject: claims?.[subjectPath] ?? claims?.sub ?? null,
    email: normalizeEmail(claims?.[emailPath] ?? claims?.email ?? ""),
    displayName: claims?.[displayNamePath] ?? claims?.name ?? claims?.preferred_username ?? null,
    rawClaims: claims
  };
}

export interface ResolveProviderChoiceInput {
  bindings: any[];
  providersById: Map<string, any>;
  protocol: string;
  providerId?: string | null;
  email?: string | null;
}

export interface ProviderChoice {
  binding?: any;
  provider?: any;
  multiple: boolean;
  choices?: Array<{ bindingId: string; providerId: string; providerName: string; domains: string[] }>;
}

export function resolveProviderChoice({ bindings, providersById, protocol, providerId = null, email = null }: ResolveProviderChoiceInput): ProviderChoice {
  const protocolBindings = bindings.filter((binding) => {
    const provider = providersById.get(binding.providerId);
    return binding.enabled !== false && provider?.type === protocol && provider?.status !== "disabled";
  });
  if (providerId) {
    const binding = protocolBindings.find((entry) => entry.providerId === providerId || entry.id === providerId);
    if (!binding) {
      throw new Error("Provider binding not found");
    }

    return {
      binding,
      provider: providersById.get(binding.providerId),
      multiple: false
    };
  }

  const domain = getEmailDomain(email);
  if (!domain) {
    throw new Error("Email is required for domain-based provider routing");
  }

  const matches = protocolBindings.filter((binding) => (binding.domains || []).includes(domain));
  if (matches.length === 0) {
    throw new Error("No identity provider binding matches the requested domain");
  }

  if (matches.length > 1) {
    return {
      multiple: true,
      choices: matches.map((binding) => ({
        bindingId: binding.id,
        providerId: binding.providerId,
        providerName: providersById.get(binding.providerId)?.name || binding.providerId,
        domains: binding.domains || []
      }))
    };
  }

  return {
    binding: matches[0],
    provider: providersById.get(matches[0]!.providerId),
    multiple: false
  };
}

export interface BuildOidcRedirectInput {
  provider: any;
  binding: any;
  state: string;
  nonce: string;
  redirectUri: string;
  loginHint?: string;
  scope?: string | null;
  codeChallenge?: string | null;
}

export function buildOidcRedirectUrl({
  provider,
  binding,
  state,
  nonce,
  redirectUri,
  loginHint = "",
  scope = null,
  codeChallenge = null
}: BuildOidcRedirectInput): string | null {
  const authorizationUrl = provider.authorizationUrl || provider.authorizationEndpoint || binding.authorizationUrl;
  if (!authorizationUrl) {
    return null;
  }

  const url = new URL(authorizationUrl, "http://localhost");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  if (provider.clientId || binding.clientId) {
    url.searchParams.set("client_id", provider.clientId || binding.clientId);
  }
  if (scope) {
    url.searchParams.set("scope", scope);
  }
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (loginHint) {
    url.searchParams.set("login_hint", loginHint);
  }
  return authorizationUrl.startsWith("http") ? url.toString() : `${url.pathname}${url.search}`;
}

export interface BuildSamlMetadataInput {
  application: any;
  provider: any;
  binding: any;
  callbackUrl: string;
}

export function buildSamlMetadata({ application, provider, binding, callbackUrl }: BuildSamlMetadataInput): string {
  const entityId = binding.entityId || `${application.slug || application.id}-blindfold-sp`;
  const certificate = provider.x509Certificate || binding.x509Certificate || "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(entityId)}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(callbackUrl)}" index="1" isDefault="true" />
    ${certificate ? `<KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${escapeXml(certificate)}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>` : ""}
  </SPSSODescriptor>
  <Organization>
    <OrganizationName xml:lang="en">${escapeXml(application.name || "Blindfold Auth")}</OrganizationName>
  </Organization>
</EntityDescriptor>`;
}
