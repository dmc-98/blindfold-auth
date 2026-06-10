# Blindfold Auth Threat Model

This document captures the current threat model for the implemented Blindfold Auth foundation.

It is intentionally practical: it focuses on the attacks that matter to the current repository shape rather than future compliance and lifecycle features that are not fully shipped yet.

## Security goals

- keep authentication state inside customer-owned infrastructure
- prevent unauthorized session creation, refresh, and revocation
- prevent cross-application access confusion inside a shared workspace
- preserve default-deny authorization behavior
- avoid handing sensitive login artifacts back to untrusted clients by default
- keep local-first administration auditable and explicit

## Trust boundaries

The current implementation has these main trust boundaries:

1. application client to embedded runtime
2. embedded runtime to storage adapter
3. embedded runtime to external identity providers for OIDC and SAML
4. Studio operator to admin APIs
5. serverless/event adapters to normalized auth requests

Anything that crosses those boundaries must be treated as untrusted input until validated.

## Sensitive assets

- password hashes
- MFA TOTP secrets and recovery codes
- active access tokens
- active refresh tokens
- magic-link challenges
- WebAuthn registration/authentication challenges
- federation state, relay-state, and SAML request identifiers
- authorization policies and direct grants
- audit events

## Main threat categories

### Authentication bypass

Representative risks:

- issuing a session to a principal that does not belong to an application
- accepting a magic-link challenge for the wrong audience
- allowing disabled authentication methods to continue working

Current mitigations:

- application access is required before session issuance and verification
- password and magic-link handlers respect enabled auth methods
- magic-link challenges are scoped to `applicationId`
- live OIDC uses PKCE, state, and nonce before session issuance
- live SAML validates signed responses and `InResponseTo` for SP-initiated flows

### Session abuse

Representative risks:

- refresh token replay
- forged logout or revoke requests
- stale sessions continuing after access is removed
- using one app's session against another app's protected route

Current mitigations:

- refresh rotation marks the previous session as rotated
- logout/revoke validates the provided refresh token hash when a refresh token is used
- session verification fails once application access is removed
- `auth.protect()` rejects cross-application session use

### Authorization bypass

Representative risks:

- default-allow behavior
- direct-grant or policy precedence bugs
- field-level policy effects being ignored

Current mitigations:

- default deny remains the baseline
- explicit deny wins before allow
- `mask` and `readonly` obligations are preserved in decisions
- policy evaluation is covered by unit and E2E tests

### Token and link leakage

Representative risks:

- public handlers returning raw magic-link tokens
- untrusted redirect targets in magic links
- sensitive token material leaking through debugging paths

Current mitigations:

- public magic-link handler responses are generic by default
- raw magic-link tokens are only returned when explicitly enabled for development/test flows
- redirect targets are restricted to relative paths by default

### Federation misuse

Representative risks:

- accepting direct claims for a live provider callback
- treating demo launch fixtures like production IdPs
- replaying SP-initiated SAML responses without request correlation
- using disabled or mismatched providers during domain routing

Current mitigations:

- identity providers have explicit `live` vs `demo` modes
- direct `claims` callbacks are allowed only for `demo` providers
- live SAML uses storage-backed request-id tracking for `InResponseTo`
- provider selection ignores disabled bindings and disabled providers

## Deferred areas

These are not fully addressed in the current repository and should stay in scope for later phases:

- WebAuthn/passkey ceremony hardening
- deeper provider-specific OIDC/SAML interoperability hardening
- SCIM lifecycle edge cases
- key rotation strategy for signing secrets
- IP/device anomaly detection
- external penetration test or third-party audit

## Verification

Current validation layers:

- unit tests for session rotation, magic-link handling, authorization, and security guards
- Playwright E2E flows for Studio and runtime auth behavior
- GitHub Actions CI
- CodeQL
- dependency review
- production dependency audit in CI
