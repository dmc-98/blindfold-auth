import { test } from "node:test";
import assert from "node:assert";
import { createAuth } from "../src/auth.js";

async function setup() {
  const auth = createAuth({ secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9" });
  await auth.admin.bootstrapWorkspace({ name: "DryRun WS" });
  const app = await auth.admin.applications.create({ slug: "billing", name: "Billing" });
  const user = await auth.admin.principals.create({ email: "op@x.com", password: "policy-test-password!", displayName: "Op" });
  const role = await auth.admin.roles.create({ applicationId: app.id, name: "operator" });
  await auth.admin.roles.grantPermission({ applicationId: app.id, roleId: role.id, resource: "invoice", action: "read" });
  await auth.admin.memberships.assignRole({ principalId: user.id, applicationId: app.id, roleId: role.id });
  return { auth, app, user, role };
}

test("dryRunPolicies shows before/after for a proposed deny without persisting it", async () => {
  const { auth, app, user } = await setup();
  const proposedDeny = { id: "proposed_deny", principalId: user.id, resource: "invoice", action: "read", effect: "deny", priority: 99, reason: "incident lockdown" };

  const report = await auth.admin.policies.dryRun({
    applicationId: app.id,
    addPolicies: [proposedDeny],
    cases: [{ principalId: user.id, resource: "invoice", action: "read" }],
  });

  assert.equal(report.cases.length, 1);
  const c = report.cases[0];
  assert.equal(c.before.allowed, true);
  assert.equal(c.after.allowed, false);
  assert.equal(c.after.reason, "incident lockdown");
  assert.equal(c.changed, true);

  // Nothing persisted: the live decision is still allow.
  const live = await auth.can({ principalId: user.id, applicationId: app.id, resource: "invoice", action: "read" });
  assert.equal(live.allowed, true);
});

test("dryRunPolicies can simulate removing an existing rule", async () => {
  const { auth, app, user } = await setup();
  // Add a real deny policy, then simulate removing it.
  const deny = await auth.admin.policies.add({
    applicationId: app.id, principalId: user.id, resource: "invoice", action: "read", effect: "deny", priority: 99,
  });

  const report = await auth.admin.policies.dryRun({
    applicationId: app.id,
    removePolicyIds: [deny.id],
    cases: [{ principalId: user.id, resource: "invoice", action: "read" }],
  });

  const c = report.cases[0];
  assert.equal(c.before.allowed, false);
  assert.equal(c.after.allowed, true);
  assert.equal(c.changed, true);
  assert.equal(report.summary.changed, 1);
  assert.equal(report.summary.total, 1);
});

test("unchanged cases are flagged as such", async () => {
  const { auth, app, user } = await setup();
  const report = await auth.admin.policies.dryRun({
    applicationId: app.id,
    addPolicies: [{ id: "p_unrelated", resource: "payroll", action: "read", effect: "deny", priority: 99 }],
    cases: [{ principalId: user.id, resource: "invoice", action: "read" }],
  });
  assert.equal(report.cases[0].changed, false);
  assert.equal(report.summary.changed, 0);
});
