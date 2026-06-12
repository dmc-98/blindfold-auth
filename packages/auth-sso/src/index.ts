/**
 * @dmc--98/blindfold-sso — versioned public SSO contract for Blindfold Auth.
 *
 * The engine has shipped OIDC + SAML federation since M1. This package
 * **freezes** the public surface as the v1 contract: stable type signatures,
 * a single coherent entry point, and explicit semver. Code that targets v1 is
 * insulated from engine refactors — only this module's `SSO_VERSION` and the
 * exported types are the contract.
 *
 *   const sso = createSso({ auth });
 *   await sso.providers.add({ type: "oidc", key: "okta", name: "Okta", mode: "demo", ... });
 *   await sso.bindings.add({ applicationId, providerId, domains: ["acme.co"] });
 *   const start = await sso.login.start({ protocol: "oidc", applicationId, email });
 *   // user redirects to start.redirectTo, IdP redirects back with `payload`...
 *   const session = await sso.login.complete({ protocol: "oidc", payload });
 */

export const SSO_VERSION = "1.0.0-rc.1" as const;

/** Wire protocol of an IdP. */
export type SsoProtocol = "oidc" | "saml";

/** Provider deployment mode. `demo` is for local/dev/test; `live` requires real config. */
export type SsoMode = "live" | "demo";

export interface SsoProviderInput {
  type: SsoProtocol;
  key: string;
  name: string;
  mode?: SsoMode;
  issuer?: string | null;
  discoveryUrl?: string | null;
  authorizationUrl?: string | null;
  ssoUrl?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  allowInsecureDiscovery?: boolean;
  claimMappings?: Record<string, string>;
  x509Certificate?: string | null;
  status?: "active" | "disabled";
}

export interface SsoProvider {
  id: string;
  key: string;
  name: string;
  type: SsoProtocol;
  mode: SsoMode;
  status: string;
  issuer: string | null;
  discoveryUrl: string | null;
  authorizationUrl: string | null;
  ssoUrl: string | null;
  clientId: string | null;
  x509Certificate: string | null;
  claimMappings: Record<string, string>;
}

export interface SsoBindingInput {
  applicationId: string;
  providerId: string;
  domains?: string[];
  defaultRoleIds?: string[];
  claimMappings?: Record<string, string>;
  enabled?: boolean;
  allowIdpInitiated?: boolean;
  entityId?: string | null;
  audience?: string | null;
}

export interface SsoBinding {
  id: string;
  applicationId: string;
  providerId: string;
  domains: string[];
  defaultRoleIds: string[];
  enabled: boolean;
  allowIdpInitiated: boolean;
}

export interface SsoLoginStartInput {
  protocol: SsoProtocol;
  applicationId: string;
  /** Optional provider id when the application has multiple providers bound. */
  providerId?: string | null;
  /** Optional user email — used to disambiguate by domain. */
  email?: string | null;
  /** Request context for building callback URLs. */
  request?: { headers?: Record<string, string | string[] | undefined>; query?: Record<string, unknown>; body?: Record<string, unknown> };
}

export interface SsoLoginStartResult {
  redirectTo: string;
  provider: { id: string; key: string; type: SsoProtocol };
  /** Demo-only: contains the synthetic IdP callback body the test/dev can pass straight back to `complete()`. */
  demoCallback?: Record<string, unknown>;
  /** When the engine cannot pick a single provider (multiple match the hint), it returns 409 with the list. */
  multipleProviders?: Array<{ id: string; key: string; name: string }>;
}

export interface SsoLoginCompleteInput {
  protocol: SsoProtocol;
  /** Raw IdP callback payload (e.g. for OIDC: `{ code, state }`; for SAML: `{ SAMLResponse, relayState }`). */
  payload: Record<string, unknown>;
  request?: { headers?: Record<string, string | string[] | undefined>; query?: Record<string, unknown>; body?: Record<string, unknown> };
}

export interface SsoLoginCompleteResult {
  session: { id: string; principalId: string; applicationId: string; authStrength: string };
  accessToken: string;
  refreshToken?: string;
  principal: { id: string; email: string; displayName?: string };
}

/**
 * Minimal shape of the engine instance this contract depends on. Kept narrow
 * so future engine refactors can satisfy the contract without changing v1.
 */
export interface SsoEngine {
  admin: {
    identityProviders: {
      list(): Promise<SsoProvider[]>;
      create(input: SsoProviderInput & { actorId?: string }): Promise<SsoProvider>;
    };
    applicationProviders: {
      list(args?: { applicationId?: string }): Promise<SsoBinding[]>;
      bind(input: SsoBindingInput & { actorId?: string }): Promise<SsoBinding>;
    };
  };
  handlers: {
    oidc: {
      start(): (req: any) => Promise<{ statusCode: number; body: string }>;
      callback(): (req: any) => Promise<{ statusCode: number; body: string }>;
    };
    saml: {
      start(): (req: any) => Promise<{ statusCode: number; body: string }>;
      callback(): (req: any) => Promise<{ statusCode: number; body: string }>;
      metadata(): (req: any) => Promise<{ statusCode: number; body: string }>;
    };
  };
}

export interface SsoClientOptions {
  auth: SsoEngine;
}

export interface SsoClient {
  readonly version: typeof SSO_VERSION;
  providers: {
    list(): Promise<SsoProvider[]>;
    add(input: SsoProviderInput): Promise<SsoProvider>;
  };
  bindings: {
    list(input?: { applicationId?: string }): Promise<SsoBinding[]>;
    add(input: SsoBindingInput): Promise<SsoBinding>;
  };
  login: {
    start(input: SsoLoginStartInput): Promise<SsoLoginStartResult>;
    complete(input: SsoLoginCompleteInput): Promise<SsoLoginCompleteResult>;
  };
  /** SAML SP metadata XML for a given application. Throws for OIDC. */
  metadata(input: { protocol: "saml"; applicationId: string; request?: SsoLoginStartInput["request"] }): Promise<string>;
}

function parse<T>(body: string): T {
  return JSON.parse(body) as T;
}

export function createSso({ auth }: SsoClientOptions): SsoClient {
  if (!auth || !auth.admin || !auth.handlers) {
    throw new Error("createSso requires an auth engine with admin + handlers surfaces");
  }

  return {
    version: SSO_VERSION,
    providers: {
      list: () => auth.admin.identityProviders.list(),
      add: (input) => auth.admin.identityProviders.create({ mode: "live", ...input })
    },
    bindings: {
      list: (input) => auth.admin.applicationProviders.list(input || {}),
      add: (input) => auth.admin.applicationProviders.bind(input)
    },
    login: {
      async start({ protocol, applicationId, providerId, email, request }) {
        const handler = auth.handlers[protocol].start();
        const res = await handler({ body: { applicationId, providerId, email }, ...(request || {}) });
        if (res.statusCode === 409) {
          const body = parse<{ providers: Array<{ id: string; key: string; name: string }> }>(res.body);
          return { multipleProviders: body.providers } as unknown as SsoLoginStartResult;
        }
        if (res.statusCode !== 200) {
          const body = parse<{ error?: string }>(res.body);
          throw new Error(body.error || `SSO start failed (${res.statusCode})`);
        }
        return parse<SsoLoginStartResult>(res.body);
      },
      async complete({ protocol, payload, request }) {
        const handler = auth.handlers[protocol].callback();
        const res = await handler({ body: payload, ...(request || {}) });
        if (res.statusCode !== 200) {
          const body = parse<{ error?: string }>(res.body);
          throw new Error(body.error || `SSO complete failed (${res.statusCode})`);
        }
        return parse<SsoLoginCompleteResult>(res.body);
      }
    },
    async metadata({ protocol, applicationId, request }) {
      if (protocol !== "saml") {
        throw new Error("SP metadata is only defined for SAML");
      }
      const handler = auth.handlers.saml.metadata();
      const res = await handler({ body: { applicationId }, ...(request || {}) });
      if (res.statusCode !== 200) {
        const body = parse<{ error?: string }>(res.body);
        throw new Error(body.error || `metadata fetch failed (${res.statusCode})`);
      }
      return res.body;
    }
  };
}

export default createSso;
