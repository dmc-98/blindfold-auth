# Configuration and Environment Contract

This document defines the standardized configuration and env-var contract for Blindfold Auth.

## Standard env vars

### Required for the recommended Node + Postgres lane

- `BLINDFOLD_WORKSPACE_ID`
- `BLINDFOLD_SECRET`
- `BLINDFOLD_DATABASE_URL`

### Optional for the recommended Node + Postgres lane

- `BLINDFOLD_POSTGRES_SCHEMA`
- `BLINDFOLD_STUDIO_HOST`
- `BLINDFOLD_STUDIO_PORT`

## Current defaults

- `BLINDFOLD_WORKSPACE_ID`: `workspace_local`
- `BLINDFOLD_POSTGRES_SCHEMA`: `blindfold`
- `BLINDFOLD_STUDIO_HOST`: `127.0.0.1`
- `BLINDFOLD_STUDIO_PORT`: `4110`

## Runtime helper

The runtime now exposes:

- `loadBlindfoldEnv(...)`
- `assertBlindfoldEnv(...)`
- `BLINDFOLD_ENV_NAMES`

These helpers should be the default way to read and validate deployment env vars in embedded application configs.

## Recommended embedded config shape

```js
import { assertBlindfoldEnv, createAuth, loadBlindfoldEnv } from "@blindfold/auth";
import { createPostgresStorage } from "@blindfold/auth-storage-postgres";

const env = assertBlindfoldEnv(loadBlindfoldEnv(), { requireDatabaseUrl: true });

const auth = createAuth({
  workspaceId: env.workspaceId,
  secret: env.secret,
  storage: createPostgresStorage({
    schema: env.postgres.schema,
    query(sql, params) {
      return pool.query(sql, params);
    }
  })
});
```

## Example source

The repository's recommended deployment example is:

- `examples/postgres-workspace/blindfold.config.ts`

## Contract rule

New deployment docs, examples, and production integrations should use these env names unless there is a strong reason to document a compatibility alias.

