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

function matchesScope(rule: any, query: PolicyQuery): boolean {
  if (rule.applicationId && rule.applicationId !== query.applicationId) {
    return false;
  }

  if (rule.tenantId && rule.tenantId !== query.tenantId) {
    return false;
  }

  if (rule.principalId && rule.principalId !== query.principalId) {
    return false;
  }

  if (rule.roleId && !query.roleIds.includes(rule.roleId)) {
    return false;
  }

  return matchesResource(rule.resource, query.resource) && matchesAction(rule.action, query.action) && matchesField(rule.field, query.field);
}

export interface EvaluatePoliciesInput {
  rolePermissions: any[];
  directGrants: any[];
  policies: any[];
  context: any;
  query: PolicyQuery;
  hardDenyReasons?: string[];
}

export function evaluatePolicies({
  rolePermissions,
  directGrants,
  policies,
  context,
  query,
  hardDenyReasons = []
}: EvaluatePoliciesInput): PolicyDecision {
  const matchedRuleIds: string[] = [];
  const maskedFields = new Set<string>();
  const readonlyFields = new Set<string>();

  if (hardDenyReasons.length > 0) {
    return {
      allowed: false,
      effect: "deny",
      matchedRuleIds,
      obligations: { maskedFields: [], readonlyFields: [] },
      reason: hardDenyReasons[0]!
    };
  }

  const allRules = [
    ...rolePermissions.map((permission) => ({
      ...permission,
      id: permission.id || `permission:${permission.roleId}:${permission.resource}:${permission.action}`,
      effect: permission.effect || "allow",
      priority: permission.priority ?? 10
    })),
    ...directGrants,
    ...policies
  ]
    .filter((rule) => matchesScope(rule, query))
    .filter((rule) => evaluateCondition(rule.conditionJson, context))
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));

  const explicitDeny = allRules.find((rule) => rule.effect === "deny");
  if (explicitDeny) {
    matchedRuleIds.push(explicitDeny.id);
    return {
      allowed: false,
      effect: "deny",
      matchedRuleIds,
      obligations: { maskedFields: [], readonlyFields: [] },
      reason: explicitDeny.reason || "explicit deny"
    };
  }

  const maskRules = allRules.filter((rule) => rule.effect === "mask" && rule.field);
  for (const rule of maskRules) {
    matchedRuleIds.push(rule.id);
    maskedFields.add(rule.field);
  }

  const readonlyRules = allRules.filter((rule) => rule.effect === "readonly" && rule.field);
  for (const rule of readonlyRules) {
    matchedRuleIds.push(rule.id);
    readonlyFields.add(rule.field);
  }

  const explicitAllow = allRules.find((rule) => rule.effect === "allow");
  if (!explicitAllow && maskedFields.size === 0 && readonlyFields.size === 0) {
    return {
      allowed: false,
      effect: "deny",
      matchedRuleIds,
      obligations: { maskedFields: [], readonlyFields: [] },
      reason: "default deny"
    };
  }

  if (explicitAllow) {
    matchedRuleIds.push(explicitAllow.id);
  }

  return {
    allowed: true,
    effect: maskedFields.size > 0 ? "mask" : readonlyFields.size > 0 ? "readonly" : "allow",
    matchedRuleIds,
    obligations: {
      maskedFields: [...maskedFields],
      readonlyFields: [...readonlyFields]
    },
    reason: explicitAllow ? "explicit allow" : "field obligation"
  };
}
