# Getting Started

This guide takes you from `npm install` to a working auth endpoint in under 10 minutes using the file-backed local storage (no database required). For production setup, continue to [Deployment](/guide/deployment).

## Prerequisites

- Node.js ≥ 22.5.0
- npm or any compatible package manager

## Install

```bash
npm install @dmc--98/blindfold-auth
```

For production with Postgres:

```bash
npm install @dmc--98/blindfold-auth @dmc--98/blindfold-auth-storage-postgres
```

For the CLI (doctor, Studio, migrations):

```bash
npm install -D @dmc--98/blindfold-auth-cli
```

## Initialize the runtime

```ts
import { createAuth, createFileStorage } from '@dmc--98/blindfold-auth'

const auth = await createAuth({
  secret: process.env.BLINDFOLD_SECRET!, // min 32 chars
  storage: createFileStorage({ path: './.blindfold-data' }),
  workspaceId: 'my-workspace',
})
```

::: warning Secret management
`secret` signs all access tokens. Never commit it. Use an environment variable and rotate it with session revocation if it leaks.
:::

## Bootstrap the workspace

On first run, initialize the workspace and create an application:

```ts
await auth.admin.workspace.bootstrap({
  workspaceName: 'My Product',
})

const app = await auth.admin.applications.create({
  name: 'web',
  description: 'Web application',
})

console.log('Application ID:', app.id)
```

You only need to run this once. Store `app.id` in your config or env.

## Wire up Express routes

```ts
import express from 'express'

const server = express()
server.use(express.json())

// Login
server.post('/auth/login', auth.handlers.login())

// Refresh
server.post('/auth/refresh', auth.handlers.refresh())

// Logout
server.post('/auth/logout', auth.handlers.logout())

// Protected route
server.get('/api/me', async (req, res) => {
  const result = await auth.protect(req.headers.authorization, {
    applicationId: app.id,
    action: 'read',
    resource: 'profile',
  })
  if (!result.allowed) return res.status(403).json({ error: 'Forbidden' })
  res.json({ principalId: result.principalId })
})

server.listen(3000)
```

## Create a user

```ts
const principal = await auth.admin.principals.create({
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple-2025', // min 12 chars
})

await auth.admin.memberships.create({
  principalId: principal.id,
  applicationId: app.id,
  roles: ['member'],
})
```

## Test the login flow

```bash
# Login
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"correct-horse-battery-staple-2025","applicationId":"<app-id>"}'

# Use the returned accessToken
curl http://localhost:3000/api/me \
  -H 'Authorization: Bearer <accessToken>'
```

## Verify your setup

Run `blindfold doctor` to check your configuration before going further:

```bash
npx blindfold-auth doctor
```

See [blindfold doctor](/cli/doctor) for all checks.

## Next steps

- [Understand the workspace model](/guide/concepts)
- [Configure security settings](/guide/security)
- [Set up Postgres for production](/guide/deployment)
- [Add RBAC/ABAC policies](/authz/overview)
- [Add SSO (Okta, Entra ID)](/sso/)
