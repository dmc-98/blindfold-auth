# Explain Decisions

`auth.explain()` returns the same allow/deny decision as `auth.can()`, plus a full per-rule trace showing exactly why the decision was made. This is the primary tool for debugging authorization issues.

## Basic usage

```ts
const trace = await auth.explain({
  principalId: 'principal_alice',
  applicationId: app.id,
  action: 'delete',
  resource: 'invoice',
  resourceId: 'invoice_123',
  resourceAttributes: { ownerId: 'principal_bob', status: 'approved' },
})

console.log(trace.decision.allowed)   // false
console.log(trace.decision.effect)    // 'deny'
console.log(trace.decidingRuleId)     // 'policy_no-weekend-deletes'
console.log(trace.defaultDeny)        // false (an explicit deny fired)
console.log(trace.hardDenyReason)     // undefined (no hard deny)
```

## Trace structure

```ts
interface ExplainResult {
  // Same as auth.can() result
  decision: {
    allowed: boolean
    effect: 'allow' | 'deny' | 'mask' | 'readonly'
    reason: string
  }

  // Which policy determined the final outcome
  decidingRuleId: string | null

  // True if no policy matched and default-deny fired
  defaultDeny: boolean

  // Non-null if a hard security guardrail fired (cannot be overridden)
  hardDenyReason: string | null

  // Per-rule evaluation results
  rules: RuleTrace[]

  // The request context as seen by the evaluator
  evaluationContext: Record<string, unknown>
}

interface RuleTrace {
  policyId: string
  policyName: string
  outcome: 'applied' | 'shadowed' | 'skipped-scope' | 'skipped-condition'

  // Why the rule was skipped (if skipped-scope)
  scopeMismatches?: {
    role?: string[]     // roles that didn't match
    action?: string[]   // actions that didn't match
    resource?: string[] // resources that didn't match
    field?: string[]    // fields that didn't match
  }

  // Which condition failed (if skipped-condition)
  failingCondition?: {
    attribute: string
    operator: string
    expected: unknown
    actual: unknown
  }
}
```

## Reading a trace

```ts
for (const rule of trace.rules) {
  if (rule.outcome === 'applied') {
    console.log(`✅ Applied: ${rule.policyName}`)
  } else if (rule.outcome === 'skipped-scope') {
    console.log(`— Skipped (scope): ${rule.policyName}`)
    console.log('   Mismatches:', rule.scopeMismatches)
  } else if (rule.outcome === 'skipped-condition') {
    console.log(`— Skipped (condition): ${rule.policyName}`)
    console.log('   Failed:', rule.failingCondition)
  }
}
```

## Example: debugging a surprise deny

A user reports they cannot delete an invoice they own. You call `auth.explain()` to find out why:

```ts
const trace = await auth.explain({
  principalId: user.id,
  applicationId: app.id,
  action: 'delete',
  resource: 'invoice',
  resourceAttributes: { ownerId: user.id, status: 'draft' },
})

// Output:
// decidingRuleId: 'policy_finance-required-for-delete'
// rules[0]: { outcome: 'applied', policyName: 'finance-required-for-delete' }
//           → effect: deny, role check: user not in 'finance'
```

The user is in the `member` role, not `finance`. The deny policy for deletion applies. The allow policy for owner-delete (`owner-can-delete-own-drafts`) was evaluated next but an explicit deny already determined the outcome.

## Using `explainPolicies()` directly

For advanced use cases, you can call the lower-level function directly with a custom policy set:

```ts
import { explainPolicies } from '@dmc--98/blindfold-auth'

const trace = explainPolicies(policies, {
  principal: { id: 'p1', roles: ['member'] },
  action: 'delete',
  resource: 'invoice',
  resourceAttributes: { status: 'approved' },
})
```

This function is the same evaluator used by `auth.can()` — the trace is guaranteed to match the enforcement behavior.

## Studio policy debugger

The Studio UI exposes `auth.explain()` visually. Open Studio, navigate to **Policy Debugger**, fill in the request fields, and see the full per-rule trace in the browser.

```bash
npx blindfold-auth studio
```

The Studio debugger renders:

- A banner showing the final decision (ALLOW / DENY / MASK / READONLY)
- The deciding rule name and description
- Obligations (required follow-up actions)
- Per-rule outcomes in a collapsible list
- Scope mismatches explained in plain English
- Raw JSON in a disclosure panel for debugging conditions

See [Studio UI](/cli/studio) for setup.
