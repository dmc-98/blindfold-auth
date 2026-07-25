# Sessions

Blindfold sessions are signed JWT pairs (access + refresh) stored in the workspace database, scoped to one principal and one application.

## Why database-backed sessions?

Pure stateless JWTs cannot be revoked. Blindfold stores sessions so that:

- `session.revoke()` takes effect immediately — no token TTL lag
- `admin.sessions.revokeAll(principalId)` instantly logs a user out of all devices
- Concurrent session limits are enforced per principal

The access token is short-lived (default 15 min) and carries enough claims for fast authorization. The refresh token is longer-lived (default 7 days) and must be verified against the database.

## Session lifecycle

```
login()  →  { accessToken, refreshToken }
                          ↓
                    verify(accessToken)  →  { principalId, applicationId, claims }
                          ↓
                    refresh(refreshToken) →  { new accessToken, new refreshToken }
                          ↓
                    revoke(accessToken)  →  session deleted
```

## Creating a session

Sessions are created by login handlers automatically. To create one programmatically:

```ts
const session = await auth.session.create({
  principalId: principal.id,
  applicationId: app.id,
  metadata: { source: 'api-key-exchange' },
})

// session.accessToken  — short-lived JWT
// session.refreshToken — long-lived rotation token
```

## Verifying a session

Typically done inside `auth.protect()` or `auth.handlers.*`. Direct use:

```ts
const result = await auth.session.verify(accessToken, {
  applicationId: app.id,
})

if (!result.valid) {
  // Token expired, revoked, or tampered
}

// result.principalId — who this session belongs to
// result.applicationId — which app it was issued for
// result.authStrength — 'password' | 'mfa_passkey' | 'magic_link' | ...
// result.claims — any metadata stored at session creation
```

## Refreshing a session

Refresh tokens are rotated on use — the old token is invalidated and a new pair is issued.

```ts
const newSession = await auth.session.refresh(refreshToken, {
  applicationId: app.id,
})
```

If the refresh token has already been used (rotation replay), the entire session family is revoked as a security measure (token theft detection).

## Revoking a session

```ts
// Revoke one session
await auth.session.revoke(accessToken, { applicationId: app.id })

// Revoke all sessions for a principal (logout everywhere)
await auth.admin.sessions.revokeAll(principalId)

// Revoke all sessions for a principal in one application
await auth.admin.sessions.revokeAll(principalId, { applicationId: app.id })
```

## Session configuration

```ts
session: {
  accessTokenTtlSeconds: 900,        // 15 minutes (default)
  refreshTokenTtlSeconds: 604800,    // 7 days (default)
  rotateRefreshOnUse: true,          // default: true (highly recommended)
  maxSessionsPerPrincipal: 10,       // default: 10
}
```

When `maxSessionsPerPrincipal` is exceeded on login, the oldest session is revoked to make room.

## Reading active sessions (admin)

```ts
const sessions = await auth.admin.sessions.list({
  principalId: principal.id,
  applicationId: app.id,
})

// sessions[].id, .createdAt, .lastVerifiedAt, .userAgent, .ipAddress
```

## Cross-app session isolation

A principal's session in application `web` cannot be used to authenticate to application `mobile`. The `applicationId` is embedded in the token and verified on every `session.verify()` call.

## Session events in the audit log

| Event | When |
|---|---|
| `session.created` | Successful login |
| `session.refreshed` | Refresh token used |
| `session.revoked` | Logout or explicit revocation |
| `session.revoked_all` | Admin revoked all sessions |
| `session.replay_attack` | Rotation replay detected — all sessions revoked |
