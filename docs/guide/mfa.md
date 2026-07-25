# Passkeys & MFA

Blindfold implements passkeys (WebAuthn) as the primary second factor. Passkeys are phishing-resistant, device-bound credentials that replace both TOTP and SMS OTP for most threat models.

## Passkey registration

Before a principal can use passkey MFA, they must register a credential. Blindfold provides handlers for the WebAuthn registration ceremony:

```ts
// 1. Start registration — returns challenge options for the browser
server.post('/auth/passkey/register/start', auth.handlers.passkeys.startRegistration())

// 2. Complete registration — verifies attestation and stores the credential
server.post('/auth/passkey/register/complete', auth.handlers.passkeys.completeRegistration())
```

On the client, use the browser's `navigator.credentials.create()` API (or a library like `@simplewebauthn/browser`):

```ts
import { startRegistration } from '@simplewebauthn/browser'

const options = await fetch('/auth/passkey/register/start').then(r => r.json())
const registration = await startRegistration(options)
await fetch('/auth/passkey/register/complete', {
  method: 'POST',
  body: JSON.stringify(registration),
})
```

## Enabling passkey MFA

Once a passkey credential is registered, enable it as a required second factor for the principal:

```ts
await auth.admin.principals.enablePasskeyMfa(principalId)
```

From this point on, the login flow is two-step.

## Passkey MFA login flow

When passkey MFA is enabled and an active credential exists, password login returns HTTP 202 instead of a session:

```ts
// Step 1: Password login — returns 202 with challenge
// Response: { passkeyMfaRequired: true, pendingToken, challengeId, options }

// Step 2: Complete the WebAuthn assertion ceremony
const assertion = await navigator.credentials.get({ publicKey: options })

// Step 3: Submit assertion to complete login
const { accessToken, refreshToken } = await fetch('/auth/passkey/mfa/complete', {
  method: 'POST',
  body: JSON.stringify({ pendingToken, assertion }),
}).then(r => r.json())
```

The resulting session carries `authStrength: "mfa_passkey"`. You can enforce this in authorization policies:

```ts
await auth.admin.policies.create({
  name: 'require-mfa-for-admin-actions',
  effect: 'deny',
  actions: ['delete', 'admin.*'],
  conditions: [{
    attribute: 'session.authStrength',
    operator: 'neq',
    value: 'mfa_passkey',
  }],
})
```

## Graceful fallback

If passkey MFA is enabled but the principal has no active credentials (e.g. a new device, credential deleted), Blindfold falls back to a normal password session. This ensures operators cannot accidentally lock themselves out during credential migration.

## Disabling passkey MFA

Only the admin API can disable passkey MFA — it cannot be self-served by users by default:

```ts
await auth.admin.principals.disablePasskeyMfa(principalId)
```

Audit event: `mfa_passkey_disabled`.

## TOTP (authenticator apps)

TOTP is supported as an alternative second factor:

```ts
import { generateTotpSecret, verifyTotpCode, generateRecoveryCodes } from '@dmc--98/blindfold-auth'

// Setup
const { secret, uri } = await generateTotpSecret({ principal })
// uri is an otpauth:// URI — display as QR code

// Recovery codes (stored hashed)
const codes = generateRecoveryCodes(8)

// Verify
const valid = verifyTotpCode({ secret, code: userInput })
```

TOTP is independent of passkey MFA. A principal can have both, or either, or neither.

## Passkeys vs TOTP

| | Passkeys | TOTP |
|---|---|---|
| Phishing resistance | ✅ (origin-bound) | ❌ (can be phished) |
| Device dependency | Per device/authenticator | Any authenticator app |
| Recovery path | Backup codes, admin reset | Backup codes |
| ASVS L2 | ✅ | ✅ |
| UX | One tap | 6-digit code entry |

For new applications, prefer passkeys. TOTP remains useful for CLI tools and headless environments where WebAuthn is unavailable.

## Audit events

| Event | When |
|---|---|
| `mfa_passkey_enabled` | Admin enables passkey MFA |
| `mfa_passkey_disabled` | Admin disables passkey MFA |
| `passkey.registered` | Principal registers a new credential |
| `passkey.mfa_completed` | Successful MFA ceremony |
| `passkey.mfa_failed` | Failed assertion (wrong credential, wrong origin) |
