# Security Defaults

Blindfold ships with OWASP ASVS-aligned security defaults. Most hardening is on by default; the exceptions are features that require external dependencies (HIBP, email provider) or that would break backward compatibility if auto-enabled.

## Password policy

### Minimum length

**Default: 12 characters.** This aligns with OWASP ASVS §2.1.1 and NIST SP 800-63B. Enforcement happens in both `principals.create()` and `principals.setPassword()`.

```ts
// Disable (not recommended — only for legacy migration paths)
security: { passwordMinLength: 0 }

// Raise the floor (recommended for admin-facing apps)
security: { passwordMinLength: 16 }
```

Passwords shorter than the minimum will throw synchronously before any storage I/O.

### Breach-password checking (opt-in)

Blindfold can check candidate passwords against the [Have I Been Pwned](https://haveibeenpwned.com) k-anonymity API before accepting them. Only the first 5 characters of the SHA-1 hash are sent — the plaintext password never leaves your server.

```ts
security: { breachPasswordCheck: true }
```

Behavior when enabled:
- Registration: rejected passwords return a `PasswordBreachedError` with `checked: true`
- Password change (`setPassword`): same gate applies
- HIBP outage: **fail-open** — the check is skipped and `checked: false` is returned in the result, so your system stays available

::: tip Why opt-in?
Auto-enabling this in tests would require network access or mocking. You opt in per-environment, typically only in production.
:::

## Session security

### Refresh token rotation

**Default: on.** Every `session.refresh()` call issues a new refresh token and invalidates the previous one. This limits the window a stolen refresh token can be used.

### Concurrent session limits

**Default: 10 sessions per principal.** When a principal exceeds this limit, the oldest session is revoked automatically. Adjust per application:

```ts
session: { maxSessionsPerPrincipal: 5 }
```

### Session isolation

Sessions are scoped to a single application. A principal with sessions in your web app and mobile app cannot accidentally cross-authenticate between them. Each `auth.handlers.login()` call requires an `applicationId`.

## Magic links

**Default TTL: 15 minutes.** Magic links are single-use and expire after their TTL regardless of whether they were consumed.

## Login lockout

**Default: 5 failed attempts triggers a lockout.** Lockout state is tracked per principal in storage. Run `blindfold doctor` to verify your storage supports lockout tracking.

## CSRF and origin protection

Blindfold does not manage CSRF tokens (this belongs in your HTTP framework). It does enforce:

- **SameSite cookies** — when using the cookie session helper
- **`Origin` / `Referer` checks** — on SSO callback endpoints to prevent CSRF in the OAuth/OIDC flow
- **State parameter verification** — for all OIDC authorization code flows

## MFA security model

When passkey MFA is enabled for a principal:

1. Password login returns HTTP 202 with a `pendingToken` and WebAuthn challenge
2. The client must complete the passkey ceremony before a session is issued
3. The resulting session carries `authStrength: "mfa_passkey"` for downstream authorization checks

Bypassing MFA requires explicitly disabling it for a principal via the admin API. There is no fallback to password-only once passkey MFA is enabled (unless an admin disables it).

## Audit trail

All security-relevant events are written to the hash-chained audit log. This includes:

- successful and failed logins
- MFA enrollment and completion
- session creation, refresh, and revocation
- policy changes
- principal creation, update, and deletion
- SSO provider registration and binding changes

See [Audit Log](/audit) for tamper detection.

## Running a security check

```bash
npx blindfold-auth doctor --security-only
```

The doctor command checks:

- Secret length and entropy
- Database TLS (non-TLS database connections in production are flagged as critical)
- Default credentials (flagged as critical)
- Production Studio exposure
- Workspace ID hygiene

Exit code 1 means one or more critical findings. Fix all criticals before going to production.
