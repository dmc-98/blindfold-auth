import { TABLES } from "@dmc--98/blindfold-auth";
import type { Storage, StorageRecord } from "@dmc--98/blindfold-auth";

export const DEFAULT_POSTGRES_SCHEMA = "blindfold";

export type QueryFn = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;

export interface MigrationStep {
  id: string;
  description: string;
  sql: string;
}

export interface MigrationResult {
  schema: string;
  plan: MigrationStep[];
  applied: string[];
}

export interface PostgresStorageOptions {
  query: QueryFn;
  schema?: string;
}

function quoteIdentifier(value: string): string {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function tableName(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function quoteLiteral(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildScalarFilterSql(filter: Record<string, unknown> = {}): { where: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  const containmentFilter: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filter)) {
    if (value === null || typeof value === "object") {
      containmentFilter[key] = value;
      continue;
    }

    params.push(String(value));
    clauses.push(`document ->> ${quoteLiteral(key)} = $${params.length}`);
  }

  if (Object.keys(containmentFilter).length > 0) {
    params.push(JSON.stringify(containmentFilter));
    clauses.push(`document @> $${params.length}::jsonb`);
  }

  return {
    where: clauses.length > 0 ? ` where ${clauses.join(" and ")}` : "",
    params
  };
}

export function buildPostgresSchemaSql({ schema = DEFAULT_POSTGRES_SCHEMA }: { schema?: string } = {}): string {
  const statements: string[] = [`create schema if not exists ${quoteIdentifier(schema)};`];

  for (const table of TABLES) {
    statements.push(`
create table if not exists ${tableName(schema, table)} (
  id text primary key,
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ${quoteIdentifier(`${table}_document_gin`)} on ${tableName(schema, table)} using gin (document);
create index if not exists ${quoteIdentifier(`${table}_created_at_idx`)} on ${tableName(schema, table)} (created_at);
`);
  }

  statements.push(`
create index if not exists ${quoteIdentifier("applications_slug_idx")} on ${tableName(schema, "applications")} ((document ->> 'slug'));
create index if not exists ${quoteIdentifier("principals_email_idx")} on ${tableName(schema, "principals")} ((document ->> 'email'));
create index if not exists ${quoteIdentifier("memberships_principal_app_idx")} on ${tableName(schema, "memberships")} ((document ->> 'principalId'), (document ->> 'applicationId'));
create index if not exists ${quoteIdentifier("role_permissions_app_role_idx")} on ${tableName(schema, "role_permissions")} ((document ->> 'applicationId'), (document ->> 'roleId'));
create index if not exists ${quoteIdentifier("policy_rules_app_scope_idx")} on ${tableName(schema, "policy_rules")} ((document ->> 'applicationId'), (document ->> 'roleId'), (document ->> 'principalId'));
create index if not exists ${quoteIdentifier("direct_grants_app_principal_idx")} on ${tableName(schema, "direct_grants")} ((document ->> 'applicationId'), (document ->> 'principalId'));
create index if not exists ${quoteIdentifier("auth_challenges_lookup_idx")} on ${tableName(schema, "auth_challenges")} ((document ->> 'applicationId'), (document ->> 'status'), (document ->> 'tokenHash'));
create index if not exists ${quoteIdentifier("identity_providers_key_idx")} on ${tableName(schema, "identity_providers")} ((document ->> 'key'));
create index if not exists ${quoteIdentifier("identity_providers_type_idx")} on ${tableName(schema, "identity_providers")} ((document ->> 'type'));
create index if not exists ${quoteIdentifier("application_identity_providers_app_provider_idx")} on ${tableName(schema, "application_identity_providers")} ((document ->> 'applicationId'), (document ->> 'providerId'));
create index if not exists ${quoteIdentifier("webauthn_credentials_app_credential_idx")} on ${tableName(schema, "webauthn_credentials")} ((document ->> 'applicationId'), (document ->> 'credentialId'));
create index if not exists ${quoteIdentifier("webauthn_credentials_principal_app_idx")} on ${tableName(schema, "webauthn_credentials")} ((document ->> 'principalId'), (document ->> 'applicationId'));
create index if not exists ${quoteIdentifier("federated_identities_provider_subject_idx")} on ${tableName(schema, "federated_identities")} ((document ->> 'providerId'), (document ->> 'applicationId'), (document ->> 'externalSubject'));
create index if not exists ${quoteIdentifier("federated_identities_email_idx")} on ${tableName(schema, "federated_identities")} ((document ->> 'email'));
`);

  return statements.join("\n");
}

export function getPostgresMigrationPlan({ schema = DEFAULT_POSTGRES_SCHEMA }: { schema?: string } = {}): MigrationStep[] {
  return [
    {
      id: "0001_core_tables",
      description: "Create the Blindfold schema and core document tables",
      sql: buildPostgresSchemaSql({ schema })
    }
  ];
}

export async function runPostgresMigrations({
  query,
  schema = DEFAULT_POSTGRES_SCHEMA,
  dryRun = false
}: {
  query: QueryFn;
  schema?: string;
  dryRun?: boolean;
}): Promise<MigrationResult> {
  if (typeof query !== "function") {
    throw new Error("runPostgresMigrations requires a query(sql, params) function");
  }

  const plan = getPostgresMigrationPlan({ schema });
  if (dryRun) {
    return {
      schema,
      plan,
      applied: []
    };
  }

  for (const migration of plan) {
    await query(migration.sql);
  }

  return {
    schema,
    plan,
    applied: plan.map((migration) => migration.id)
  };
}

export function createPostgresStorage({ query, schema = DEFAULT_POSTGRES_SCHEMA }: PostgresStorageOptions): Storage {
  if (typeof query !== "function") {
    throw new Error("createPostgresStorage requires a query(sql, params) function");
  }

  return {
    kind: "postgres",
    async ensureTables(): Promise<void> {
      await runPostgresMigrations({ query, schema });
    },
    async list(table: string, filter: Record<string, unknown> = {}): Promise<StorageRecord[]> {
      const { where, params } = buildScalarFilterSql(filter);
      const result = await query(`select document from ${tableName(schema, table)}${where} order by created_at asc`, params);
      return result.rows.map((row) => row.document);
    },
    async get(table: string, id: string): Promise<StorageRecord | null> {
      const result = await query(`select document from ${tableName(schema, table)} where id = $1 limit 1`, [id]);
      return result.rows[0]?.document || null;
    },
    async put(table: string, record: StorageRecord): Promise<StorageRecord> {
      await query(
        `
insert into ${tableName(schema, table)} (id, document, created_at, updated_at)
values ($1, $2::jsonb, coalesce($3, now()), coalesce($4, now()))
on conflict (id) do update
set document = excluded.document,
    updated_at = excluded.updated_at
`,
        [
          record.id,
          JSON.stringify(record),
          record.createdAt || null,
          record.updatedAt || null
        ]
      );

      return record;
    },
    async delete(table: string, id: string): Promise<void> {
      await query(`delete from ${tableName(schema, table)} where id = $1`, [id]);
    }
  };
}
