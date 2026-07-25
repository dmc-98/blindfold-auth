# Policy Testing

`runPolicySuite()` is a declarative, table-driven policy test runner from `@dmc--98/blindfold-testing`. It lets you test authorization rules the same way you test any other code — with a test file in your repo that runs in CI.

## Installation

```bash
npm install -D @dmc--98/blindfold-testing
```

## Basic usage

```ts
import { runPolicySuite } from '@dmc--98/blindfold-testing'
import { describe, it, assert } from 'node:test'

describe('invoice policies', () => {
  it('enforces the policy suite', async () => {
    const report = await runPolicySuite({
      // Provide your auth instance (or a test instance with known policies)
      auth,

      cases: [
        {
          name: 'finance can read invoices',
          principal: { id: 'p1', roles: ['finance'] },
          action: 'read',
          resource: 'invoice',
          expect: 'allow',
        },
        {
          name: 'member cannot delete invoices',
          principal: { id: 'p2', roles: ['member'] },
          action: 'delete',
          resource: 'invoice',
          expect: 'deny',
        },
        {
          name: 'salary field is masked for non-HR',
          principal: { id: 'p3', roles: ['finance'] },
          action: 'read',
          resource: 'employee',
          field: 'salary',
          expect: 'mask',
        },
        {
          name: 'owner can delete own draft',
          principal: { id: 'p4', roles: ['member'] },
          action: 'delete',
          resource: 'invoice',
          resourceAttributes: { ownerId: 'p4', status: 'draft' },
          expect: 'allow',
        },
      ],
    })

    assert.ok(report.ok, report.summary)
  })
})
```

## Suite report

```ts
interface SuiteReport {
  ok: boolean        // true if all cases passed
  passed: number
  failed: number
  summary: string    // 'N/M cases passed' or detailed failure message
  results: CaseResult[]
}

interface CaseResult {
  name: string
  passed: boolean
  expected: string
  actual: string
  decidingRuleId: string | null

  // Present on failure — full explain trace
  trace?: ExplainResult
}
```

## Self-explaining failures

When a case fails, the suite automatically runs `auth.explain()` on that case and includes the full trace in the output. You see exactly which rule fired and why:

```
✗ FAIL: member cannot delete invoices
  Expected: deny
  Actual:   allow (decidingRule: policy_owner-can-delete-own-drafts)
  
  Trace:
  - policy_deny-member-deletes: skipped-scope (action mismatch: expected 'delete', got ['read'])
  - policy_owner-can-delete-own-drafts: applied (allow)
  
  → The deny policy has the wrong action scope. Did you mean ['delete']?
```

## Partial decision assertions

For mask and readonly cases, you can also assert partial decision fields:

```ts
{
  name: 'salary field read returns correct metadata',
  principal: { id: 'p1', roles: ['hr'] },
  action: 'read',
  resource: 'employee',
  field: 'salary',
  expect: { effect: 'allow', allowed: true },  // HR can read salary (not masked)
}
```

## Integrating with vitest / Jest / Node test runner

`runPolicySuite()` returns a plain object — it is not a test framework. Wire it into whichever runner you use:

```ts
// vitest
import { describe, it, expect } from 'vitest'
import { runPolicySuite } from '@dmc--98/blindfold-testing'

describe('auth policies', () => {
  it('passes all cases', async () => {
    const report = await runPolicySuite({ auth, cases })
    expect(report.ok, report.summary).toBe(true)
  })
})

// Node built-in test runner
import { describe, it } from 'node:test'
import assert from 'node:assert'

describe('auth policies', () => {
  it('passes all cases', async () => {
    const report = await runPolicySuite({ auth, cases })
    assert.ok(report.ok, report.summary)
  })
})
```

## Recommended workflow

Put your policy test suite in `test/policies.test.ts`. Run it in CI alongside your other unit tests. Before merging any policy change:

1. Add a case for the new behavior
2. Confirm it fails (the case is testing the change you haven't made yet)
3. Apply the policy change
4. Confirm the case passes
5. Confirm all existing cases still pass

This is the authorization equivalent of TDD.

## Relationship to dry run

`runPolicySuite()` tests your **current** deployed policy set. [Dry Run](/authz/dry-run) previews a **proposed** change before applying it. Use both: dry run for rapid iteration, the suite for regression protection.
