/**
 * Minimal in-memory MongoDB `Db` fake for tests.
 *
 * Implements just enough of the collection API the adapter uses
 * (findOne, find().toArray(), replaceOne, deleteOne, createIndex) so the Mongo
 * adapter can run under the conformance kit without a real server. The matching
 * semantics mirror MongoDB exact-match queries on top-level fields.
 */
export interface InMemoryCollection {
  findOne(query?: Record<string, any>): Promise<Record<string, any> | null>;
  find(query?: Record<string, any>): { toArray(): Promise<Record<string, any>[]> };
  replaceOne(
    filter?: Record<string, any>,
    replacement?: Record<string, any>,
    options?: { upsert?: boolean }
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }>;
  deleteOne(filter?: Record<string, any>): Promise<{ deletedCount: number }>;
  createIndex(...args: any[]): Promise<string>;
}

export interface InMemoryMongoDb {
  collection(name: string): InMemoryCollection;
}

function matches(doc: Record<string, any> | undefined, query?: Record<string, any>): boolean {
  return Object.entries(query || {}).every(([key, value]) => doc?.[key] === value);
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createCollection(): InMemoryCollection {
  const docs = new Map<any, Record<string, any>>(); // _id -> document

  return {
    async findOne(query: Record<string, any> = {}) {
      for (const doc of docs.values()) {
        if (matches(doc, query)) {
          return clone(doc);
        }
      }
      return null;
    },
    find(query: Record<string, any> = {}) {
      const results: Record<string, any>[] = [];
      for (const doc of docs.values()) {
        if (matches(doc, query)) {
          results.push(clone(doc));
        }
      }
      return {
        async toArray() {
          return results;
        }
      };
    },
    async replaceOne(filter: Record<string, any> = {}, replacement: Record<string, any> = {}, options: { upsert?: boolean } = {}) {
      const id = filter._id ?? replacement._id;
      const existingKey = [...docs.keys()].find((key) => {
        const doc = docs.get(key);
        return matches(doc, filter);
      });
      if (existingKey != null) {
        docs.set(existingKey, clone(replacement));
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      }
      if (options.upsert) {
        docs.set(id, clone(replacement));
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    },
    async deleteOne(filter: Record<string, any> = {}) {
      const key = [...docs.keys()].find((k) => matches(docs.get(k), filter));
      if (key != null) {
        docs.delete(key);
        return { deletedCount: 1 };
      }
      return { deletedCount: 0 };
    },
    async createIndex() {
      return "id_1";
    }
  };
}

export function createInMemoryMongoDb(): InMemoryMongoDb {
  const collections = new Map<string, InMemoryCollection>();
  return {
    collection(name: string) {
      if (!collections.has(name)) {
        collections.set(name, createCollection());
      }
      return collections.get(name)!;
    }
  };
}

export default createInMemoryMongoDb;
