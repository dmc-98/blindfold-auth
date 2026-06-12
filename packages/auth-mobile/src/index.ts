/**
 * @dmc--98/blindfold-mobile — mobile-friendly Blindfold Auth client.
 *
 * What it gives a mobile app (RN, Swift, Kotlin via HTTP, or any native client
 * that can speak `fetch`-style):
 *   1. **PKCE S256 helpers** for OIDC code flows initiated from a native app
 *   2. A **pluggable token store** so refresh tokens can live in iOS Keychain /
 *      Android Keystore / EncryptedSharedPreferences / SecureStore
 *   3. A **typed HTTP client** that handles login → access+refresh → automatic
 *      refresh on 401 → logout, against the standard Blindfold REST contract
 *
 * The contract this client targets is the same minimal REST surface a server
 * built on `@dmc--98/blindfold-client` already exposes:
 *   POST /auth/login        → { accessToken, refreshToken }
 *   POST /auth/refresh      → { accessToken, refreshToken }
 *   POST /auth/logout       → { ok: true }
 *   GET  /api/me            → current principal
 *
 * Designed so an iOS app can ship its own thin wrapper that delegates to this
 * over a WKWebView-or-native HTTP boundary — no business logic duplicated.
 */
import { randomBytes, createHash } from "node:crypto";

export const MOBILE_VERSION = "1.0.0-rc.1" as const;

// --- PKCE -------------------------------------------------------------------

export interface PkcePair {
  /** High-entropy random string the app keeps secret until the redirect. */
  codeVerifier: string;
  /** base64url(SHA256(codeVerifier)) — sent in the authorize request. */
  codeChallenge: string;
  /** Always "S256" — the only method we generate. */
  codeChallengeMethod: "S256";
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Generate a PKCE verifier + S256 challenge per RFC 7636. The verifier is 32
 * random bytes encoded base64url (43 chars), well within the 43–128 range.
 */
export function generatePkcePair(): PkcePair {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

// --- Token store ------------------------------------------------------------

export interface MobileTokens {
  accessToken: string;
  refreshToken?: string;
  /** Optional ms-since-epoch expiry hint the client can use to refresh ahead. */
  accessTokenExpiresAt?: number;
}

export interface MobileTokenStore {
  read(): Promise<MobileTokens | null>;
  write(tokens: MobileTokens): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory store for tests and ephemeral sessions. Real apps wire Keychain/Keystore. */
export function createMemoryTokenStore(): MobileTokenStore {
  let state: MobileTokens | null = null;
  return {
    async read() { return state; },
    async write(tokens) { state = { ...tokens }; },
    async clear() { state = null; }
  };
}

// --- HTTP client ------------------------------------------------------------

export interface MobileClientOptions {
  baseUrl: string;
  /** Stable device fingerprint the server's risk engine uses. */
  deviceId: string;
  tokenStore?: MobileTokenStore;
  /** Override the fetch implementation (useful in tests; defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

export interface MobileLoginInput {
  applicationId?: string;
  email: string;
  password: string;
}

export interface MobileSession {
  accessToken: string;
  refreshToken?: string;
  principal?: { id: string; email: string; displayName?: string };
}

export interface MobileClient {
  readonly version: typeof MOBILE_VERSION;
  /** PKCE pair helper, re-exported for ergonomics. */
  pkce(): PkcePair;
  /** Currently-stored tokens (after `login`/`refresh`). */
  getTokens(): Promise<MobileTokens | null>;
  /** Password login. Returns the session; tokens are persisted to the store. */
  login(input: MobileLoginInput): Promise<MobileSession>;
  /** Rotate using the persisted refresh token. */
  refresh(): Promise<MobileSession>;
  /** Revoke server-side and clear the local store. */
  logout(): Promise<void>;
  /** Authenticated GET; auto-refreshes once on 401. */
  fetch<T = unknown>(path: string, init?: RequestInit): Promise<{ status: number; data: T }>;
}

interface ServerLoginShape {
  accessToken?: string;
  refreshToken?: string;
  principal?: { id: string; email: string; displayName?: string };
  session?: { principalId?: string };
  // Risk-driven step-up — handled by the caller, not auto-followed by the mobile client.
  mfaRequired?: boolean;
  challengeId?: string;
  error?: string;
}

export function createMobileClient(options: MobileClientOptions): MobileClient {
  if (!options.baseUrl) throw new Error("createMobileClient requires baseUrl");
  if (!options.deviceId) throw new Error("createMobileClient requires deviceId");
  const tokenStore = options.tokenStore || createMemoryTokenStore();
  const doFetch = options.fetchImpl || fetch;
  const base = options.baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<{ status: number; data: T }> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-device-id": options.deviceId,
      ...(init.headers as Record<string, string> | undefined)
    };
    if (token) headers.authorization = "Bearer " + token;
    const res = await doFetch(base + path, { ...init, headers });
    const text = await res.text();
    const data = text ? JSON.parse(text) as T : ({} as T);
    return { status: res.status, data };
  }

  async function persist(payload: ServerLoginShape): Promise<MobileSession> {
    if (!payload.accessToken) {
      throw new Error(payload.error || "no access token in response");
    }
    await tokenStore.write({ accessToken: payload.accessToken, refreshToken: payload.refreshToken });
    return {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      principal: payload.principal
    };
  }

  return {
    version: MOBILE_VERSION,
    pkce: generatePkcePair,
    getTokens: () => tokenStore.read(),

    async login(input) {
      const { status, data } = await request<ServerLoginShape>("/auth/login", {
        method: "POST",
        body: JSON.stringify(input)
      });
      if (data.mfaRequired) {
        const err = new Error("step-up MFA required") as Error & { mfaRequired: true; challengeId?: string };
        err.mfaRequired = true;
        err.challengeId = data.challengeId;
        throw err;
      }
      if (status !== 200 || !data.accessToken) {
        throw new Error(data.error || `login failed (${status})`);
      }
      return persist(data);
    },

    async refresh() {
      const current = await tokenStore.read();
      if (!current?.refreshToken) throw new Error("no refresh token stored");
      const { status, data } = await request<ServerLoginShape>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken: current.refreshToken })
      });
      if (status !== 200 || !data.accessToken) {
        await tokenStore.clear();
        throw new Error(data.error || `refresh failed (${status})`);
      }
      return persist(data);
    },

    async logout() {
      const current = await tokenStore.read();
      if (current?.refreshToken) {
        await request<{ ok: boolean }>("/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken: current.refreshToken })
        }, current.accessToken).catch(() => undefined);
      }
      await tokenStore.clear();
    },

    async fetch<T>(path: string, init: RequestInit = {}) {
      let tokens = await tokenStore.read();
      let res = await request<T>(path, init, tokens?.accessToken);
      if (res.status === 401 && tokens?.refreshToken) {
        try {
          await this.refresh();
          tokens = await tokenStore.read();
          res = await request<T>(path, init, tokens?.accessToken);
        } catch {
          // refresh failed; surface the original 401
        }
      }
      return res;
    }
  };
}

export default createMobileClient;
