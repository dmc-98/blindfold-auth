# Passwords

## Creating a principal with a password

```ts
const principal = await auth.admin.principals.create({
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple-2025',
  // Optional metadata
  displayName: 'Alice',
})
```

Blindfold hashes passwords with bcrypt (work factor 12 by default) before persisting. The plaintext password is zeroed from memory after hashing.

## Password requirements

**Minimum length:** 12 characters by default (OWASP ASVS §2.1.1, NIST SP 800-63B).

You can raise this floor per environment:

```ts
security: { passwordMinLength: 16 }
```

There is intentionally no complexity requirement (uppercase, symbols, etc.) — NIST SP 800-63B recommends length over complexity. The breach check catches common passwords more effectively than character-class rules.

## Changing a password

Use `admin.principals.setPassword()` — this applies the same breach-check gate as registration:

```ts
await auth.admin.principals.setPassword(principalId, newPassword)
```

An audit event (`principal.password_changed`) is written on success.

## Breach-password checking

When `security.breachPasswordCheck: true` is configured, every password creation or change is checked against the [Have I Been Pwned](https://haveibeenpwned.com) k-anonymity range API before being accepted.

### How the k-anonymity check works

1. SHA-1 hash the candidate password (in memory only)
2. Send the **first 5 hex characters** of the hash to HIBP's range endpoint
3. HIBP returns all suffixes matching that prefix (typically 500–900 entries)
4. Check locally if the full hash appears in the response
5. If found: return `PasswordBreachedError`; if not found: proceed

The full password hash never leaves your server. Only 5 characters (1/8 of the hash) are sent, giving k-anonymity of ~500+ other hashes per query.

### Handling breach check results

```ts
import { PasswordBreachedError } from '@dmc--98/blindfold-auth'

try {
  await auth.admin.principals.create({
    email: 'bob@example.com',
    password: 'password123', // common password — will be rejected
  })
} catch (err) {
  if (err instanceof PasswordBreachedError) {
    // Tell the user to choose a different password
    console.error('Password found in breach database')
    console.log('HIBP check completed:', err.checked) // true = confirmed breach
  }
}
```

### Fail-open behavior

If the HIBP API is unreachable (timeout, DNS failure, any network error), the check **fails open**: the password is accepted and `checked: false` is returned in the audit metadata. Your system remains available.

This is a deliberate trade-off: availability is prioritized over the breach check. If you need hard enforcement (fail-closed), wrap the call yourself:

```ts
const result = await auth.admin.principals.create({ ... })
if (!result.passwordCheck?.checked) {
  // HIBP was unreachable — log this for monitoring, or reject if your policy requires it
}
```

## Password login

```ts
// POST /auth/login body
// { email, password, applicationId }
auth.handlers.login()
```

Login writes a `principal.login_success` or `principal.login_failure` audit event. Five consecutive failures lock the principal (configurable via `security.maxLoginAttemptsBeforeLockout`).

## Magic links (passwordless)

Blindfold supports email-based magic links as an alternative or supplement to password login:

```ts
authMethods: { magicLink: true }

// Request a magic link
auth.handlers.requestMagicLink()

// Consume the link
auth.handlers.consumeMagicLink()
```

Magic links are single-use and expire after 15 minutes (configurable). Your application must provide the email delivery layer — Blindfold generates the token; you send the email.

## TOTP (authenticator apps)

TOTP MFA is supported via `generateTotpSecret()` / `verifyTotpCode()` from `@dmc--98/blindfold-auth`. Recovery codes are generated as a set and can be stored hashed.

```ts
import { generateTotpSecret, generateRecoveryCodes } from '@dmc--98/blindfold-auth'

const { secret, uri } = await generateTotpSecret({ principal })
const codes = generateRecoveryCodes(8) // 8 one-time codes
```

See [Passkeys & MFA](/guide/mfa) for the passkey-first flow.
