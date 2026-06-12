// Upstream packages are still plain JS (migration in progress). Cast their
// public surface to `any` locally so the demo can be strict-TS without
// blocking on typing the entire workspace.
import { blindfold as blindfoldRaw } from "@dmc--98/blindfold-client";
import { maskValue as maskValueRaw } from "@dmc--98/blindfold-auth";
import { createRiskEngine as createRiskEngineRaw } from "@dmc--98/blindfold-risk";

const blindfold = blindfoldRaw as unknown as (opts: { project: string; secret: string; storage: string }) => Promise<any>;
const maskValue = maskValueRaw as unknown as (v: string) => string;
const createRiskEngine = createRiskEngineRaw as unknown as (opts: { storage: unknown; config?: unknown }) => {
  assess(input: { principalId: string; applicationId?: string; context?: { deviceId?: string | null; ip?: string | null; now?: number }; record?: boolean }): Promise<{
    score: number; level: "low" | "medium" | "high"; signals: Record<string, boolean>;
    requireStepUp: boolean; reasons: string[]; baseline: boolean; eventId: string;
  }>;
  enforceStepUp(a: unknown, opts?: { mfaVerified?: boolean }): { ok: boolean; action?: string };
  listEvents(opts?: { principalId?: string }): Promise<unknown[]>;
};

/**
 * Acme Support Console — application logic, decoupled from HTTP for tests.
 * Uses Blindfold for real:
 *   - password login + sessions
 *   - RBAC: only "admin" may delete a customer
 *   - ABAC field masking: "support" sees customer.ssn masked
 *   - M7 dynamic security: risk-driven step-up MFA on first login from a new device/IP
 */

interface Customer {
  id: string;
  name: string;
  email: string;
  plan: string;
  ssn: string;
  note: string;
}

const CUSTOMERS: Customer[] = [
  { id: "c1", name: "Ada Lovelace", email: "ada@northwind.co", plan: "Enterprise", ssn: "501-22-1234", note: "Renewal Q3" },
  { id: "c2", name: "Alan Turing", email: "alan@globex.io", plan: "Team", ssn: "402-55-9981", note: "Wants SSO" },
  { id: "c3", name: "Grace Hopper", email: "grace@initech.com", plan: "Team", ssn: "311-88-4420", note: "Champion" },
  { id: "c4", name: "Katherine Johnson", email: "kj@umbra.dev", plan: "Enterprise", ssn: "288-19-7702", note: "Expansion" }
];

// Anything that doesn't match these is considered a "new device" by the risk engine
// and will trip step-up MFA. The browser persists a fresh deviceId in localStorage,
// so a real user's first login from a new browser is challenged; tests sending this
// trusted id are not.
export const TRUSTED_DEVICE_ID = "blindfold-demo-trusted";
export const TRUSTED_IP = "10.0.0.1";

export interface CreateAppOptions {
  secret?: string;
  storage?: string;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export interface LoginInput {
  email: string;
  password: string;
  deviceId?: string;
  ip?: string;
}

interface MfaChallenge {
  challengeId: string;
  code: string;
  accessToken: string;
  refreshToken?: string;
  principalId: string;
  expiresAt: number;
}

function readBearer(headers: Record<string, string | string[] | undefined> = {}): string | null {
  const raw = headers.authorization ?? headers.Authorization ?? "";
  const value = Array.isArray(raw) ? raw[0] ?? "" : raw;
  const [scheme, token] = value.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export async function createApp(options: CreateAppOptions = {}) {
  const client = await blindfold({
    project: "acme-support-console",
    secret: options.secret || "demo-secret-change-me",
    storage: options.storage || "memory"
  });
  const { auth } = client as { auth: any };
  const customers: Customer[] = CUSTOMERS.map((c) => ({ ...c }));

  const risk = createRiskEngine({ storage: auth.storage });

  // --- seed roles, masking policy, users -----------------------------------
  await auth.admin.bootstrapWorkspace({ name: "Acme" });
  const app = await auth.admin.applications.create({ slug: "console", name: "Support Console" });

  const adminRole = await auth.admin.roles.create({ applicationId: app.id, name: "admin" });
  await auth.admin.roles.grantPermission({ applicationId: app.id, roleId: adminRole.id, resource: "*", action: "*" });

  const supportRole = await auth.admin.roles.create({ applicationId: app.id, name: "support" });
  await auth.admin.roles.grantPermission({ applicationId: app.id, roleId: supportRole.id, resource: "customer", action: "read" });

  await auth.admin.policies.add({
    applicationId: app.id,
    roleId: supportRole.id,
    resource: "customer",
    action: "read",
    field: "ssn",
    effect: "mask"
  });

  const alice = await auth.admin.principals.create({ email: "alice@acme.co", password: "password123", displayName: "Alice Admin" });
  await auth.admin.memberships.assignRole({ principalId: alice.id, applicationId: app.id, roleId: adminRole.id });

  const bob = await auth.admin.principals.create({ email: "bob@acme.co", password: "password123", displayName: "Bob Support" });
  await auth.admin.memberships.assignRole({ principalId: bob.id, applicationId: app.id, roleId: supportRole.id });

  // Seed the risk baseline so the trusted device/IP is recognized and any new
  // device/IP combination crosses the step-up threshold (newDevice 30 + newIp 20 = 50 >= 40).
  await risk.assess({ principalId: alice.id, applicationId: app.id, context: { deviceId: TRUSTED_DEVICE_ID, ip: TRUSTED_IP } });
  await risk.assess({ principalId: bob.id, applicationId: app.id, context: { deviceId: TRUSTED_DEVICE_ID, ip: TRUSTED_IP } });

  const mfaChallenges = new Map<string, MfaChallenge>();
  const MFA_TTL_MS = 5 * 60_000;

  async function authenticate(headers: Record<string, string | string[] | undefined>) {
    const token = readBearer(headers);
    if (!token) return null;
    const verified = await auth.session.verify({ accessToken: token });
    return verified.ok ? verified : null;
  }

  async function rolesOf(principalId: string): Promise<string[]> {
    const del = await auth.can({ principalId, applicationId: app.id, action: "delete", resource: "customer" });
    return del.allowed ? ["admin"] : ["support"];
  }

  function randomCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  function randomId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
  }

  const api = {
    applicationId: app.id,

    async login({ email, password, deviceId, ip }: LoginInput): Promise<ApiResponse> {
      const res = await auth.handlers.login()({ body: { applicationId: app.id, email, password } });
      const body = JSON.parse(res.body);
      if (res.statusCode !== 200 || !body.accessToken) {
        return { status: res.statusCode, body };
      }

      const principalId: string = body.session?.principalId || body.principal?.id || body.principalId;
      const assessment = await risk.assess({
        principalId,
        applicationId: app.id,
        context: { deviceId: deviceId || null, ip: ip || null }
      });

      if (assessment.requireStepUp) {
        const challenge: MfaChallenge = {
          challengeId: randomId("mfa"),
          code: randomCode(),
          accessToken: body.accessToken,
          refreshToken: body.refreshToken,
          principalId,
          expiresAt: Date.now() + MFA_TTL_MS
        };
        mfaChallenges.set(challenge.challengeId, challenge);
        return {
          status: 200,
          body: {
            mfaRequired: true,
            challengeId: challenge.challengeId,
            // In production, this code would be sent over SMS / authenticator / email.
            // The demo surfaces it so the flow is self-contained and visible.
            demoCode: challenge.code,
            risk: {
              level: assessment.level,
              score: assessment.score,
              reasons: assessment.reasons
            }
          }
        };
      }

      return { status: 200, body };
    },

    async verifyMfa({ challengeId, code }: { challengeId: string; code: string }): Promise<ApiResponse> {
      const challenge = mfaChallenges.get(challengeId);
      if (!challenge) return { status: 404, body: { error: "challenge not found" } };
      if (challenge.expiresAt < Date.now()) {
        mfaChallenges.delete(challengeId);
        return { status: 410, body: { error: "challenge expired" } };
      }
      if (challenge.code !== String(code).trim()) {
        return { status: 401, body: { error: "invalid code" } };
      }
      mfaChallenges.delete(challengeId);
      return {
        status: 200,
        body: { accessToken: challenge.accessToken, refreshToken: challenge.refreshToken, mfaVerified: true }
      };
    },

    async me(headers: Record<string, string | string[] | undefined>): Promise<ApiResponse> {
      const v = await authenticate(headers);
      if (!v) return { status: 401, body: { error: "unauthorized" } };
      return { status: 200, body: { id: v.principal.id, email: v.principal.email, displayName: v.principal.displayName, roles: await rolesOf(v.principal.id) } };
    },

    async customers(headers: Record<string, string | string[] | undefined>): Promise<ApiResponse> {
      const v = await authenticate(headers);
      if (!v) return { status: 401, body: { error: "unauthorized" } };

      const del = await auth.can({ principalId: v.principal.id, applicationId: app.id, action: "delete", resource: "customer" });
      const ssnDecision = await auth.can({
        principalId: v.principal.id,
        applicationId: app.id,
        action: "read",
        resource: "customer",
        field: "ssn"
      });
      const maskSsn = ssnDecision.effect === "mask" || (ssnDecision.obligations?.maskedFields || []).includes("ssn");

      const rows = customers.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        plan: c.plan,
        note: c.note,
        ssn: maskSsn ? maskValue(c.ssn) : c.ssn,
        ssnMasked: maskSsn
      }));

      return { status: 200, body: { customers: rows, canDelete: del.allowed, ssnEffect: ssnDecision.effect || "allow" } };
    },

    async deleteCustomer(headers: Record<string, string | string[] | undefined>, id: string): Promise<ApiResponse> {
      const v = await authenticate(headers);
      if (!v) return { status: 401, body: { error: "unauthorized" } };
      const decision = await auth.can({ principalId: v.principal.id, applicationId: app.id, action: "delete", resource: "customer" });
      if (!decision.allowed) {
        return { status: 403, body: { error: "forbidden", reason: decision.reason } };
      }
      const idx = customers.findIndex((c) => c.id === id);
      if (idx >= 0) customers.splice(idx, 1);
      return { status: 200, body: { ok: true, remaining: customers.length } };
    }
  };

  return { client, auth, api, risk };
}
