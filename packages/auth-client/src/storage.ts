import { createMemoryStorage, createFileStorage } from "@dmc--98/blindfold-auth";
import type { Storage } from "@dmc--98/blindfold-auth";

/**
 * Adapters that ship today. Aliases reserved for M4 (universal storage) throw a
 * clear, actionable error instead of failing obscurely, so the few-lines DX is
 * honest about what is and isn't available yet.
 */
// Adapters with a shipped package, lazy-loaded on demand.
const LOADABLE_ALIASES: Record<string, { module: string; factory: string }> = {
  postgres: { module: "@dmc--98/blindfold-auth-storage-postgres", factory: "createPostgresStorage" },
  pg: { module: "@dmc--98/blindfold-auth-storage-postgres", factory: "createPostgresStorage" },
  sqlite: { module: "@dmc--98/blindfold-auth-storage-sqlite", factory: "createSqliteStorage" },
  mongo: { module: "@dmc--98/blindfold-auth-storage-mongo", factory: "createMongoStorage" },
  mongodb: { module: "@dmc--98/blindfold-auth-storage-mongo", factory: "createMongoStorage" }
};

// Aliases still on the roadmap (M4 continued).
const PLANNED_ALIASES: Record<string, string> = {
  mysql: "@dmc--98/blindfold-auth-storage-mysql",
  dynamo: "@dmc--98/blindfold-auth-storage-dynamo",
  dynamodb: "@dmc--98/blindfold-auth-storage-dynamo",
  redis: "@dmc--98/blindfold-auth-storage-redis"
};

function isStorageAdapter(value: any): value is Storage {
  return (
    value &&
    typeof value === "object" &&
    typeof value.ensureTables === "function" &&
    typeof value.get === "function" &&
    typeof value.put === "function" &&
    typeof value.list === "function" &&
    typeof value.delete === "function"
  );
}

/**
 * Resolve a `storage` option into a concrete adapter.
 *
 * Accepts:
 *  - an adapter object (passes through, validated against the 5-method contract)
 *  - "memory" (default)
 *  - "file" (requires options.filePath or a string "file:/path")
 *  - "postgres" (lazy-loads @dmc--98/blindfold-auth-storage-postgres)
 *
 * @returns {Promise<object>} a storage adapter
 */
export async function resolveStorage(storage: any, options: Record<string, any> = {}): Promise<Storage> {
  if (isStorageAdapter(storage)) {
    return storage;
  }

  if (storage && typeof storage === "object") {
    throw new Error(
      "Custom storage object does not satisfy the adapter contract (ensureTables/list/get/put/delete)."
    );
  }

  const alias = typeof storage === "string" ? storage.toLowerCase() : "memory";

  if (alias === "memory") {
    return createMemoryStorage(options.initialState || {});
  }

  if (alias === "file") {
    const filePath = options.filePath;
    if (!filePath) {
      throw new Error('storage: "file" requires options.storageOptions.filePath');
    }
    return createFileStorage({ filePath });
  }

  if (LOADABLE_ALIASES[alias]) {
    const { module: moduleName, factory } = LOADABLE_ALIASES[alias];
    let mod: Record<string, any>;
    try {
      mod = await import(moduleName);
    } catch {
      throw new Error(
        `storage: "${alias}" needs ${moduleName} installed. Run: npm i ${moduleName}`
      );
    }
    if (typeof mod[factory] !== "function") {
      throw new Error(`${moduleName} did not export ${factory}`);
    }
    return mod[factory](options);
  }

  if (PLANNED_ALIASES[alias]) {
    throw new Error(
      `storage: "${alias}" is planned (M4 — universal storage) via ${PLANNED_ALIASES[alias]}, ` +
        "not yet shipped. For now pass a custom adapter implementing ensureTables/list/get/put/delete, " +
        'or use "postgres", "file", or "memory".'
    );
  }

  throw new Error(
    `Unknown storage "${storage}". Use "memory", "file", "postgres", or a custom adapter object.`
  );
}

export { isStorageAdapter };
