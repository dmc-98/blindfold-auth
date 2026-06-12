import { Pool } from "pg";
import { assertBlindfoldEnv, createAuth, loadBlindfoldEnv } from "@dmc--98/blindfold-auth";
import { createPostgresStorage, runPostgresMigrations } from "@dmc--98/blindfold-auth-storage-postgres";

const env = assertBlindfoldEnv(
  loadBlindfoldEnv({
    defaults: {
      workspaceId: "workspace_postgres_demo"
    }
  }),
  { requireDatabaseUrl: true }
);

const pool = new Pool({
  connectionString: env.postgres.url!
});

const storage = createPostgresStorage({
  schema: env.postgres.schema,
  query(sql: string, params: any[] = []) {
    return pool.query(sql, params);
  }
});

export async function migrate({ dryRun = false }: { dryRun?: boolean } = {}) {
  return runPostgresMigrations({
    schema: env.postgres.schema,
    dryRun,
    query(sql: string, params: any[] = []) {
      return pool.query(sql, params);
    }
  });
}

export default function createConfiguredAuth() {
  return createAuth({
    workspaceId: env.workspaceId,
    secret: env.secret!,
    storage
  });
}
