# Runtime API Contract

This document defines the current public runtime contract for Blindfold Auth.

## Stable entry points

Current stable exports from `@blindfold/auth`:

- `createAuth`
- `createMemoryStorage`
- `createFileStorage`
- `maskValue`
- `TABLES`
- `evaluateCondition`
- `evaluatePolicies`
- `generateTotpSecret`
- `getTotpCode`
- `verifyTotpCode`
- `generateRecoveryCodes`

## `createAuth()`

Current constructor shape:

```js
createAuth({
  workspaceId,
  secret,
  storage,
  session,
  security,
  authMethods
})
```

### Required inputs

- `secret`: signing secret for access token creation and verification

### Optional inputs

- `workspaceId`: defaults to `workspace_local`
- `storage`: defaults to the in-memory storage adapter
- `session`: partial override for session defaults
- `security`: partial override for security defaults
- `authMethods`: partial override for auth method defaults

### Constructor guarantees

- initialization ensures the required storage tables exist
- the returned object exposes runtime, session, handler, and admin surfaces
- missing `secret` is a hard error

## Returned auth object

### Stable namespaces

- `auth.workspaceId`
- `auth.storage`
- `auth.authMethods`
- `auth.can(...)`
- `auth.protect(...)`
- `auth.session.create(...)`
- `auth.session.verify(...)`
- `auth.session.refresh(...)`
- `auth.session.revoke(...)`
- `auth.handlers.login()`
- `auth.handlers.refresh()`
- `auth.handlers.logout()`
- `auth.handlers.requestMagicLink()`
- `auth.handlers.consumeMagicLink()`
- `auth.admin.*`

### `auth.can(...)`

Supports:

- object-style evaluation input
- principal, application, action, resource, field, tenant, and resource attribute resolution
- RBAC and ABAC evaluation
- field-level effects

Decision output contract:

- `allowed`
- `effect`
- `matchedRuleIds`
- `obligations`
- `reason`

### `auth.protect(...)`

Current role:

- wraps route or handler functions
- reads bearer token from headers
- verifies session
- optionally evaluates authorization before calling the inner handler

### `auth.session.*`

Current session contract:

- access tokens are signed by Blindfold Auth
- refresh tokens are opaque and hashed in storage
- refresh rotates into a new session
- revoked or rotated sessions no longer validate as active

### `auth.handlers.*`

Current built-in handlers:

- password login
- refresh
- logout
- magic link issue
- magic link consume

These are intended as convenience surfaces for embedded apps and adapters.

## `auth.admin.*`

Current stable namespaces:

- `auth.admin.bootstrapWorkspace(...)`
- `auth.admin.getWorkspace()`
- `auth.admin.exportSnapshot()`
- `auth.admin.debugDecision(...)`
- `auth.admin.applications.*`
- `auth.admin.principals.*`
- `auth.admin.roles.*`
- `auth.admin.memberships.*`
- `auth.admin.policies.*`
- `auth.admin.directGrants.*`
- `auth.admin.sessions.*`
- `auth.admin.audit.*`

The admin surface is the supported write path for Studio and CLI-driven management. Direct table editing is not part of the public product contract.

## Current non-goals in the contract

These are not yet guaranteed:

- WebAuthn/passkey ceremony APIs
- SAML/OIDC provider APIs
- SCIM APIs
- long-term wire compatibility for unimplemented enterprise flows

Those should be added in later phases as explicit contract extensions.

