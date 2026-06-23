import { test } from "node:test";
import assert from "node:assert";
import { createTestAuth, runPolicySuite } from "../src/index.js";

async function harness() {
  return createTestAuth({
    app: { slug: "billing", name: "Billing" },
    users: [
      { email: "op@x.com", password: "test-password-123!", roles: ["operator"] },
      { email: "viewer@x.com", password: "test-password-123!", roles: ["viewer"] },
    ],
    roles: [
      { name: "operator", permissions: [{ resource: "invoice", action: "read" }, { resource: "invoice", action: "delete" }] },
      { name: "viewer", permissions: [{ resource: "invoice", action: "read" }] },
    ],
  });
}

test("runPolicySuite passes a correct table and reports totals", async () => {
  const t = await harness();
  const report = await runPolicySuite(t, [
    { name: "operator reads invoices", user: "op@x.com", action: "read", resource: "invoice", expect: "allow" },
    { name: "operator deletes invoices", user: "op@x.com", action: "delete", resource: "invoice", expect: "allow" },
    { name: "viewer cannot delete", user: "viewer@x.com", action: "delete", resource: "invoice", expect: "deny" },
  ]);
  assert.equal(report.total, 3);
  assert.equal(report.passed, 3);
  assert.equal(report.failed, 0);
  assert.ok(report.ok);
});

test("failures carry the actual decision so the developer sees why", async () => {
  const t = await harness();
  const report = await runPolicySuite(t, [
    { name: "viewer deletes invoices (wrong expectation)", user: "viewer@x.com", action: "delete", resource: "invoice", expect: "allow" },
  ]);
  assert.equal(report.failed, 1);
  assert.ok(!report.ok);
  const failure = report.results[0];
  assert.equal(failure.ok, false);
  assert.equal(failure.expected, "allow");
  assert.equal(failure.actual.effect, "deny");
  assert.match(failure.actual.reason, /default deny/);
});

test("object expectations check effect and obligations", async () => {
  const t = await harness();
  const report = await runPolicySuite(t, [
    {
      name: "read is a plain allow with no obligations",
      user: "viewer@x.com",
      action: "read",
      resource: "invoice",
      expect: { effect: "allow", maskedFields: [], readonlyFields: [] },
    },
  ]);
  assert.equal(report.passed, 1);
});

test("unnamed cases get a derived name and unknown users fail fast", async () => {
  const t = await harness();
  const report = await runPolicySuite(t, [
    { user: "ghost@x.com", action: "read", resource: "invoice", expect: "deny" },
  ]);
  assert.equal(report.results[0].name, "ghost@x.com read invoice → deny");
  // Unknown principal: decision is a deny, so the expectation holds.
  assert.equal(report.passed, 1);
});
