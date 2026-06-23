import { test } from "node:test";
import assert from "node:assert";
import { createAuth } from "../src/auth.js";

async function setup() {
  const auth = createAuth({ secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9" });
  await auth.admin.bootstrapWorkspace({ name: "Explain WS" });
  const app = await auth.admin.applications.create({ slug: "billing", name: "Billing" });
  const user = await auth.admin.principals.create({ email: "op@x.com", password: "explain-test-password!", displayName: "Op" });
  const role = await auth.admin.roles.create({ applicationId: app.id, name: "operator" });
  await auth.admin.roles.grantPermission({ applicationId: app.id, roleId: role.id, resource: "invoice", action: "read" });
  await auth.admin.memberships.assignRole({ principalId: user.id, applicationId: app.id, roleId: role.id });
  return { auth, app, user, role };
}

test("auth.explain() returns the same decision as auth.can() plus a trace", async () => {
  const { auth, app, user } = await setup();
  const query = { principalId: user.id, applicationId: app.id, resource: "invoice", action: "read" };
  const decision = await auth.can(query);
  const explained = await auth.explain(query);
  assert.equal(explained.allowed, decision.allowed);
  assert.equal(explained.effect, decision.effect);
  assert.ok(explained.trace, "expected a trace");
  assert.ok(Array.isArray(explained.trace.steps));
  assert.equal(explained.trace.decidingRuleId, explained.matchedRuleIds[explained.matchedRuleIds.length - 1]);
  assert.equal(typeof explained.trace.context, "object");
});

test("auth.can() output shape is unchanged (no trace leaks into hot path)", async () => {
  const { auth, app, user } = await setup();
  const decision = await auth.can({ principalId: user.id, applicationId: app.id, resource: "invoice", action: "read" });
  assert.equal(decision.allowed, true);
  assert.equal("trace" in decision, false);
});

test("explain names the scope misses behind a default deny", async () => {
  const { auth, app, user } = await setup();
  const explained = await auth.explain({ principalId: user.id, applicationId: app.id, resource: "payroll", action: "read" });
  assert.equal(explained.allowed, false);
  assert.ok(explained.trace);
  const trace = explained.trace!;
  assert.equal(trace.defaultDeny, true);
  const step = trace.steps.find((s: any) => s.outcome === "skipped-scope");
  assert.ok(step, "expected a skipped-scope step");
  assert.ok(step.scopeMisses.includes("resource"));
});
