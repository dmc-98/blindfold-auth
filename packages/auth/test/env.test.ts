import assert from "node:assert/strict";
import test from "node:test";
import { BLINDFOLD_ENV_NAMES, assertBlindfoldEnv, loadBlindfoldEnv } from "../src/index.js";

test("loadBlindfoldEnv reads the standardized env names", () => {
  const config = loadBlindfoldEnv({
    env: {
      [BLINDFOLD_ENV_NAMES.workspaceId]: "workspace_prod",
      [BLINDFOLD_ENV_NAMES.secret]: "top-secret",
      [BLINDFOLD_ENV_NAMES.databaseUrl]: "postgresql://demo",
      [BLINDFOLD_ENV_NAMES.postgresSchema]: "blindfold_app",
      [BLINDFOLD_ENV_NAMES.studioHost]: "0.0.0.0",
      [BLINDFOLD_ENV_NAMES.studioPort]: "4222"
    }
  });

  assert.equal(config.workspaceId, "workspace_prod");
  assert.equal(config.secret, "top-secret");
  assert.equal(config.postgres.url, "postgresql://demo");
  assert.equal(config.postgres.schema, "blindfold_app");
  assert.equal(config.studio.host, "0.0.0.0");
  assert.equal(config.studio.port, 4222);
});

test("assertBlindfoldEnv enforces required values", () => {
  assert.throws(() => assertBlindfoldEnv({ secret: null } as any), /BLINDFOLD_SECRET/);
  assert.throws(
    () => assertBlindfoldEnv({ secret: "ok", postgres: { url: null } } as any, { requireDatabaseUrl: true }),
    /BLINDFOLD_DATABASE_URL/
  );
});
