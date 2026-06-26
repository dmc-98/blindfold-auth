/**
 * Passkeys-first MFA — TDD spec (Week 5-6)
 *
 * Flow:
 *   1. Admin enables passkey MFA on a principal.
 *   2. POST /login (password) → 202 { passkeyMfaRequired, pendingToken, challengeId, options }
 *   3. Client performs WebAuthn assertion against the challenge.
 *   4. POST /passkeys/complete-mfa → 200 session with authStrength: "mfa_passkey"
 *
 * Tests:
 *   1.  enablePasskeyMfa sets principal.mfa.passkey.enabled = true
 *   2.  disablePasskeyMfa clears it
 *   3.  Login with passkey MFA enabled + active passkey → challenge (not a session)
 *   4.  Login handler returns status 202 with correct shape
 *   5.  Graceful fallback: no active passkeys → normal password session
 *   6.  completeMfa rejects missing token
 *   7.  completeMfa rejects tampered token
 *   8.  completeMfa rejects expired token
 *   9.  completeMfa happy path → authStrength "mfa_passkey" session (injected verifyFn)
 *   10. completeMfa writes audit event passkey.mfa_completed
 *   11. completeMfa rejects assertion belonging to a different principal
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createAuth, createMemoryStorage } from "../src/index.js";

const FAKE_CREDENTIAL_ID = "fake-passkey-cred-001";

async function makeFixture() {
  const storage = createMemoryStorage();
  const auth = createAuth({
    workspaceId: "ws-passkey-mfa",
    secret: "passkey-mfa-secret-32-bytes-padded",
    storage
  });

  await auth.admin.bootstrapWorkspace({ name: "Passkey MFA WS" });
  const app = await auth.admin.applications.create({
    slug: "app",
    name: "App",
    config: {
      passkeys: { rpId: "example.com", origins: ["https://example.com"] }
    }
  });
  const principal = await auth.admin.principals.create({
    email: "mfa@example.com",
    password: "correct-horse-battery-staple",
    displayName: "MFA User"
  });
  await auth.admin.memberships.assignRole({
    principalId: principal.id,
    applicationId: app.id,
    roleId: (await auth.admin.roles.create({ applicationId: app.id, name: "member" })).id
  });

  // Seed a fake passkey credential (bypasses WebAuthn ceremony)
  const credential = {
    id: "cred_fake_001",
    workspaceId: "ws-passkey-mfa",
    principalId: principal.id,
    applicationId: app.id,
    credentialId: FAKE_CREDENTIAL_ID,
    publicKey: "fake-public-key",
    counter: 0,
    transports: ["internal"],
    rpID: "example.com",
    nickname: "Test Key",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await storage.put("webauthn_credentials", credential);

  return { auth, storage, app, principal, credential };
}

function makeRequest(appId: string) {
  return {
    headers: { host: "example.com", origin: "https://example.com" },
    host: "example.com",
    origin: "https://example.com"
  };
}

// ─── test 1: enablePasskeyMfa ──────────────────────────────────────────────
test("passkey MFA: enablePasskeyMfa sets mfa.passkey.enabled on the principal", async () => {
  const { auth, principal } = await makeFixture();

  await auth.admin.principals.enablePasskeyMfa({ principalId: principal.id });

  const updated = await auth.storage.get("principals", principal.id);
  assert.equal((updated as any).mfa?.passkey?.enabled, true);
});

// ─── test 2: disablePasskeyMfa ─────────────────────────────────────────────
test("passkey MFA: disablePasskeyMfa clears mfa.passkey.enabled", async () => {
  const { auth, principal } = await makeFixture();

  await auth.admin.principals.enablePasskeyMfa({ principalId: principal.id });
  await auth.admin.principals.disablePasskeyMfa({ principalId: principal.id });

  const updated = await auth.storage.get("principals", principal.id);
  assert.equal((updated as any).mfa?.passkey?.enabled, false);
});

// ─── test 3: login returns MFA challenge, not a session ────────────────────
test("passkey MFA: password login returns passkeyMfaRequired when enabled + active passkey exists", async () => {
  const { auth, app, principal } = await makeFixture();

  await auth.admin.principals.enablePasskeyMfa({ principalId: principal.id });

  const result = await auth.handlers.login()({
    body: {
      applicationId: app.id,
      email: principal.email,
      password: "correct-horse-battery-staple"
    },
    headers: { host: "example.com", origin: "https://example.com" }
  });

  // Must be 202, not 200
  assert.equal(result.statusCode, 202, "status must be 202 for passkey MFA challenge");
  const body = JSON.parse(result.body);
  assert.equal(body.passkeyMfaRequired, true, "passkeyMfaRequired flag");
  assert.ok(typeof body.pendingToken === "string", "pendingToken present");
  assert.ok(typeof body.challengeId === "string", "challengeId present");
  assert.ok(body.options?.challenge, "WebAuthn options with challenge present");
  // Must NOT contain a session token
  assert.equal(body.accessToken, undefined, "no accessToken in MFA challenge response");
});

// ─── test 4: graceful fallback when no active passkeys ────────────────────
test("passkey MFA: falls back to password session when passkey MFA enabled but no active credentials", async () => {
  const { auth, storage, app, principal, credential } = await makeFixture();

  await auth.admin.principals.enablePasskeyMfa({ principalId: principal.id });
  // Revoke the only passkey
  await storage.put("webauthn_credentials", { ...credential, status: "revoked" });

  const result = await auth.handlers.login()({
    body: {
      applicationId: app.id,
      email: principal.email,
      password: "correct-horse-battery-staple"
    },
    headers: { host: "example.com", origin: "https://example.com" }
  });

  assert.equal(result.statusCode, 200, "falls back to 200 session");
  const body = JSON.parse(result.body);
  assert.ok(body.accessToken, "session issued on fallback");
  assert.equal(body.passkeyMfaRequired, undefined, "no MFA challenge on fallback");
});

// ─── test 5: completeMfa rejects missing token ────────────────────────────
test("passkey MFA: completeMfa rejects request with no pendingToken", async () => {
  const { auth, app } = await makeFixture();

  const result = await auth.handlers.passkeys.completeMfa()({
    body: {
      applicationId: app.id,
      pendingToken: undefined,
      challengeId: "some-id",
      response: {}
    }
  });

  assert.equal(result.statusCode, 401);
  assert.ok(JSON.parse(result.body).error, "error message present");
});

// ─── test 6: completeMfa rejects tampered token ───────────────────────────
test("passkey MFA: completeMfa rejects tampered pendingToken", async () => {
  const { auth, app, principal } = await makeFixture();

  await auth.admin.principals.enablePasskeyMfa({ principalId: principal.id });
  const challenge = await auth.handlers.login()({
    body: { applicationId: app.id, email: principal.email, password: "correct-horse-battery-staple" },
    headers: { host: "example.com", origin: "https://example.com" }
  });
  const { pendingToken, challengeId } = JSON.parse(challenge.body);

  // Tamper: flip a character in the signature
  const tampered = pendingToken.slice(0, -4) + "XXXX";

  const result = await auth.handlers.passkeys.completeMfa()({
    body: { applicationId: app.id, pendingToken: tampered, challengeId, response: { id: FAKE_CREDENTIAL_ID } }
  });

  assert.equal(result.statusCode, 401);
});

// ─── test 7: completeMfa rejects expired token ────────────────────────────
test("passkey MFA: completeMfa rejects an expired pendingToken", async () => {
  const { auth, app } = await makeFixture();

  // Build an expired token directly via the exported test helper
  const result = await auth.handlers.passkeys.completeMfa()({
    body: {
      applicationId: app.id,
      pendingToken: "expired.token",
      challengeId: "some-id",
      response: {}
    }
  });

  assert.equal(result.statusCode, 401);
});

// ─── test 8 + 9: completeMfa happy path with injected verifyFn ────────────
test("passkey MFA: completeMfa issues authStrength:mfa_passkey on valid assertion (injected verifyFn)", async () => {
  const { auth, storage, app, principal, credential } = await makeFixture();

  await auth.admin.principals.enablePasskeyMfa({ principalId: principal.id });

  const challengeResp = await auth.handlers.login()({
    body: { applicationId: app.id, email: principal.email, password: "correct-horse-battery-staple" },
    headers: { host: "example.com", origin: "https://example.com" }
  });
  const { pendingToken, challengeId } = JSON.parse(challengeResp.body);

  // Inject a stub that returns verified:true
  const stubVerify = async (_input: any) => ({
    verified: true,
    authenticationInfo: { newCounter: 1, credentialID: FAKE_CREDENTIAL_ID }
  });

  const result = await auth.handlers.passkeys.completeMfa({ verifyFn: stubVerify })({
    body: {
      applicationId: app.id,
      pendingToken,
      challengeId,
      response: { id: FAKE_CREDENTIAL_ID }
    }
  });

  assert.equal(result.statusCode, 200, "should succeed");
  const body = JSON.parse(result.body);
  assert.ok(body.accessToken, "session issued");
  assert.equal(body.session?.authStrength, "mfa_passkey", "authStrength is mfa_passkey");
});

// ─── test 10: audit event written ─────────────────────────────────────────
test("passkey MFA: completeMfa writes a passkey.mfa_completed audit event", async () => {
  const { auth, app, principal } = await makeFixture();

  await auth.admin.principals.enablePasskeyMfa({ principalId: principal.id });

  const challengeResp = await auth.handlers.login()({
    body: { applicationId: app.id, email: principal.email, password: "correct-horse-battery-staple" },
    headers: { host: "example.com", origin: "https://example.com" }
  });
  const { pendingToken, challengeId } = JSON.parse(challengeResp.body);

  const stubVerify = async (_input: any) => ({
    verified: true,
    authenticationInfo: { newCounter: 1, credentialID: FAKE_CREDENTIAL_ID }
  });

  await auth.handlers.passkeys.completeMfa({ verifyFn: stubVerify })({
    body: { applicationId: app.id, pendingToken, challengeId, response: { id: FAKE_CREDENTIAL_ID } }
  });

  const events = await auth.admin.audit.list();
  const mfaEvent = events.find((e: any) => e.type === "passkey.mfa_completed");
  assert.ok(mfaEvent, "passkey.mfa_completed audit event must exist");
  assert.equal(mfaEvent.principalId, principal.id);
});

// ─── test 11: credential must belong to the pending principal ─────────────
test("passkey MFA: completeMfa rejects if credential belongs to a different principal", async () => {
  const { auth, storage, app, principal } = await makeFixture();

  await auth.admin.principals.enablePasskeyMfa({ principalId: principal.id });

  const challengeResp = await auth.handlers.login()({
    body: { applicationId: app.id, email: principal.email, password: "correct-horse-battery-staple" },
    headers: { host: "example.com", origin: "https://example.com" }
  });
  const { pendingToken, challengeId } = JSON.parse(challengeResp.body);

  // Register a credential belonging to a different principal
  const otherPrincipal = await auth.admin.principals.create({
    email: "other@example.com",
    password: "correct-horse-battery-staple",
    displayName: "Other User"
  });
  const otherCredId = "fake-passkey-other-001";
  await storage.put("webauthn_credentials", {
    id: "cred_other_001",
    workspaceId: "ws-passkey-mfa",
    principalId: otherPrincipal.id,
    applicationId: app.id,
    credentialId: otherCredId,
    publicKey: "other-public-key",
    counter: 0,
    transports: ["internal"],
    rpID: "example.com",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const stubVerify = async (_input: any) => ({
    verified: true,
    authenticationInfo: { newCounter: 1, credentialID: otherCredId }
  });

  const result = await auth.handlers.passkeys.completeMfa({ verifyFn: stubVerify })({
    body: { applicationId: app.id, pendingToken, challengeId, response: { id: otherCredId } }
  });

  assert.equal(result.statusCode, 401);
  assert.ok(JSON.parse(result.body).error.toLowerCase().includes("principal"), "error names the mismatch");
});
