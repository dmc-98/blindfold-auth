import { DatabaseSync } from "node:sqlite";
import { TABLES } from "@blindfold/auth";
import type { Storage, StorageRecord } from "@blindfold/auth";

/**
 * SQLite storage adapter for Blindfold Auth.
 *
 * Implements the 5-method storage contract (ensureTables/list/get/put/delete)
 * over Node's built-in `node:sqlite`. Each Blindfold table becomes a SQL table
 * with a primary-key `id` and a JSON `data` column — keeping the document model
 * the runtime expects while running on a real SQL engine.
 *
 *   import { createSqliteStorage } from "@blindfold/auth-storage-sqlite";
 *   const storage = createSqliteStorage({ filePath: "./auth.db" }); // or ":memory:"
 *   const auth = createAuth({ secret, storage });
 *
 * Filtering uses exact-match semantics identical to the reference adapters
 * (in-process matching, so absent-vs-null and boolean comparisons behave
 * exactly as in the memory/file adapters). SQL pushdown via json_extract is a
 * future optimization tracked in the storage roadmap.
 */
const SAFE_NAME = /^[a-z][a-z0-9_]*$/;

export interface SqliteStorageOptions {
  filePath?: string;
}

export interface SqliteStorage extends Storage {
  db: DatabaseSync;
  close(): void;
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function quoteIdent(name: string): string {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`Unsafe SQLite table name: ${name}`);
  }
  return `"${name}"`;
}

function matchesFilter(record: Record<string, any>, filter?: Record<string, unknown>): boolean {
  return Object.entries(filter || {}).every(([key, expected]) => record?.[key] === expected);
}

export function createSqliteStorage(options: SqliteStorageOptions = {}): SqliteStorage {
  const filePath = options.filePath || ":memory:";
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL;");

  const known = new Set<string>(TABLES);
  const created = new Set<string>();

  function ensureTable(table: string): void {
    if (created.has(table)) {
      return;
    }
    if (!SAFE_NAME.test(table)) {
      throw new Error(`Unsafe table name: ${table}`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    created.add(table);
  }

  return {
    /** Exposes the raw connection for migrations/debugging. */
    db,

    async ensureTables(tables: readonly string[] = TABLES): Promise<void> {
      const list = Array.isArray(tables) && tables.length ? tables : TABLES;
      for (const table of list) {
        ensureTable(table);
      }
      // also ensure any known tables so the runtime never hits a missing table
      for (const table of known) {
        ensureTable(table);
      }
    },

    async get(table: string, id: string): Promise<StorageRecord | null> {
      ensureTable(table);
      const row = db.prepare(`SELECT data FROM ${quoteIdent(table)} WHERE id = ?`).get(String(id)) as { data: string } | undefined;
      return row ? JSON.parse(row.data) : null;
    },

    async put(table: string, record: StorageRecord): Promise<StorageRecord> {
      ensureTable(table);
      if (!record || record.id == null) {
        throw new Error("put requires a record with an id");
      }
      const data = JSON.stringify(record);
      db.prepare(
        `INSERT INTO ${quoteIdent(table)} (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`
      ).run(String(record.id), data);
      return clone(record);
    },

    async delete(table: string, id: string): Promise<void> {
      ensureTable(table);
      db.prepare(`DELETE FROM ${quoteIdent(table)} WHERE id = ?`).run(String(id));
    },

    async list(table: string, filter: Record<string, unknown> = {}): Promise<StorageRecord[]> {
      ensureTable(table);
      const rows = db.prepare(`SELECT data FROM ${quoteIdent(table)}`).all() as Array<{ data: string }>;
      const records = rows.map((row) => JSON.parse(row.data));
      const entries = Object.entries(filter || {});
      return entries.length ? records.filter((record) => matchesFilter(record, filter)) : records;
    },

    /** Drop all rows (test convenience). */
    async reset(): Promise<void> {
      for (const table of created) {
        db.exec(`DELETE FROM ${quoteIdent(table)};`);
      }
    },

    close(): void {
      db.close();
    }
  };
}

export default createSqliteStorage;
