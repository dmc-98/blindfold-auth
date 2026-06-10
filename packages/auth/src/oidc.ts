import * as oidc from "openid-client";

function asUrl(value: unknown): URL | null {
  if (!value) {
    return null;
  }

  return value instanceof URL ? value : new URL(String(value));
}

function shouldAllowInsecureRequests(url: unknown, provider: any = {}): boolean {
  const parsedUrl = asUrl(url);
  if (!parsedUrl) {
    return false;
  }

  return provider.allowInsecureDiscovery === true || ["localhost", "127.0.0.1"].includes(parsedUrl.hostname);
}

export interface DiscoverOidcInput {
  cache: Map<string, any>;
  provider: any;
  binding: any;
  customFetch?: typeof fetch;
}

export async function discoverOidcConfiguration({ cache, provider, binding, customFetch = undefined }: DiscoverOidcInput): Promise<any> {
  const issuerUrl = provider.discoveryUrl || provider.issuer;
  if (!issuerUrl) {
    throw new Error("OIDC provider is missing issuer or discoveryUrl");
  }

  const clientId = binding.clientId || provider.clientId;
  if (!clientId) {
    throw new Error("OIDC provider is missing clientId");
  }

  const cacheKey = [provider.id, provider.updatedAt || "", binding.id, binding.updatedAt || "", issuerUrl, clientId].join(":");

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const options: { execute?: Array<(config: any) => void> } = {};
  if (shouldAllowInsecureRequests(issuerUrl, provider)) {
    options.execute = [oidc.allowInsecureRequests];
  }

  const promise = oidc
    .discovery(asUrl(issuerUrl)!, clientId, provider.clientSecret || undefined, undefined, options)
    .then((configuration: any) => {
      if (customFetch) {
        configuration[oidc.customFetch] = customFetch;
      }

      return configuration;
    });

  cache.set(cacheKey, promise);
  return promise;
}

export interface BuildOidcAuthInput {
  configuration: any;
  redirectUri: string;
  loginHint?: string | null;
  scope?: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export async function buildOidcAuthorizationRequest({
  configuration,
  redirectUri,
  loginHint = null,
  scope = "openid profile email",
  state,
  nonce,
  codeVerifier
}: BuildOidcAuthInput): Promise<string> {
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  return oidc
    .buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      login_hint: loginHint || undefined
    } as Record<string, string>)
    .toString();
}

export async function calculateOidcCodeChallenge(codeVerifier: string): Promise<string> {
  return oidc.calculatePKCECodeChallenge(codeVerifier);
}

export interface ExchangeOidcInput {
  configuration: any;
  currentUrl: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export async function exchangeOidcAuthorizationCode({ configuration, currentUrl, state, nonce, codeVerifier }: ExchangeOidcInput): Promise<any> {
  return oidc.authorizationCodeGrant(configuration, currentUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState: state,
    expectedNonce: nonce
  });
}
