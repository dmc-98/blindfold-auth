import { test } from "node:test";
import assert from "node:assert";
import { evaluatePolicies, explainPolicies } from "../src/policy.js";

const baseQuery = {
  applicationId: "app_1",
  tenantId: null,
  principalId: "user_1",
  roleIds: ["role_editor"],
  resource: "invoice",
  action: "read",
};

const allowRule = { id: "p_allow", roleId: "role_editor", resource: "invoice", action: "read", effect: "allow", priority: 10 };
const denyRule = { id: "p_deny", principalId: "user_1", resource: "invoice", action: "read", effect: "deny", priority: 50, reason: "suspended" };
const maskRule = { id: "p_mask", roleId: "role_editor", resource: "invoice", action: "read", field: "amount", effect: "mask", priority: 5 };
const wrongResourceRule = { id: "p_other", roleId: "role_editor", resource: "payroll", action: "read", effect: "allow", priority: 10 };
const conditionalRule = {
  id: "p_cond",
  roleId: "role_editor",
  resource: "invoice",
  action: "read",
  effect: "allow",
  priority: 20,
  conditionJson: { eq: ["subject.department", "finance"] },
};

function explain(overrides: Record<string, unknown> = {}) {
  return explainPolicies({
    rolePermissions: [],
    directGrants: [],
    policies: [],
    context: { subject: { department: "engineering" } },
    query: baseQuery,
    ...overrides,
  } as never);
}

test("explain decision is identical to evaluatePolicies for the same input", () => {
  const input = {
    rolePermissions: [],
    directGrants: [denyRule],
    policies: [allowRule, maskRule],
    context: {},
    query: baseQuery,
  };
  assert.deepEqual(explainPolicies(input as never).decision, evaluatePolicies(input as never));
});

test("scope-missed rules are traced with the failing component named", () => {
  const trace = explain({ policies: [wrongResourceRule, allowRule] });
  const missed = trace.steps.find((s) => s.ruleId === "p_other");
  assert.ok(missed);
  assert.equal(missed!.outcome, "skipped-scope");
  assert.deepEqual(missed!.scopeMisses, ["resource"]);
  assert.equal(missed!.conditionMatched, null);
});

test("condition-failed rules are traced as skipped-condition", () => {
  const trace = explain({ policies: [conditionalRule, allowRule] });
  const skipped = trace.steps.find((s) => s.ruleId === "p_cond");
  assert.ok(skipped);
  assert.equal(skipped!.outcome, "skipped-condition");
  assert.equal(skipped!.conditionMatched, false);
  assert.equal(trace.decision.allowed, true);
});

test("an explicit deny shadows a matched allow, and the trace says so", () => {
  const trace = explain({ policies: [allowRule], directGrants: [denyRule] });
  assert.equal(trace.decision.allowed, false);
  assert.equal(trace.decidingRuleId, "p_deny");
  const shadowed = trace.steps.find((s) => s.ruleId === "p_allow");
  assert.equal(shadowed!.outcome, "shadowed");
  const applied = trace.steps.find((s) => s.ruleId === "p_deny");
  assert.equal(applied!.outcome, "applied");
});

test("default deny is explicit in the trace", () => {
  const trace = explain({});
  assert.equal(trace.decision.allowed, false);
  assert.equal(trace.defaultDeny, true);
  assert.equal(trace.decidingRuleId, null);
});

test("mask obligations show as applied alongside the deciding allow", () => {
  // Field-scoped rules only participate when the query names the field —
  // same semantics as the original evaluator (matchesField).
  const trace = explain({ policies: [allowRule, maskRule], query: { ...baseQuery, field: "amount" } });
  assert.equal(trace.decision.effect, "mask");
  assert.deepEqual(trace.decision.obligations.maskedFields, ["amount"]);
  assert.equal(trace.steps.find((s) => s.ruleId === "p_mask")!.outcome, "applied");
  assert.equal(trace.decidingRuleId, "p_allow");
});

test("hard denies short-circuit and the trace records why", () => {
  const trace = explain({ policies: [allowRule], hardDenyReasons: ["session revoked"] });
  assert.equal(trace.decision.allowed, false);
  assert.equal(trace.hardDenyReason, "session revoked");
  assert.equal(trace.steps.length, 0);
});

test("steps are ordered by evaluation priority (highest first)", () => {
  const trace = explain({ policies: [allowRule, conditionalRule], directGrants: [denyRule] });
  const applied = trace.steps.filter((s) => s.outcome !== "skipped-scope");
  const priorities = applied.map((s) => s.priority);
  assert.deepEqual(priorities, [...priorities].sort((a, b) => b - a));
});
