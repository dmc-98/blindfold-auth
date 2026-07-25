# Configuration Reference

## `createAuth()` options

```ts
import { createAuth } from '@dmc--98/blindfold-auth'

const auth = await createAuth({
  // Required
  secret: string,

  // Optional — defaults shown
  workspaceId: 'workspace_local',
  storage: createMemoryStorage(),
  session: { /* SessionConfig */ },
  security: { /* SecurityConfig */ },
  authMethods: { /* AuthMethodsConfig */ },
})
```

### `secret` (required)

The signing secret for all access and refresh tokens. Must be at least 32 characters. Never commit this value — use an environment variable.

```ts
secret: process.env.BLINDFOLD_SECRET!
```

### `workspaceId`

Identifies the workspace. Used as a namespace in storage and in audit events. Default: `workspace_local`.

In production with multiple environments, use distinct workspace IDs (e.g. `my-product-prod`, `my-product-staging`).

### `storage`

The storage adapter backing the workspace. Available adapters:

| Adapter | Package | Use case |
|---|---|---|
| `createMemoryStorage()` | `@dmc--98/blindfold-auth` | Tests, ephemeral |
| `createFileStorage()` | `@dmc--98/blindfold-auth` | Local dev, quick start |
| Postgres | `@dmc--98/blindfold-auth-storage-postgres` | Production |
| MongoDB | `@dmc--98/blindfold-auth-storage-mongo` | Document workloads |
| SQLite | `@dmc--98/blindfold-auth-storage-sqlite` | Edge, embedded |
| Custom | `DatabaseAdapter` interface | Any store |

```ts
import { createFileStorage } from '@dmc--98/blindfold-auth'
import { createPostgresStorage } from '@dmc--98/blindfold-auth-storage-postgres'

// Dev
storage: createFileStorage({ path: './.blindfold-data' })

// Prod
storage: await createPostgresStorage({ connectionString: process.env.DATABASE_URL! })
```

### `session`

Override session defaults:

```ts
session: {
  accessTokenTtlSeconds: 900,       // 15 min (default)
  refreshTokenTtlSeconds: 604800,   // 7 days (default)
  rotateRefreshOnUse: true,         // default
  maxSessionsPerPrincipal: 10,      // default
}
```

### `security`

Override security defaults. See [Security Defaults](/guide/security) for the full list.

```ts
security: {
  passwordMinLength: 12,              // OWASP ASVS §2.1.1 (default)
  breachPasswordCheck: false,         // opt-in HIBP k-anonymity (default: false)
  magicLinkTtlSeconds: 900,          // 15 min (default)
  maxLoginAttemptsBeforeLockout: 5,   // default
}
```

### `authMethods`

Enable or disable individual auth methods:

```ts
authMethods: {
  password: true,      // default
  magicLink: false,    // default: false — requires email provider
  passkey: true,       // default
  totp: false,         // default
}
```

## Packages

All packages are scoped to `@dmc--98/` and published under Apache 2.0.

### Core

| Package | Description |
|---|---|
| `@dmc--98/blindfold-auth` | Core runtime, admin APIs, handlers, session management |
| `@dmc--98/blindfold-client` | Lightweight browser/client-side helpers |
| `@dmc--98/blindfold-testing` | `runPolicySuite()` — declarative policy test runner |

### Storage

| Package | Description |
|---|---|
| `@dmc--98/blindfold-auth-storage-postgres` | Postgres adapter (production recommended) |
| `@dmc--98/blindfold-auth-storage-mongo` | MongoDB adapter |
| `@dmc--98/blindfold-auth-storage-sqlite` | SQLite adapter |

### Enterprise

| Package | Description |
|---|---|
| `@dmc--98/blindfold-sso` | OIDC + SAML 2.0 federation |
| `@dmc--98/blindfold-scim` | SCIM 2.0 user provisioning |
| `@dmc--98/blindfold-control` | Multi-workspace control plane helpers |
| `@dmc--98/blindfold-risk` | Risk signals and adaptive auth |
| `@dmc--98/blindfold-mobile` | React Native / Expo adapters |

### Tooling

| Package | Description |
|---|---|
| `@dmc--98/blindfold-auth-cli` | `blindfold` CLI (bootstrap, migrate, doctor, Studio) |
| `@dmc--98/blindfold-auth-studio` | Browser-based operator UI |
| `@dmc--98/blindfold-mcp` | MCP server (Claude / Cursor integration) |
| `@dmc--98/blindfold-adapter-serverless` | Lambda / API Gateway adapter |
| `@dmc--98/blindfold-playground` | Interactive policy playground |

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BLINDFOLD_SECRET` | Yes | Token signing secret (≥32 chars) |
| `DATABASE_URL` | Postgres only | Postgres connection string |
| `BLINDFOLD_WORKSPACE_ID` | No | Workspace ID override |
| `BLINDFOLD_STUDIO_PORT` | No | Studio port (default: 4110) |
