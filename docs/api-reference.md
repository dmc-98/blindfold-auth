# API Reference

Complete reference for the `@dmc--98/blindfold-auth` public API.

## `createAuth(options)`

Initializes the Blindfold runtime. Returns an `Auth` object.

```ts
import { createAuth } from '@dmc--98/blindfold-auth'

const auth = await createAuth({
  secret: string,             // required — token signing secret
  workspaceId?: string,       // default: 'workspace_local'
  storage?: DatabaseAdapter,  // default: createMemoryStorage()
  session?: SessionConfig,
  security?: SecurityConfig,
  authMethods?: AuthMethodsConfig,
})
```

See [Configuration Reference](/guide/configuration) for all options.

---

## `auth.can(request)`

Evaluates an authorization request synchronously.

```ts
const result = await auth.can({
  principalId: string,
  applicationId: string,
  action: string,
  resource: string,

  // Optional
  resourceId?: string,
  field?: string,
  tenantId?: string,
  resourceAttributes?: Record<string, unknown>,
})

// Returns:
// {
//   allowed: boolean,
//   effect: 'allow' | 'deny' | 'mask' | 'readonly',
//   reason: string,
// }
```

## `auth.explain(request)`

Same input as `auth.can()`. Returns the decision plus a full per-rule trace.

```ts
const trace = await auth.explain({
  principalId, applicationId, action, resource,
  // same optional fields as auth.can()
})

// Returns ExplainResult — see /authz/explain
```

## `auth.protect(authHeader, request)`

Verifies the session from an `Authorization: Bearer <token>` header and calls `auth.can()` in one step.

```ts
const result = await auth.protect(req.headers.authorization, {
  applicationId: string,
  action: string,
  resource: string,
  // optional: resourceId, field, tenantId, resourceAttributes
})

// result.allowed: boolean
// result.principalId: string (from verified session)
// result.sessionId: string
```

---

## `auth.session`

### `auth.session.create(params)`

```ts
const session = await auth.session.create({
  principalId: string,
  applicationId: string,
  metadata?: Record<string, unknown>,
  authStrength?: string,
})
// → { accessToken, refreshToken, expiresAt }
```

### `auth.session.verify(token, params)`

```ts
const result = await auth.session.verify(accessToken, {
  applicationId: string,
})
// → { valid: boolean, principalId, applicationId, authStrength, claims }
```

### `auth.session.refresh(refreshToken, params)`

```ts
const newSession = await auth.session.refresh(refreshToken, {
  applicationId: string,
})
// → { accessToken, refreshToken, expiresAt }
```

### `auth.session.revoke(token, params)`

```ts
await auth.session.revoke(accessToken, { applicationId: string })
```

---

## `auth.handlers`

Express-compatible handler factories. Each returns `(req, res, next) => void`.

```ts
auth.handlers.login()           // POST — password or magic-link login
auth.handlers.refresh()         // POST — exchange refresh token
auth.handlers.logout()          // POST — revoke session
auth.handlers.requestMagicLink() // POST — send magic link email
auth.handlers.consumeMagicLink() // GET  — exchange magic link for session

auth.handlers.passkeys.startRegistration()   // POST — WebAuthn registration challenge
auth.handlers.passkeys.completeRegistration() // POST — store credential
auth.handlers.passkeys.startAuthentication() // POST — authentication challenge
auth.handlers.passkeys.completeAuthentication() // POST — verify assertion
auth.handlers.passkeys.completeMfa()         // POST — complete MFA ceremony
```

---

## `auth.admin`

### Principals

```ts
auth.admin.principals.create({ email, password?, displayName? })
auth.admin.principals.get(principalId)
auth.admin.principals.list({ applicationId?, limit?, offset? })
auth.admin.principals.update(principalId, { displayName?, metadata? })
auth.admin.principals.delete(principalId)
auth.admin.principals.setPassword(principalId, newPassword)
auth.admin.principals.enablePasskeyMfa(principalId)
auth.admin.principals.disablePasskeyMfa(principalId)
```

### Applications

```ts
auth.admin.applications.create({ name, description? })
auth.admin.applications.get(applicationId)
auth.admin.applications.list()
auth.admin.applications.update(applicationId, params)
auth.admin.applications.delete(applicationId)
```

### Memberships

```ts
auth.admin.memberships.create({ principalId, applicationId, roles, tenantId? })
auth.admin.memberships.get({ principalId, applicationId })
auth.admin.memberships.update(membershipId, { roles? })
auth.admin.memberships.delete(membershipId)
```

### Policies

```ts
auth.admin.policies.create({ applicationId, name, effect, roles?, actions, resources, fields?, conditions?, priority? })
auth.admin.policies.list({ applicationId })
auth.admin.policies.update(policyId, params)
auth.admin.policies.delete(policyId)
auth.admin.policies.dryRun({ proposed, cases })  // see /authz/dry-run
```

### Sessions

```ts
auth.admin.sessions.list({ principalId?, applicationId? })
auth.admin.sessions.revoke(sessionId)
auth.admin.sessions.revokeAll(principalId, { applicationId? })
```

### Audit log

```ts
auth.admin.audit.list({ types?, principalId?, applicationId?, since?, until?, limit?, offset? })
auth.admin.audit.verify()  // → { ok, verifiedCount, brokenAt }
```

### Workspace

```ts
auth.admin.workspace.bootstrap({ workspaceName })
auth.admin.workspace.get()
auth.admin.workspace.update(params)
```

---

## Standalone exports

```ts
import {
  createMemoryStorage,
  createFileStorage,
  maskValue,
  TABLES,
  evaluateCondition,
  evaluatePolicies,
  explainPolicies,
  generateTotpSecret,
  getTotpCode,
  verifyTotpCode,
  generateRecoveryCodes,
} from '@dmc--98/blindfold-auth'
```

### `maskValue(value)`

Returns `***` for any string value. Use with `effect: 'mask'` results.

### `explainPolicies(policies, request)`

Low-level evaluator — same engine as `auth.explain()`. Useful for testing policies in isolation without a full auth instance.

### TOTP helpers

```ts
const { secret, uri } = await generateTotpSecret({ principal })
const code = getTotpCode({ secret })          // current 6-digit code
const valid = verifyTotpCode({ secret, code }) // verify user input
const codes = generateRecoveryCodes(8)         // one-time backup codes
```
