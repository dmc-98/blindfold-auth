# Blindfold Auth Security Audit

This document records the current internal security audit pass for the repository baseline.

Date of pass: `2026-04-04`

## Scope reviewed

- `packages/auth/src/auth.ts`
- `packages/auth/src/utils.ts`
- `packages/auth/src/policy.ts`
- `packages/auth/src/oidc.ts`
- `packages/auth/src/saml.ts`
- `packages/auth-adapter-serverless/src/index.ts`
- Studio-facing and runtime-facing auth flows exercised through tests

## Findings fixed in this pass

### 1. Public magic-link handler exposed raw login tokens by default

Risk:

- a client could request a magic link and receive the token directly, defeating proof of inbox possession

Fix:

- `requestMagicLink()` now returns a generic `{ ok: true }` payload by default
- raw tokens are only returned when `security.magicLinks.returnTokenInResponse` is explicitly enabled for development/test scenarios

### 2. Magic-link issuance could bypass application access checks

Risk:

- a principal without membership in an application could still receive a valid magic-link challenge for that application

Fix:

- application access is required before a magic-link challenge is created
- generic responses are preserved for unknown or unauthorized principals

### 3. Logout/revoke accepted forged refresh-token shapes

Risk:

- a string shaped like `sessionId.anything` could revoke a session without proving possession of the real refresh token

Fix:

- refresh-token-based revocation now validates the refresh token hash before revoking
- direct `sessionId` revocation remains available only through explicit trusted calls

### 4. Sessions remained valid after application access was removed

Risk:

- a principal could keep using an already-issued session after losing application membership

Fix:

- session verification now fails if the principal no longer has access to the application

### 5. `auth.protect()` could be misconfigured for a different application than the session audience

Risk:

- a route could accidentally evaluate authorization against another application's policy surface while using the current session

Fix:

- protected routes now reject `applicationId` values that do not match the session's application

### 6. Redirect targets for magic links were too permissive

Risk:

- an untrusted redirect target could be used to create phishing-style or open-redirect login flows

Fix:

- redirect targets are restricted to relative paths by default

### 7. Principal identity creation allowed duplicate/case-variant emails

Risk:

- duplicate identities could be created with email normalization differences

Fix:

- principal emails are normalized to lowercase on create
- duplicate principal emails are rejected

### 8. Federation callbacks accepted direct claims without distinguishing demo and live providers

Risk:

- a callback endpoint could be fed arbitrary claim payloads even when configured for a real external provider

Fix:

- identity providers now have an explicit `mode` of `live` or `demo`
- direct `claims` callbacks are rejected for `live` OIDC and SAML providers
- launch/demo fixtures opt into `demo` mode explicitly instead of relying on permissive defaults

### 9. OIDC flow lacked PKCE/state/nonce-backed external verification

Risk:

- the runtime could not complete a standards-based authorization code exchange with external providers
- callback validation did not enforce PKCE or nonce checks for live providers

Fix:

- live OIDC now uses `openid-client`
- authorization requests carry PKCE, state, and nonce
- callbacks exchange the authorization code and require validated ID token claims before JIT provisioning

### 10. SAML flow lacked signed-response validation and `InResponseTo` correlation

Risk:

- the runtime did not have a hardened path for validating signed SAML responses from an external IdP
- request/response correlation was not enforced for SP-initiated flows

Fix:

- live SAML now uses `@node-saml/node-saml`
- SP-initiated flows validate `InResponseTo` through a storage-backed request cache
- IdP-initiated SAML remains opt-in per binding
- SAML metadata generation now prefers the Node-SAML service provider metadata path

## Ongoing controls now in place

- unit coverage for:
  - generic magic-link behavior
  - unsafe redirect rejection
  - forged logout token rejection
  - cross-app protected route mismatch rejection
  - membership removal invalidating sessions
  - demo-vs-live federation callback enforcement
- Playwright E2E coverage for runtime and Studio flows
- CI production dependency audit
- existing CodeQL and dependency review workflows

## Remaining work

This audit pass does not close the broader future security roadmap. Remaining high-value work includes:

- external security review
- key rotation strategy and secret-management guidance
- WebAuthn hardening
- provider-specific OIDC/SAML interoperability hardening and external verification drills
- SCIM and lifecycle abuse-case review
- performance-aware abuse controls beyond the current baseline
