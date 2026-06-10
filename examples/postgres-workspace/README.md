# Postgres Workspace Example

This example is the recommended embedded `Node + Postgres` lane and uses the standardized Blindfold env names.

## Quick start

From the repository root:

```sh
npm install
cp ./examples/postgres-workspace/.env.example ./examples/postgres-workspace/.env
set -a && source ./examples/postgres-workspace/.env && set +a
npm run postgres:up
npm run migrate:postgres-example
npm run bootstrap:postgres-example
npm run smoke:postgres-example
npm run studio:postgres-example
```

Then open `http://127.0.0.1:4110`.

## Required env vars

```sh
export BLINDFOLD_WORKSPACE_ID=workspace_postgres_demo
export BLINDFOLD_SECRET=replace-me
export BLINDFOLD_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55433/blindfold
export BLINDFOLD_POSTGRES_SCHEMA=blindfold
```

Optional Studio env vars:

```sh
export BLINDFOLD_STUDIO_HOST=127.0.0.1
export BLINDFOLD_STUDIO_PORT=4110
```

## Commands

```sh
docker compose up -d postgres
node ../../packages/auth-cli/bin/blindfold-auth.js migrate --config ./blindfold.config.js
node ../../packages/auth-cli/bin/blindfold-auth.js bootstrap --config ./blindfold.config.js --workspace-name "Blindfold Postgres Workspace"
node ./smoke.mjs
node ../../packages/auth-cli/bin/blindfold-auth.js studio --config ./blindfold.config.js --port ${BLINDFOLD_STUDIO_PORT:-4110}
```

Dry-run the migration contract:

```sh
node ../../packages/auth-cli/bin/blindfold-auth.js migrate --config ./blindfold.config.js --dry-run
```

The migration also creates the current Postgres performance indexes for auth lookups such as principals by email, memberships by application/principal, role permissions, policy rules, and auth challenges.

## What the smoke script checks

`node ./smoke.mjs` will:

- apply migrations
- bootstrap the workspace
- create or reuse a demo application, principal, role, and membership
- verify password login
- verify session introspection
- verify an `invoice:read` allow rule
- verify a field-level `mask` rule on `invoice.internalNotes`

Use `docker compose down` when you want to stop the local database.
