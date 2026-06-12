/**
 * runPolicySuite — table-driven policy assertions (PRD: policy test runner).
 *
 * Lets teams pin their authorization model in CI with a declarative table
 * instead of hand-rolled assert pairs:
 *
 *   const report = await runPolicySuite(t, [
 *     { name: "operators read invoices", user: "op@x.com", action: "read", resource: "invoice", expect: "allow" },
 *     { user: "viewer@x.com", action: "delete", resource: "invoice", expect: "deny" },
 *     { user: "op@x.com", action: "read", resource: "invoice", expect: { effect: "mask", maskedFields: ["amount"] } },
 *   ]);
 *   assert.ok(report.ok, report.summary);
 *
 * Failures carry the full actual decision (effect, reason, obligations) so a
 * red CI run explains itself. Pairs with explainPolicies() traces once
 * auth.explain() is wired through the runtime.
 */

export interface PolicyCase {
  /** Defaults to "<user> <action> <resource> → <expect>" when omitted. */
  name?: string;
  /** Email or principal id, resolved the same way as harness.can(). */
  user: string;
  action: string;
  resource: string;
  context?: Record<string, unknown>;
  /** "allow" / "deny" shorthand, or a partial decision to match. */
  expect: "allow" | "deny" | ExpectedDecision;
}

export interface ExpectedDecision {
  allowed?: boolean;
  effect?: "allow" | "deny" | "mask" | "readonly";
  maskedFields?: string[];
  readonlyFields?: string[];
}

export interface PolicyCaseResult {
  name: string;
  ok: boolean;
  expected: PolicyCase["expect"];
  actual: { allowed: boolean; effect: string; reason: string; maskedFields: string[]; readonlyFields: string[] };
  mismatches: string[];
}

export interface PolicySuiteReport {
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  results: PolicyCaseResult[];
  /** One-line human summary, ready for assertion messages. */
  summary: string;
}

interface PolicyHarness {
  can(emailOrId: string, action: string, resource: string, context?: Record<string, unknown>): Promise<any>;
}

function normalizeExpectation(expect: PolicyCase["expect"]): ExpectedDecision {
  if (expect === "allow") return { allowed: true };
  if (expect === "deny") return { allowed: false };
  return expect;
}

function sortedEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, i) => value === b[i]);
}

export async function runPolicySuite(
  // Accepts the loosely-typed harness createTestAuth() returns; can() is
  // validated at runtime so plain objects with a can() method also work.
  harnessLike: PolicyHarness | Record<string, any>,
  cases: PolicyCase[]
): Promise<PolicySuiteReport> {
  const harness = harnessLike as PolicyHarness;
  if (typeof harness.can !== "function") {
    throw new Error("runPolicySuite requires a harness with a can(user, action, resource, context) method — pass the result of createTestAuth().");
  }
  const results: PolicyCaseResult[] = [];

  for (const c of cases) {
    const name = c.name ?? `${c.user} ${c.action} ${c.resource} → ${typeof c.expect === "string" ? c.expect : JSON.stringify(c.expect)}`;
    const decision = await harness.can(c.user, c.action, c.resource, c.context ?? {});
    const actual = {
      allowed: Boolean(decision?.allowed),
      effect: String(decision?.effect ?? "deny"),
      reason: String(decision?.reason ?? ""),
      maskedFields: (decision?.obligations?.maskedFields ?? []) as string[],
      readonlyFields: (decision?.obligations?.readonlyFields ?? []) as string[],
    };

    const expected = normalizeExpectation(c.expect);
    const mismatches: string[] = [];
    if (expected.allowed !== undefined && expected.allowed !== actual.allowed) {
      mismatches.push(`allowed: expected ${expected.allowed}, got ${actual.allowed} (${actual.reason})`);
    }
    if (expected.effect !== undefined && expected.effect !== actual.effect) {
      mismatches.push(`effect: expected ${expected.effect}, got ${actual.effect}`);
    }
    if (expected.maskedFields !== undefined && !sortedEqual(expected.maskedFields, actual.maskedFields)) {
      mismatches.push(`maskedFields: expected [${expected.maskedFields}], got [${actual.maskedFields}]`);
    }
    if (expected.readonlyFields !== undefined && !sortedEqual(expected.readonlyFields, actual.readonlyFields)) {
      mismatches.push(`readonlyFields: expected [${expected.readonlyFields}], got [${actual.readonlyFields}]`);
    }

    results.push({ name, ok: mismatches.length === 0, expected: c.expect, actual, mismatches });
  }

  const failed = results.filter((r) => !r.ok);
  const summary =
    failed.length === 0
      ? `policy suite: ${results.length}/${results.length} passed`
      : `policy suite: ${failed.length}/${results.length} FAILED — ${failed.map((f) => `"${f.name}" (${f.mismatches.join("; ")})`).join(" · ")}`;

  return { ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed: failed.length, results, summary };
}
