# Core Concepts

Understanding the workspace model is the fastest way to reason about how Blindfold Auth fits into your application.

## The workspace model

A **workspace** is the top-level auth boundary. One workspace holds the shared directory of users and all the configuration for every application that authenticates against it.

```
Workspace
├── Principals (users / service accounts)
├── Applications
│   ├── Roles
│   ├── Policies
│   └── Memberships (principal → application → roles)
├── Sessions (scoped per application)
├── SSO Providers (shared across applications)
└── Audit Log (hash-chained)
```

This model lets a product with a web app, a mobile app, and an internal admin panel share one user directory while keeping their roles, policies, and sessions fully isolated.

## Principals

A **principal** is any actor the runtime can authenticate — a human user, a service account, or an API key.

Principals are workspace-level entities. They are not tied to a single application. A principal can have memberships in many applications simultaneously.

Key attributes:

- `id` — stable, never reused
- `email` — unique within the workspace
- `roles` — application-scoped via memberships, not global
- `mfa` — per-principal MFA enrollment state

```ts
const principal = await auth.admin.principals.create({
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple-2025',
})
```

## Applications

An **application** is a named auth surface within the workspace — typically corresponding to a product (your web app, mobile app, or API).

Each application has its own:

- **Roles** — named permission groups (`admin`, `member`, `viewer`)
- **Policies** — ABAC rules evaluated on top of RBAC
- **Sessions** — access and refresh token state
- **Provider bindings** — which SSO providers serve this application

```ts
const app = await auth.admin.applications.create({
  name: 'web',
  description: 'Customer-facing web application',
})
```

## Memberships

A **membership** connects a principal to an application and assigns roles.

```ts
await auth.admin.memberships.create({
  principalId: principal.id,
  applicationId: app.id,
  roles: ['admin'],
  tenantId: 'acme-corp', // optional: for multi-tenant isolation
})
```

Memberships are the source of truth for "what can this user do in this application." Changing a role is as simple as updating a membership row.

## Roles and RBAC

Roles provide baseline access control. When `auth.can()` is called, the runtime checks whether any of the principal's application roles grant the requested action on the resource.

```ts
const result = await auth.can({
  principalId: principal.id,
  applicationId: app.id,
  action: 'delete',
  resource: 'invoice',
})
// result.allowed: boolean
```

Roles are simple string labels. The connection between a role and what it can do is defined in policies.

## Sessions

A **session** is an access/refresh token pair scoped to one principal and one application.

Sessions are created on successful authentication and can be:

- **verified** — check the token and load the principal's current permissions
- **refreshed** — exchange a refresh token for a new access token without re-authenticating
- **revoked** — invalidated immediately (logout, key rotation, security incident)

Sessions are stored in the workspace database. This means revocation is immediate and consistent — unlike pure JWT approaches where the token remains valid until expiry.

```ts
// Verify (typically inside auth.protect() or auth.handlers)
const session = await auth.session.verify(accessToken, { applicationId: app.id })

// Revoke
await auth.session.revoke(accessToken, { applicationId: app.id })
```

## Policies (ABAC)

Policies are table-driven ABAC rules that layer on top of RBAC. They can:

- **allow** — grant access to specific resources or conditions
- **deny** — override allows for exceptions
- **mask** — return a field's value as `***` to the caller
- **readonly** — indicate a field cannot be mutated

```ts
await auth.admin.policies.create({
  applicationId: app.id,
  name: 'finance-can-read-invoices',
  effect: 'allow',
  roles: ['finance'],
  actions: ['read'],
  resources: ['invoice'],
})
```

See [Authorization → Policies](/authz/policies) for the full policy DSL.

## The evaluation order

When a request arrives, the runtime evaluates in this order:

1. **Hard security deny** — internal safety guardrails that cannot be overridden
2. **Explicit deny** — any deny policy matching the request wins immediately
3. **Mask / readonly** — field-level outcome modifiers applied before the result is returned
4. **Explicit allow** — any allow policy matching the request grants access
5. **Default deny** — if nothing matched, the request is denied

This is a standard ABAC evaluation model: explicit denies always beat explicit allows.

## The audit log

Every auth event (login, logout, policy change, principal create, SSO link, MFA enroll) is written to a hash-chained audit log. Each entry carries a `chainHash` derived from itself and its predecessor, so any tampering is detectable by `admin.audit.verify()`.

See [Audit Log](/audit) for details.
