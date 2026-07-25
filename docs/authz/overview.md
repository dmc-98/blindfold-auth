# Authorization Overview

Blindfold Auth uses a layered authorization model — RBAC for baseline access control, ABAC for fine-grained conditions, and field-level outcomes (mask, readonly) for data governance.

## The model in brief

```
Request: "Can alice (admin in 'web') delete invoice #123 belonging to tenant 'acme'?"
          ↓
     Evaluation order:
     1. Hard deny (security guardrails)
     2. Explicit deny policies
     3. Mask / readonly policies
     4. Explicit allow policies
     5. Default deny
```

The engine is **default-deny**: if nothing explicitly allows a request, it is denied.

## Checking authorization

The primary API is `auth.can()`:

```ts
const result = await auth.can({
  principalId: 'principal_alice',
  applicationId: 'app_web',
  action: 'delete',
  resource: 'invoice',
  resourceId: 'invoice_123',
  tenantId: 'acme',
  resourceAttributes: { ownerId: 'principal_alice', status: 'draft' },
})

// result.allowed: boolean
// result.effect: 'allow' | 'deny' | 'mask' | 'readonly'
// result.reason: string — why
```

## Route protection helper

For Express/Fastify/Hono routes, use `auth.protect()` — it verifies the session and calls `auth.can()` in one step:

```ts
server.delete('/invoices/:id', async (req, res) => {
  const result = await auth.protect(req.headers.authorization, {
    applicationId: app.id,
    action: 'delete',
    resource: 'invoice',
    resourceId: req.params.id,
  })
  if (!result.allowed) return res.status(403).json({ error: result.reason })
  // proceed
})
```

## RBAC — role-based access

Roles provide baseline access grants. When you define a policy with an `effect: 'allow'` and list one or more roles, any principal holding those roles in the application is granted the policy.

```ts
await auth.admin.policies.create({
  applicationId: app.id,
  name: 'admins-can-delete-invoices',
  effect: 'allow',
  roles: ['admin'],
  actions: ['delete'],
  resources: ['invoice'],
})
```

## ABAC — attribute-based conditions

Add `conditions` to any policy to check runtime attributes. Conditions are evaluated against the request context:

| Attribute namespace | Examples |
|---|---|
| `principal.*` | `principal.email`, `principal.mfa.enrolled` |
| `session.*` | `session.authStrength`, `session.ipAddress` |
| `resource.*` | `resource.ownerId`, `resource.status` |
| `tenant.*` | `tenant.plan`, `tenant.id` |

```ts
await auth.admin.policies.create({
  applicationId: app.id,
  name: 'owner-can-delete-own-drafts',
  effect: 'allow',
  roles: ['member'],
  actions: ['delete'],
  resources: ['invoice'],
  conditions: [
    { attribute: 'resource.ownerId', operator: 'eq', value: '{{principal.id}}' },
    { attribute: 'resource.status',  operator: 'eq', value: 'draft' },
  ],
})
```

## Field-level outcomes

Policies can apply to specific fields and return `mask` or `readonly` instead of allow/deny:

```ts
// Finance sees salary fields; HR sees them masked
await auth.admin.policies.create({
  applicationId: app.id,
  name: 'mask-salary-from-non-hr',
  effect: 'mask',
  roles: ['finance', 'member'],  // everyone except hr
  actions: ['read'],
  resources: ['employee'],
  fields: ['salary', 'compensation'],
  conditions: [
    { attribute: 'principal.role', operator: 'neq', value: 'hr' },
  ],
})
```

When `effect: 'mask'`, `auth.can()` returns `allowed: true, effect: 'mask'`. Your application is responsible for applying masking to the response data — use the `maskValue()` helper:

```ts
import { maskValue } from '@dmc--98/blindfold-auth'

const canRead = await auth.can({ ..., field: 'salary' })
const displayValue = canRead.effect === 'mask' ? maskValue(employee.salary) : employee.salary
```

## Deny policies

Explicit deny policies always override allows, regardless of order:

```ts
await auth.admin.policies.create({
  applicationId: app.id,
  name: 'no-weekend-deletes',
  effect: 'deny',
  roles: ['*'],  // wildcard matches all roles
  actions: ['delete'],
  resources: ['invoice'],
  conditions: [
    { attribute: 'request.dayOfWeek', operator: 'in', value: ['Saturday', 'Sunday'] },
  ],
})
```

## Debugging authorization decisions

See [Explain Decisions](/authz/explain) to get per-rule trace output for any request, and [Dry Run](/authz/dry-run) to preview policy changes without applying them.

## Testing policies

See [Policy Testing](/authz/testing) for the `runPolicySuite()` declarative test runner.
