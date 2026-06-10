import assert from "node:assert/strict";
import test from "node:test";
import { buildPostgresSchemaSql, createPostgresStorage, getPostgresMigrationPlan, runPostgresMigrations } from "../src/index.js";

test("Postgres adapter emits schema sql for the core tables", () => {
  const sql = buildPostgresSchemaSql();
  assert.match(sql, /create schema if not exists "blindfold"/);
  assert.match(sql, /create table if not exists "blindfold"\."applications"/);
  assert.match(sql, /create table if not exists "blindfold"\."policy_rules"/);
  assert.match(sql, /create index if not exists "applications_slug_idx"/);
  assert.match(sql, /create index if not exists "principals_email_idx"/);
  assert.match(sql, /create index if not exists "auth_challenges_lookup_idx"/);
  assert.match(sql, /create index if not exists "identity_providers_key_idx"/);
  assert.match(sql, /create index if not exists "application_identity_providers_app_provider_idx"/);
  assert.match(sql, /create index if not exists "webauthn_credentials_app_credential_idx"/);
  assert.match(sql, /create index if not exists "federated_identities_provider_subject_idx"/);
});

test("Postgres adapter uses the provided query interface", async () => {
  const calls: Array<{ sql: string; params: any[] }> = [];
  const storage = createPostgresStorage({
    query: async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      return { rows: [] };
    }
  });

  await storage.ensureTables();
  await storage.put("applications", { id: "app_1", name: "Billing App" });
  await storage.list("applications", { name: "Billing App" });

  assert.equal(calls.length, 3);
  assert.match(calls[0].sql, /create schema if not exists/);
  assert.match(calls[1].sql, /insert into "blindfold"\."applications"/);
  assert.match(calls[2].sql, /document ->> 'name' = \$1/);
  assert.deepEqual(calls[2].params, ["Billing App"]);
});

test("Postgres migration plan is explicit and executable", async () => {
  const calls: string[] = [];
  const plan = getPostgresMigrationPlan({ schema: "blindfold_app" });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].id, "0001_core_tables");

  const result = await runPostgresMigrations({
    schema: "blindfold_app",
    query: async (sql: string) => {
      calls.push(sql);
      return { rows: [] };
    }
  });

  assert.equal(result.schema, "blindfold_app");
  assert.deepEqual(result.applied, ["0001_core_tables"]);
  assert.equal(calls.length, 1);
});
