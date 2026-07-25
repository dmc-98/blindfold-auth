# Dry Run

`admin.policies.dryRun()` shows what would happen if a set of policy changes were applied — before committing them. It evaluates proposed adds and removes overlaid on the live policy set.

## Why you need dry run

Authorization policies are live configuration. A mistake in a deny policy can lock users out immediately; a mistake in a mask policy can expose PII. Dry run lets you validate a change against a representative set of test cases before `policies.create()` or `policies.delete()` is called.

The dry run API is also the engine behind the Studio policy debugger's "What-if" panel.

## Basic usage

```ts
const result = await auth.admin.policies.dryRun({
  // The changes you're proposing
  proposed: {
    add: [
      {
        name: 'restrict-deletes-to-finance',
        effect: 'deny',
        roles: ['member', 'viewer'],
        actions: ['delete'],
        resources: ['invoice'],
      },
    ],
    remove: ['policy_old-finance-rule'],
  },

  // The test cases to evaluate against
  cases: [
    {
      principalId: 'principal_alice',
      roles: ['member'],
      action: 'delete',
      resource: 'invoice',
      resourceAttributes: { status: 'draft' },
    },
    {
      principalId: 'principal_bob',
      roles: ['finance'],
      action: 'delete',
      resource: 'invoice',
    },
  ],
})
```

## Result structure

```ts
interface DryRunResult {
  cases: DryRunCaseResult[]
  changed: number    // how many cases would see a different outcome
  summary: string    // human-readable summary
}

interface DryRunCaseResult {
  caseIndex: number
  before: { allowed: boolean; effect: string; decidingRuleId: string | null }
  after:  { allowed: boolean; effect: string; decidingRuleId: string | null }
  changed: boolean
}
```

## Example output

```ts
// result.summary: "2/2 cases evaluated. 1 case changes."
// result.changed: 1

// Case 0 (alice, member, delete invoice):
// before: { allowed: true,  decidingRuleId: 'policy_member-can-delete-drafts' }
// after:  { allowed: false, decidingRuleId: 'policy_restrict-deletes-to-finance' }
// changed: true ← alice would lose delete access

// Case 1 (bob, finance, delete invoice):
// before: { allowed: false, ... }
// after:  { allowed: false, ... }   ← no 'finance' allow exists, still denied
// changed: false
```

This output tells you: adding the deny policy would correctly block `member` from deleting invoices, but `finance` still can't delete either — you probably need to add an allow for finance too.

## Zero persistence guarantee

Dry run never writes to storage. It clones the live policy set in memory, applies the proposed changes, evaluates the cases, and discards the result. You can call it as many times as you want without any side effects.

## Studio dry-run UI

The Studio policy debugger includes a "What-if" card where you can paste a proposed policy rule (JSON), run test cases, and see before/after results — all without touching the live policy set.

```bash
npx blindfold-auth studio
# → open http://localhost:4110
# → navigate to Policy Debugger → What-if tab
```

## Typical workflow

1. **Write the new policy** locally (or in Studio)
2. **Dry run** against a representative set of test cases (happy path + sensitive edge cases)
3. **Review** the `changed` count and per-case diff
4. **Commit** with `policies.create()` or `policies.delete()`
5. **Verify** in the explain trace with `auth.explain()` or Studio

For automated testing of policies, see [Policy Testing](/authz/testing) — `runPolicySuite()` integrates into your test suite and runs the same evaluation engine.
