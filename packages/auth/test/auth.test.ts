import assert from "node:assert/strict";
import test from "node:test";
import { createAuth, createMemoryStorage } from "../src/index.js";

test("Blindfold Auth supports workspace bootstrap, password login, RBAC, and ABAC masking", async () => {
  const auth = createAuth({
    workspaceId: "workspace_test",
    secret: "test-secret",
    storage: createMemoryStorage()
  });

  await auth.admin.bootstrapWorkspace({ name: "Test Workspace" });
  const application = await auth.admin.applications.create({
    slug: "billing-app",
    name: "Billing App"
  });
  const principal = await auth.admin.principals.create({
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    password: "correct-horse-battery-staple",
    attributes: { department: "finance", tenantId: "tenant_1" }
  });
  const role = await auth.admin.roles.create({
    applicationId: application.id,
    name: "finance_admin"
  });

  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: role.id,
    resource: "invoice",
    action: "read"
  });
  await auth.admin.memberships.assignRole({
    principalId: principal.id,
    applicationId: application.id,
    roleId: role.id
  });
  await auth.admin.policies.add({
    applicationId: application.id,
    resource: "invoice",
    action: "read",
    field: "internalNotes",
    effect: "mask",
    conditionJson: {
      neq: ["subject.department", "security"]
    }
  });

  const login = await auth.handlers.login()({
    body: {
      applicationId: application.id,
      email: principal.email,
      password: "correct-horse-battery-staple"
    }
  });
  const loginPayload = JSON.parse(login.body);
  assert.equal(login.statusCode, 200);
  assert.ok(loginPayload.accessToken);
  assert.ok(loginPayload.refreshToken);

  const maskedDecision = await auth.can({
    principalId: principal.id,
    applicationId: application.id,
    action: "read",
    resource: "invoice",
    field: "internalNotes",
    resourceAttributes: { tenantId: "tenant_1" }
  });
  assert.equal(maskedDecision.allowed, true);
  assert.equal(maskedDecision.effect, "mask");

  const route = auth.protect(
    {
      applicationId: application.id,
      resource: "invoice",
      action: "read"
    },
    async ({ subject }: any) => ({
      statusCode: 200,
      body: JSON.stringify({ ok: true, principalId: subject.id })
    })
  );
  const protectedResponse = await route({
    headers: { authorization: `Bearer ${loginPayload.accessToken}` }
  });

  assert.equal(protectedResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(protectedResponse.body), { ok: true, principalId: principal.id });
});

test("Blindfold Auth rotates refresh sessions and invalidates the old access token", async () => {
  const auth = createAuth({
    workspaceId: "workspace_rotation",
    secret: "rotation-secret",
    storage: createMemoryStorage()
  });

  await auth.admin.bootstrapWorkspace({ name: "Rotation Workspace" });
  const application = await auth.admin.applications.create({
    slug: "api-app",
    name: "API App"
  });
  const principal = await auth.admin.principals.create({
    displayName: "Grace Hopper",
    email: "grace@example.com",
    password: "refresh-secret"
  });
  const role = await auth.admin.roles.create({
    applicationId: application.id,
    name: "reader"
  });
  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: role.id,
    resource: "report",
    action: "read"
  });
  await auth.admin.memberships.assignRole({
    principalId: principal.id,
    applicationId: application.id,
    roleId: role.id
  });

  const login = JSON.parse(
    (
      await auth.handlers.login()({
        body: {
          applicationId: application.id,
          email: principal.email,
          password: "refresh-secret"
        }
      })
    ).body
  );

  const refreshed = await auth.session.refresh({ refreshToken: login.refreshToken });
  assert.ok(refreshed.accessToken);
  const oldVerification = await auth.session.verify({ accessToken: login.accessToken });
  assert.equal(oldVerification.ok, false);
  const newVerification = await auth.session.verify({ accessToken: refreshed.accessToken });
  assert.equal(newVerification.ok, true);
});

test("Blindfold Auth supports magic links and TOTP MFA", async () => {
  const auth = createAuth({
    workspaceId: "workspace_mfa",
    secret: "mfa-secret",
    storage: createMemoryStorage(),
    security: {
      magicLinks: {
        returnTokenInResponse: true
      }
    }
  });

  await auth.admin.bootstrapWorkspace({ name: "MFA Workspace" });
  const application = await auth.admin.applications.create({
    slug: "console-app",
    name: "Console App",
    config: {
      mfa: { required: true }
    }
  });
  const principal = await auth.admin.principals.create({
    displayName: "Mary Jackson",
    email: "mary@example.com",
    password: "mfa-password"
  });
  const role = await auth.admin.roles.create({
    applicationId: application.id,
    name: "operator"
  });
  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: role.id,
    resource: "console",
    action: "read"
  });
  await auth.admin.memberships.assignRole({
    principalId: principal.id,
    applicationId: application.id,
    roleId: role.id
  });

  const totpSetup = await auth.admin.principals.enableTotp({ principalId: principal.id });
  assert.equal(totpSetup.recoveryCodes.length, 8);
  await auth.admin.principals.confirmTotp({
    principalId: principal.id,
    code: totpSetup.currentCode
  });

  const mfaLogin = await auth.handlers.login()({
    body: {
      applicationId: application.id,
      email: principal.email,
      password: "mfa-password",
      mfaCode: totpSetup.currentCode
    }
  });
  assert.equal(mfaLogin.statusCode, 200);

  const magicLinkRequest = await auth.handlers.requestMagicLink()({
    body: {
      applicationId: application.id,
      email: principal.email,
      redirectTo: "/finish"
    }
  });
  const magicLinkPayload = JSON.parse(magicLinkRequest.body);
  const consumed = await auth.handlers.consumeMagicLink()({
    body: {
      applicationId: application.id,
      token: magicLinkPayload.token
    }
  });
  assert.equal(consumed.statusCode, 200);
});

test("Blindfold Auth hides magic link tokens by default and does not issue them for unauthorized app access", async () => {
  const storage = createMemoryStorage();
  const auth = createAuth({
    workspaceId: "workspace_magic_defaults",
    secret: "magic-default-secret",
    storage
  });

  await auth.admin.bootstrapWorkspace({ name: "Magic Defaults Workspace" });
  const application = await auth.admin.applications.create({
    slug: "finance-app",
    name: "Finance App"
  });
  const principal = await auth.admin.principals.create({
    displayName: "No Access User",
    email: "no-access@example.com",
    password: "no-access-password"
  });

  const unauthorizedRequest = await auth.handlers.requestMagicLink()({
    body: {
      applicationId: application.id,
      email: principal.email,
      redirectTo: "/finish"
    }
  });
  assert.equal(unauthorizedRequest.statusCode, 200);
  assert.deepEqual(JSON.parse(unauthorizedRequest.body), { ok: true });
  assert.deepEqual(await storage.list("auth_challenges"), []);

  const role = await auth.admin.roles.create({
    applicationId: application.id,
    name: "reader"
  });
  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: role.id,
    resource: "finance",
    action: "read"
  });
  await auth.admin.memberships.assignRole({
    principalId: principal.id,
    applicationId: application.id,
    roleId: role.id
  });

  const unsafeRedirectRequest = await auth.handlers.requestMagicLink()({
    body: {
      applicationId: application.id,
      email: principal.email,
      redirectTo: "https://example.com/finish"
    }
  });
  assert.equal(unsafeRedirectRequest.statusCode, 400);
  assert.deepEqual(JSON.parse(unsafeRedirectRequest.body), {
    error: "Redirect target must be a relative path"
  });

  const authorizedRequest = await auth.handlers.requestMagicLink()({
    body: {
      applicationId: application.id,
      email: principal.email,
      redirectTo: "/finish"
    }
  });
  assert.equal(authorizedRequest.statusCode, 200);
  assert.deepEqual(JSON.parse(authorizedRequest.body), { ok: true });

  const challenges = await storage.list("auth_challenges", {
    applicationId: application.id,
    principalId: principal.id
  });
  assert.equal(challenges.length, 1);
});

test("Blindfold Auth rejects unsafe logout tokens, cross-app protected usage, and revoked app access", async () => {
  const storage = createMemoryStorage();
  const auth = createAuth({
    workspaceId: "workspace_security_guards",
    secret: "security-guard-secret",
    storage
  });

  await auth.admin.bootstrapWorkspace({ name: "Security Guards Workspace" });
  const primaryApplication = await auth.admin.applications.create({
    slug: "primary-app",
    name: "Primary App"
  });
  const secondaryApplication = await auth.admin.applications.create({
    slug: "secondary-app",
    name: "Secondary App"
  });
  const principal = await auth.admin.principals.create({
    displayName: "Secure User",
    email: "secure@example.com",
    password: "secure-password"
  });
  const primaryRole = await auth.admin.roles.create({
    applicationId: primaryApplication.id,
    name: "reader"
  });
  await auth.admin.roles.grantPermission({
    applicationId: primaryApplication.id,
    roleId: primaryRole.id,
    resource: "report",
    action: "read"
  });
  await auth.admin.memberships.assignRole({
    principalId: principal.id,
    applicationId: primaryApplication.id,
    roleId: primaryRole.id
  });

  const loginPayload = JSON.parse(
    (
      await auth.handlers.login()({
        body: {
          applicationId: primaryApplication.id,
          email: principal.email,
          password: "secure-password"
        }
      })
    ).body
  );

  const forgedLogout = await auth.handlers.logout()({
    body: {
      refreshToken: `${loginPayload.session.id}.forged`
    }
  });
  assert.equal(forgedLogout.statusCode, 200);
  assert.equal((await auth.session.verify({ accessToken: loginPayload.accessToken })).ok, true);

  const crossAppRoute = auth.protect(
    {
      applicationId: secondaryApplication.id,
      resource: "report",
      action: "read"
    },
    async () => ({
      statusCode: 200,
      body: JSON.stringify({ ok: true })
    })
  );
  const crossAppResult = await crossAppRoute({
    headers: {
      authorization: `Bearer ${loginPayload.accessToken}`
    }
  });
  assert.equal(crossAppResult.statusCode, 403);
  assert.deepEqual(JSON.parse(crossAppResult.body), { error: "session application mismatch" });

  const memberships = await storage.list("memberships", {
    principalId: principal.id,
    applicationId: primaryApplication.id
  });
  await storage.delete("memberships", memberships[0].id);

  const verificationAfterMembershipRemoval = await auth.session.verify({
    accessToken: loginPayload.accessToken
  });
  assert.equal(verificationAfterMembershipRemoval.ok, false);
  assert.equal(verificationAfterMembershipRemoval.reason, "Principal has no access to this application");
});
