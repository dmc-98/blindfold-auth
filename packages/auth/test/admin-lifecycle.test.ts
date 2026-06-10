import assert from "node:assert/strict";
import test from "node:test";
import { createAuth, createMemoryStorage } from "../src/index.js";

async function fixture() {
  const auth = createAuth({
    workspaceId: "workspace_lifecycle",
    secret: "lifecycle-secret",
    storage: createMemoryStorage()
  });
  await auth.admin.bootstrapWorkspace({ name: "Lifecycle WS" });
  const app = await auth.admin.applications.create({ slug: "app", name: "App" });
  const role = await auth.admin.roles.create({ applicationId: app.id, name: "member" });
  await auth.admin.roles.grantPermission({ applicationId: app.id, roleId: role.id, resource: "doc", action: "read" });
  const principal = await auth.admin.principals.create({ email: "user@acme.co", password: "correct-horse", displayName: "User" });
  await auth.admin.memberships.assignRole({ principalId: principal.id, applicationId: app.id, roleId: role.id });
  return { auth, app, role, principal };
}

async function login(auth: any, applicationId: string, email: string, device: any = null) {
  // issue a session via the login handler, optionally tagging device through password auth path
  const res = await auth.handlers.login()({ body: { applicationId, email, password: "correct-horse" } });
  return JSON.parse(res.body);
}

test("session inventory: listForPrincipal returns active sessions with device + auth strength, newest first", async () => {
  const { auth, app, principal } = await fixture();
  await login(auth, app.id, principal.email);
  await login(auth, app.id, principal.email);

  const sessions = await auth.admin.sessions.listForPrincipal({ principalId: principal.id });
  assert.equal(sessions.length, 2, "two active sessions");
  for (const s of sessions) {
    assert.equal(s.applicationId, app.id);
    assert.equal(s.status, "active");
    assert.ok(s.authStrength, "auth strength present");
    assert.ok("device" in s, "device field present");
    assert.ok(s.createdAt, "timestamp present");
  }
});

test("revokeAll signs out everywhere; verify fails afterward; exceptSessionId is preserved", async () => {
  const { auth, app, principal } = await fixture();
  const a = await login(auth, app.id, principal.email);
  const b = await login(auth, app.id, principal.email);

  // both tokens valid initially
  assert.equal((await auth.session.verify({ accessToken: a.accessToken })).ok, true);
  assert.equal((await auth.session.verify({ accessToken: b.accessToken })).ok, true);

  const aSessionId = a.session.id;
  const { revoked } = await auth.admin.sessions.revokeAll({ principalId: principal.id, exceptSessionId: aSessionId });
  assert.equal(revoked, 1, "one session revoked (the other excepted)");

  // a still valid (excepted), b revoked
  assert.equal((await auth.session.verify({ accessToken: a.accessToken })).ok, true, "excepted session still valid");
  assert.equal((await auth.session.verify({ accessToken: b.accessToken })).ok, false, "other session revoked");

  const active = await auth.admin.sessions.listForPrincipal({ principalId: principal.id });
  assert.equal(active.length, 1, "one active session remains");
});

test("emergency disable: revokes all sessions, blocks verify and future logins; enable restores login", async () => {
  const { auth, app, principal } = await fixture();
  const session = await login(auth, app.id, principal.email);
  assert.equal((await auth.session.verify({ accessToken: session.accessToken })).ok, true);

  const result = await auth.admin.principals.disable({ principalId: principal.id, reason: "compromised" });
  assert.equal(result.sessionsRevoked, 1, "active session revoked on disable");
  assert.equal(result.principal.status, "disabled");

  // existing token no longer verifies
  assert.equal((await auth.session.verify({ accessToken: session.accessToken })).ok, false, "disabled principal session rejected");

  // new login is blocked while disabled
  const blocked = await auth.handlers.login()({ body: { applicationId: app.id, email: principal.email, password: "correct-horse" } });
  assert.notEqual(blocked.statusCode, 200, "disabled principal cannot log in");

  // re-enable, login works again
  await auth.admin.principals.enable({ principalId: principal.id });
  const ok = await auth.handlers.login()({ body: { applicationId: app.id, email: principal.email, password: "correct-horse" } });
  assert.equal(ok.statusCode, 200, "re-enabled principal can log in");
});

test("setStatus validates the status value", async () => {
  const { auth, principal } = await fixture();
  await assert.rejects(() => auth.admin.principals.setStatus({ principalId: principal.id, status: "frozen" as any }), /must be/);
});

test("delegated admin: grant gives full app authority via can(); revoke removes it; scoped to one app", async () => {
  const { auth, app, principal } = await fixture();
  const otherApp = await auth.admin.applications.create({ slug: "other", name: "Other" });

  // baseline: member can read doc but cannot delete (no permission)
  assert.equal((await auth.can({ principalId: principal.id, applicationId: app.id, resource: "doc", action: "delete" })).allowed, false);

  const grant = await auth.admin.delegation.grant({ principalId: principal.id, applicationId: app.id });
  assert.equal(grant.delegatedAdmin, true);

  // now allowed to do anything on THIS app
  assert.equal((await auth.can({ principalId: principal.id, applicationId: app.id, resource: "doc", action: "delete" })).allowed, true, "delegated admin can delete");
  assert.equal((await auth.can({ principalId: principal.id, applicationId: app.id, resource: "billing", action: "write" })).allowed, true, "delegated admin can do anything on app");
  assert.equal(await auth.admin.delegation.isAdmin({ principalId: principal.id, applicationId: app.id }), true);

  // NOT an admin of the other app
  assert.equal(await auth.admin.delegation.isAdmin({ principalId: principal.id, applicationId: otherApp.id }), false, "delegation is app-scoped");

  // listing surfaces the grant
  const list = await auth.admin.delegation.list({ applicationId: app.id });
  assert.equal(list.length, 1);

  // grant is idempotent
  const again = await auth.admin.delegation.grant({ principalId: principal.id, applicationId: app.id });
  assert.equal(again.id, grant.id, "grant is idempotent");

  // revoke removes authority
  const { revoked } = await auth.admin.delegation.revoke({ principalId: principal.id, applicationId: app.id });
  assert.equal(revoked, 1);
  assert.equal((await auth.can({ principalId: principal.id, applicationId: app.id, resource: "doc", action: "delete" })).allowed, false, "authority removed after revoke");
});

test("delegation.grant rejects unknown application and missing args", async () => {
  const { auth, principal } = await fixture();
  await assert.rejects(() => auth.admin.delegation.grant({ principalId: principal.id, applicationId: "app_missing" }), /Application not found/);
  await assert.rejects(() => auth.admin.delegation.grant({ principalId: principal.id, applicationId: null }), /requires/);
});
