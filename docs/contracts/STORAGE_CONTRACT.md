# Storage Adapter Contract

This document defines the storage interface expected by `@blindfold/auth`.

## Required adapter methods

Every storage adapter must implement:

```js
{
  ensureTables(),
  list(table, filter),
  get(table, id),
  put(table, record),
  delete(table, id)
}
```

## Method semantics

### `ensureTables()`

- prepares the storage backend for the Blindfold tables
- may create schemas, tables, collections, or documents as needed
- should be safe to call more than once

### `list(table, filter)`

- returns an array of records
- `filter` is an exact-match filter object for the current repository contract
- missing records return an empty array

### `get(table, id)`

- returns one record or `null`
- missing records do not throw by default

### `put(table, record)`

- creates or replaces a record by `record.id`
- returns the stored record
- should preserve the exact record shape the runtime passes in

### `delete(table, id)`

- removes a record if present
- should be safe to call on missing records

## Record expectations

- every record must have an `id`
- runtime-managed records usually also contain `createdAt` and `updatedAt`
- adapters should not silently strip unknown keys

## Required tables

The runtime currently expects the tables exported as `TABLES`:

- `workspace_config`
- `applications`
- `application_auth_config`
- `application_identity_providers`
- `principals`
- `application_principals`
- `memberships`
- `roles`
- `role_permissions`
- `policy_rules`
- `direct_grants`
- `policy_versions`
- `sessions`
- `revocations`
- `rate_limit_counters`
- `risk_events`
- `audit_events`
- `auth_challenges`

## Primary backend position

The main supported backend is PostgreSQL.

Other adapters are allowed, but they should match the method and table semantics above so the runtime behaves consistently across deployment lanes.

## PostgreSQL migration contract

The PostgreSQL adapter now exposes:

- `buildPostgresSchemaSql(...)`
- `getPostgresMigrationPlan(...)`
- `runPostgresMigrations(...)`
- `createPostgresStorage(...)`

The migration plan currently contains one explicit step:

- `0001_core_tables`

That step creates the Blindfold schema and the current document tables.
