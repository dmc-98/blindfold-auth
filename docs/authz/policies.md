# Policies

A policy is a named rule that grants, denies, masks, or restricts access to a resource.

## Policy shape

```ts
interface Policy {
  id: string               // auto-generated
  applicationId: string
  name: string             // unique within the application
  description?: string

  effect: 'allow' | 'deny' | 'mask' | 'readonly'

  roles?: string[]         // ['admin', 'finance'] or ['*'] for wildcard
  actions: string[]        // ['read', 'write', 'delete'] or ['*']
  resources: string[]      // ['invoice', 'user'] or ['*']
  fields?: string[]        // if present, policy applies only to these fields

  conditions?: Condition[]
  priority?: number        // higher priority wins within same effect tier
}
```

## Creating a policy

```ts
await auth.admin.policies.create({
  applicationId: app.id,
  name: 'finance-read-invoices',
  effect: 'allow',
  roles: ['finance'],
  actions: ['read'],
  resources: ['invoice'],
})
```

## Conditions

Conditions are optional predicates evaluated against the request context. All conditions must pass for the policy to apply.

### Condition shape

```ts
interface Condition {
  attribute: string    // e.g. 'resource.ownerId', 'session.authStrength'
  operator: ConditionOperator
  value: string | string[]
}

type ConditionOperator =
  | 'eq' | 'neq'
  | 'in' | 'nin'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'startsWith' | 'endsWith' | 'contains'
  | 'exists' | 'notExists'
  | 'regex'
```

### Template values

Use `{{principal.id}}` to reference the current principal's ID as a condition value:

```ts
conditions: [
  { attribute: 'resource.ownerId', operator: 'eq', value: '{{principal.id}}' }
]
```

Other available template references:
- `{{principal.id}}` — current principal's ID
- `{{session.applicationId}}` — application ID from the session
- `{{tenant.id}}` — current tenant ID (if set)

### Attribute namespaces

| Namespace | Source | Examples |
|---|---|---|
| `principal.*` | Loaded at eval time | `principal.email`, `principal.id` |
| `session.*` | JWT claims | `session.authStrength`, `session.createdAt` |
| `resource.*` | `resourceAttributes` passed to `can()` | `resource.status`, `resource.ownerId` |
| `tenant.*` | Membership tenant data | `tenant.id`, `tenant.plan` |
| `request.*` | Synthetic request context | `request.dayOfWeek`, `request.hour` |

## Effects

### `allow`

Grants access. Applied only if no deny policy matches first.

### `deny`

Rejects the request. Explicit denies always win over allows, regardless of priority.

### `mask`

Allows the read but returns the field value as `***`. Used for data governance — e.g. hiding PII from non-authorized roles while still allowing the record to be read.

```ts
// Check mask status and apply it
const result = await auth.can({ ..., field: 'ssn' })
const displayed = result.effect === 'mask' ? maskValue(record.ssn) : record.ssn
```

### `readonly`

Signals that a field cannot be written, even if the request has a write grant for the resource. Your application enforces this — Blindfold signals the intent.

## Priority

Within the same effect tier (all allows, or all denies), priority determines which policy is used as the `decidingRule` in explain traces. Higher `priority` wins.

```ts
await auth.admin.policies.create({
  name: 'high-priority-allow',
  priority: 100,
  effect: 'allow',
  // ...
})
```

Default priority is 0.

## Wildcards

Use `'*'` in `roles`, `actions`, or `resources` to match all values:

```ts
// Every role can read the status endpoint
{
  roles: ['*'],
  actions: ['read'],
  resources: ['status'],
  effect: 'allow',
}

// No one can delete archived records
{
  roles: ['*'],
  actions: ['*'],
  resources: ['archived_invoice'],
  effect: 'deny',
}
```

## Listing and updating policies

```ts
// List all policies for an application
const policies = await auth.admin.policies.list({ applicationId: app.id })

// Update
await auth.admin.policies.update(policyId, { description: 'Updated' })

// Delete
await auth.admin.policies.delete(policyId)
```

## Policy examples

### Tenant isolation

```ts
// Members can only read resources in their own tenant
{
  name: 'tenant-read-isolation',
  effect: 'allow',
  roles: ['member'],
  actions: ['read'],
  resources: ['*'],
  conditions: [
    { attribute: 'resource.tenantId', operator: 'eq', value: '{{tenant.id}}' },
  ],
}
```

### Require MFA for sensitive actions

```ts
{
  name: 'delete-requires-mfa',
  effect: 'deny',
  roles: ['*'],
  actions: ['delete'],
  resources: ['payment', 'subscription'],
  conditions: [
    { attribute: 'session.authStrength', operator: 'neq', value: 'mfa_passkey' },
  ],
}
```

### Time-based access

```ts
{
  name: 'read-only-outside-business-hours',
  effect: 'deny',
  roles: ['*'],
  actions: ['write', 'delete'],
  resources: ['*'],
  conditions: [
    { attribute: 'request.hour', operator: 'nin', value: ['9','10','11','12','13','14','15','16'] },
  ],
}
```
