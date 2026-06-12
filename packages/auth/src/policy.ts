import { ensureArray, getPathValue } from "./utils.js";
import type { PolicyDecision } from "./types.js";

type Condition = Record<string, any> | null | undefined;

function resolveOperand(operand: any, context: any): any {
  if (typeof operand === "string" && /^(subject|resource|request)\./.test(operand)) {
    return getPathValue(context, operand);
  }

  return operand;
}

export function evaluateCondition(condition: Condition, context: any): boolean {
  if (!condition) {
    return true;
  }

  if (condition.all) {
    return ensureArray(condition.all).every((entry: any) => evaluateCondition(entry, context));
  }

  if (condition.any) {
    return ensureArray(condition.any).some((entry: any) => evaluateCondition(entry, context));
  }

  if (condition.not) {
    return !evaluateCondition(condition.not, context);
  }

  if (condition.eq) {
    const [left, right] = condition.eq;
    return resolveOperand(left, context) === resolveOperand(right, context);
  }

  if (condition.neq) {
    const [left, right] = condition.neq;
    return resolveOperand(left, context) !== resolveOperand(right, context);
  }

  if (condition.in) {
    const [needle, haystack] = condition.in;
    return ensureArray(resolveOperand(haystack, context)).includes(resolveOperand(needle, context));
  }

  if (condition.contains) {
    const [haystack, needle] = condition.contains;
    const value = resolveOperand(haystack, context);
    if (Array.isArray(value)) {
      return value.includes(resolveOperand(needle, context));
    }

    return String(value || "").includes(String(resolveOperand(needle, context)));
  }

  if (condition.gt) {
    const [left, right] = condition.gt;
    return resolveOperand(left, context) > resolveOperand(right, context);
  }

  if (condition.gte) {
    const [left, right] = condition.gte;
    return resolveOperand(left, context) >= resolveOperand(right, context);
  }

  if (condition.lt) {
    const [left, right] = condition.lt;
    return resolveOperand(left, context) < resolveOperand(right, context);
  }

  if (condition.lte) {
    const [left, right] = condition.lte;
    return resolveOperand(left, context) <= resolveOperand(right, context);
  }

  if (condition.exists) {
    return resolveOperand(condition.exists, context) !== undefined;
  }

  return false;
}

function matchesField(ruleField: string | undefined, requestedField: string | undefined): boolean {
  if (!ruleField || ruleField === "*") {
    return true;
  }

  if (!requestedField) {
    return false;
  }

  return ruleField === requestedField;
}

function matchesResource(ruleResource: string | undefined, requestedResource: string | undefined): boolean {
  return !ruleResource || ruleResource === "*" || ruleResource === requestedResource;
}

function matchesAction(ruleAction: string | undefined, requestedAction: string | undefined): boolean {
  return !ruleAction || ruleAction === "*" || ruleAction === requestedAction;
}

interface PolicyQuery {
  applicationId?: string;
  tenantId?: string | null;
  principalId?: string;
  roleIds: string[];
  resource?: string;
  action?: string;
  field?: string;
}

/**
 * Names every scope component a rule fails on — the heart of explain():
 * "this rule was skipped because its `resource` doesn't match" is the
 * answer operators actually need when debugging a deny.
 */
function scopeMisses(rule: any, query: PolicyQuery): string[] {
  const misses: string[] = [];
  if (rule.applicationId && rule.applicationId !== query.applicationId) misses.push("applicationId");
  if (rule.tenantId && rule.tenantId !== query.tenantId) misses.push("tenantId");
  if (rule.principalId && rule.principalId !== query.principalId) misses.push("principalId");
  if (rule.roleId && !query.roleIds.includes(rule.roleId)) misses.push("roleId");
  if (!matchesResource(rule.resource, query.resource)) misses.push("resource");
  if (!matchesAction(rule.action, query.action)) misses.push("action");
  if (!matchesField(rule.field, query.field)) misses.push("field");
  return misses;
}

function matchesScope(rule: any, query: PolicyQuery): boolean {
  return scopeMisses(rule, query).length === 0;
}

export interface EvaluatePoliciesInput {
  rolePermissions: any[];
  directGrants: any[];
  policies: any[];
  context: any;
  query: PolicyQuery;
  hardDenyReasons?: string[];
}

/** One rule's journey through an evaluation — the unit of a policy trace. */
export interface PolicyTraceStep {
  ruleId: string;
  source: "rolePermission" | "directGrant" | "policy";
  effect: string;
  priority: number;
  /** Scope components that failed to match ([] when scope matched). */
  scopeMisses: string[];
  /** null when the condition was never evaluated (scope already missed). */
  conditionMatched: boolean | null;
  /**
   * applied — contributed to the decision (deciding rule or field obligation)
   * shadowed — matched fully but outranked by the deciding rule
   * skipped-scope / skipped-condition — never eligible
   */
  outcome: "applied" | "shadowed" | "skipped-scope" | "skipped-condition";
}

export interface PolicyExplanation {
  decision: PolicyDecision;
  steps: PolicyTraceStep[];
  /** Rule that decided allow/deny (null on default deny and hard deny). */
  decidingRuleId: string | null;
  defaultDeny: boolean;
  hardDenyReason: string | null;
}

/**
 * explainPolicies — the primary evaluator. Walks every rule and records why
 * it did or didn't participate, then derives the decision from the applied
 * set. evaluatePolicies() delegates here, so a trace can never disagree with
 * the decision an application actually enforced.
 */
export function explainPolicies({
  rolePermissions,
  directGrants,
  policies,
  context,
  query,
  hardDenyReasons = []
}: EvaluatePoliciesInput): PolicyExplanation {
  const empty = { maskedFields: [] as string[], readonlyFields: [] as string[] };

  if (hardDenyReasons.length > 0) {
    return {
      decision: { allowed: false, effect: "deny", matchedRuleIds: [], obligations: empty, reason: hardDenyReasons[0]! },
      steps: [],
      decidingRuleId: null,
      defaultDeny: false,
      hardDenyReason: hardDenyReasons[0]!
    };
  }

  const tagged = [
    ...rolePermissions.map((permission) => ({
      rule: {
        ...permission,
        id: permission.id || `permission:${permission.roleId}:${permission.resource}:${permission.action}`,
        effect: permission.effect || "allow",
        priority: permission.priority ?? 10
      },
      source: "rolePermission" as const
    })),
    ...directGrants.map((rule) => ({ rule, source: "directGrant" as const })),
    ...policies.map((rule) => ({ rule, source: "policy" as const }))
  ];

  const steps: PolicyTraceStep[] = tagged
    .map(({ rule, source }) => {
      const misses = scopeMisses(rule, query);
      const conditionMatched = misses.length > 0 ? null : evaluateCondition(rule.conditionJson, context);
      const outcome: PolicyTraceStep["outcome"] =
        misses.length > 0 ? "skipped-scope" : conditionMatched ? "shadowed" : "skipped-condition";
      return { ruleId: rule.id, source, effect: rule.effect, priority: rule.priority ?? 0, scopeMisses: misses, conditionMatched, outcome, _rule: rule } as PolicyTraceStep & { _rule: any };
    })
    .sort((left, right) => right.priority - left.priority);

  const eligible = steps.filter((s) => s.outcome === "shadowed");
  const matchedRuleIds: string[] = [];
  const maskedFields = new Set<string>();
  const readonlyFields = new Set<string>();

  const finish = (decision: PolicyDecision, decidingRuleId: string | null, defaultDeny = false): PolicyExplanation => {
    for (const s of steps) delete (s as { _rule?: unknown })._rule;
    return { decision, steps, decidingRuleId, defaultDeny, hardDenyReason: null };
  };

  const explicitDeny = eligible.find((s) => s.effect === "deny");
  if (explicitDeny) {
    explicitDeny.outcome = "applied";
    matchedRuleIds.push(explicitDeny.ruleId);
    const reason = (explicitDeny as { _rule?: { reason?: string } })._rule?.reason || "explicit deny";
    return finish(
      { allowed: false, effect: "deny", matchedRuleIds, obligations: empty, reason },
      explicitDeny.ruleId
    );
  }

  // Two passes (masks, then readonlys) to keep matchedRuleIds ordering
  // byte-identical with the original evaluatePolicies implementation.
  for (const s of eligible) {
    const field = (s as { _rule?: { field?: string } })._rule?.field;
    if (s.effect === "mask" && field) {
      s.outcome = "applied";
      matchedRuleIds.push(s.ruleId);
      maskedFields.add(field);
    }
  }
  for (const s of eligible) {
    const field = (s as { _rule?: { field?: string } })._rule?.field;
    if (s.effect === "readonly" && field) {
      s.outcome = "applied";
      matchedRuleIds.push(s.ruleId);
      readonlyFields.add(field);
    }
  }

  const explicitAllow = eligible.find((s) => s.effect === "allow");
  if (!explicitAllow && maskedFields.size === 0 && readonlyFields.size === 0) {
    return finish(
      { allowed: false, effect: "deny", matchedRuleIds, obligations: empty, reason: "default deny" },
      null,
      true
    );
  }

  if (explicitAllow) {
    explicitAllow.outcome = "applied";
    matchedRuleIds.push(explicitAllow.ruleId);
  }

  return finish(
    {
      allowed: true,
      effect: maskedFields.size > 0 ? "mask" : readonlyFields.size > 0 ? "readonly" : "allow",
      matchedRuleIds,
      obligations: { maskedFields: [...maskedFields], readonlyFields: [...readonlyFields] },
      reason: explicitAllow ? "explicit allow" : "field obligation"
    },
    explicitAllow ? explicitAllow.ruleId : null
  );
}

export function evaluatePolicies(input: EvaluatePoliciesInput): PolicyDecision {
  return explainPolicies(input).decision;
}
