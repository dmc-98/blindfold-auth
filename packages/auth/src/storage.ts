import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TABLES } from "./constants.js";
import { clone } from "./utils.js";
import type { Storage, StorageRecord } from "./types.js";

type TableState = Record<string, StorageRecord[]>;
type IndexState = Record<string, Map<string, number>>;
type FilterCacheState = Record<string, Map<string, string[]>>;

function createEmptyState(): TableState {
  return Object.fromEntries(TABLES.map((table) => [table, []]));
}

function createIndexState(state: TableState): IndexState {
  return Object.fromEntries(
    TABLES.map((table) => [
      table,
      new Map<string, number>((state[table] || []).map((record, index) => [record.id, index]))
    ])
  );
}

function createFilterCacheState(): FilterCacheState {
  return Object.fromEntries(TABLES.map((table) => [table, new Map<string, string[]>()]));
}

function isCacheableFilter(filter: Record<string, unknown> = {}): boolean {
  return Object.values(filter).every((value) => value === null || ["string", "number", "boolean"].includes(typeof value));
}

function createFilterCacheKey(filter: Record<string, unknown> = {}): string {
  return JSON.stringify(
    Object.entries(filter)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value])
  );
}

function invalidateTableCache(filterCaches: FilterCacheState, table: string): void {
  filterCaches[table] = new Map();
}

function ensureTableIndex(indexes: IndexState, state: TableState, table: string): Map<string, number> {
  indexes[table] ||= new Map<string, number>((state[table] || []).map((record, index) => [record.id, index]));
  return indexes[table]!;
}

function getIndexedRecord(state: TableState, indexes: IndexState, table: string, id: string): StorageRecord | null {
  const tableIndex = ensureTableIndex(indexes, state, table);
  const recordIndex = tableIndex.get(id);
  if (recordIndex === undefined) {
    return null;
  }

  return clone(state[table]?.[recordIndex]) || null;
}

function putIndexedRecord(state: TableState, indexes: IndexState, table: string, record: StorageRecord): StorageRecord {
  state[table] ||= [];
  const tableIndex = ensureTableIndex(indexes, state, table);
  const recordIndex = tableIndex.get(record.id);
  if (recordIndex !== undefined) {
    state[table]![recordIndex] = clone(record);
  } else {
    state[table]!.push(clone(record));
    tableIndex.set(record.id, state[table]!.length - 1);
  }

  return clone(record);
}

function deleteIndexedRecord(state: TableState, indexes: IndexState, table: string, id: string): boolean {
  state[table] ||= [];
  const tableIndex = ensureTableIndex(indexes, state, table);
  const recordIndex = tableIndex.get(id);
  if (recordIndex === undefined) {
    return false;
  }

  state[table]!.splice(recordIndex, 1);
  indexes[table] = new Map(state[table]!.map((record, index) => [record.id, index]));
  return true;
}

function matchesFilter(record: StorageRecord, filter: Record<string, unknown>): boolean {
  return Object.entries(filter || {}).every(([key, expected]) => record?.[key] === expected);
}

function listIndexedRecords(
  state: TableState,
  indexes: IndexState,
  filterCaches: FilterCacheState,
  table: string,
  filter: Record<string, unknown> = {}
): StorageRecord[] {
  const records = state[table] || [];
  if (!isCacheableFilter(filter)) {
    return records.filter((record) => matchesFilter(record, filter)).map((record) => clone(record));
  }

  const tableCache = filterCaches[table] || new Map<string, string[]>();
  filterCaches[table] = tableCache;
  const cacheKey = createFilterCacheKey(filter);
  const cachedIds = tableCache.get(cacheKey);
  if (cachedIds) {
    return cachedIds
      .map((id) => getIndexedRecord(state, indexes, table, id))
      .filter((record): record is StorageRecord => Boolean(record));
  }

  const matchedRecords = records.filter((record) => matchesFilter(record, filter));
  tableCache.set(
    cacheKey,
    matchedRecords.map((record) => record.id)
  );
  return matchedRecords.map((record) => clone(record));
}

export function createMemoryStorage(initialState: Record<string, StorageRecord[]> = {}): Storage {
  const state = createEmptyState();

  for (const [table, records] of Object.entries(initialState)) {
    state[table] = records.map((record) => clone(record));
  }

  const indexes = createIndexState(state);
  const filterCaches = createFilterCacheState();

  return {
    kind: "memory",
    async ensureTables() {},
    async list(table, filter = {}) {
      return listIndexedRecords(state, indexes, filterCaches, table, filter);
    },
    async get(table, id) {
      return getIndexedRecord(state, indexes, table, id);
    },
    async put(table, record) {
      const nextRecord = putIndexedRecord(state, indexes, table, record);
      invalidateTableCache(filterCaches, table);
      return nextRecord;
    },
    async delete(table, id) {
      const deleted = deleteIndexedRecord(state, indexes, table, id);
      if (deleted) {
        invalidateTableCache(filterCaches, table);
      }
    },
    async reset() {
      for (const table of TABLES) {
        state[table] = [];
        indexes[table] = new Map();
        filterCaches[table] = new Map();
      }
    }
  };
}

export function createFileStorage({ filePath }: { filePath: string }): Storage {
  if (!filePath) {
    throw new Error("createFileStorage requires a filePath");
  }

  let cache: TableState | null = null;
  let indexes: IndexState | null = null;
  let filterCaches: FilterCacheState | null = null;

  async function load(): Promise<TableState> {
    if (cache) {
      return cache;
    }

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      cache = Object.assign(createEmptyState(), parsed);
      indexes = createIndexState(cache!);
      filterCaches = createFilterCacheState();
      return cache!;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      cache = createEmptyState();
      indexes = createIndexState(cache);
      filterCaches = createFilterCacheState();
      return cache;
    }
  }

  async function persist(state: TableState): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(state, null, 2));
  }

  return {
    kind: "file",
    async ensureTables() {
      const state = await load();
      await persist(state);
    },
    async list(table, filter = {}) {
      const state = await load();
      return listIndexedRecords(state, indexes!, filterCaches!, table, filter);
    },
    async get(table, id) {
      const state = await load();
      return getIndexedRecord(state, indexes!, table, id);
    },
    async put(table, record) {
      const state = await load();
      putIndexedRecord(state, indexes!, table, record);
      invalidateTableCache(filterCaches!, table);
      await persist(state);
      return clone(record);
    },
    async delete(table, id) {
      const state = await load();
      const deleted = deleteIndexedRecord(state, indexes!, table, id);
      if (deleted) {
        invalidateTableCache(filterCaches!, table);
        await persist(state);
      }
    },
    async reset() {
      cache = createEmptyState();
      indexes = createIndexState(cache);
      filterCaches = createFilterCacheState();
      await persist(cache);
    }
  };
}
