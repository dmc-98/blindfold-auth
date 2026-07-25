# Audit Log

Blindfold writes every security-relevant event to a hash-chained audit log stored in your workspace database. The chain makes tampering detectable without requiring a separate append-only store.

## How hash chaining works

Each audit event contains:

- `id` — stable event ID
- `type` — event type string (e.g. `principal.login_success`)
- `principalId`, `applicationId`, `workspaceId` — context
- `createdAt` — timestamp
- `metadata` — event-specific payload
- `prevHash` — SHA-256 hash of the previous event's payload (or the genesis sentinel `0000...0000` for the first event)
- `chainHash` — SHA-256 hash of this event's stable payload

The chain is a singly-linked list threaded through hash pointers. Verification does not rely on timestamp sort order — it follows the chain from genesis forward.

## Verifying the chain

```ts
const verification = await auth.admin.audit.verify()

// verification.ok: boolean — chain is intact
// verification.verifiedCount: number — how many events were checked
// verification.brokenAt: string | null — event ID where tampering was detected
```

If any event's `chainHash` does not match the expected value (recomputed from the stored payload), `ok` is false and `brokenAt` identifies the first broken link.

## Reading audit events

```ts
// List recent events
const events = await auth.admin.audit.list({
  applicationId: app.id,
  limit: 100,
  offset: 0,
})

// Filter by event type
const loginEvents = await auth.admin.audit.list({
  types: ['principal.login_success', 'principal.login_failure'],
  since: new Date('2026-01-01'),
})
```

## Event types

### Authentication

| Event | When |
|---|---|
| `principal.login_success` | Successful password or magic-link login |
| `principal.login_failure` | Failed login attempt |
| `principal.login_locked` | Account locked after too many failures |
| `principal.magic_link_requested` | Magic link email requested |
| `principal.magic_link_consumed` | Magic link used to create session |

### Session

| Event | When |
|---|---|
| `session.created` | Session issued (login) |
| `session.refreshed` | Refresh token used |
| `session.revoked` | Session revoked (logout or admin action) |
| `session.revoked_all` | All sessions for a principal revoked |
| `session.replay_attack` | Replay of a used refresh token detected |

### MFA

| Event | When |
|---|---|
| `mfa_passkey_enabled` | Passkey MFA enabled for a principal |
| `mfa_passkey_disabled` | Passkey MFA disabled |
| `passkey.registered` | New passkey credential registered |
| `passkey.mfa_completed` | Successful passkey MFA ceremony |
| `passkey.mfa_failed` | Failed passkey assertion |

### Principal management

| Event | When |
|---|---|
| `principal.created` | New principal created |
| `principal.updated` | Principal record updated |
| `principal.deleted` | Principal deleted |
| `principal.password_changed` | Password changed via setPassword() |

### SSO

| Event | When |
|---|---|
| `sso.provider_registered` | SSO provider created |
| `sso.binding_created` | Provider bound to an application |
| `sso.jit_provisioned` | New principal created via JIT on SSO login |
| `sso.login_success` | Successful SSO login |

### Authorization

| Event | When |
|---|---|
| `policy.created` | New policy created |
| `policy.updated` | Policy updated |
| `policy.deleted` | Policy deleted |
| `policy.dry_run` | Dry-run evaluation performed |

## Production considerations

### Retention

Audit events are stored in the workspace database indefinitely unless you implement a retention policy. For compliance requirements (SOC 2, ISO 27001, GDPR), define a retention schedule and archive or delete events on a schedule.

### Export

Export events for long-term archiving or SIEM ingestion:

```ts
// Page through all events
let offset = 0
const pageSize = 1000

while (true) {
  const page = await auth.admin.audit.list({ limit: pageSize, offset })
  if (page.length === 0) break
  await archiveToSiem(page)
  offset += pageSize
}
```

### Tamper detection schedule

Run `admin.audit.verify()` on a schedule in production (e.g. nightly). Alert on `ok: false`.

```ts
// Example cron job
const result = await auth.admin.audit.verify()
if (!result.ok) {
  await alertTeam({
    severity: 'critical',
    message: `Audit log tampered at event ${result.brokenAt}`,
  })
}
```
