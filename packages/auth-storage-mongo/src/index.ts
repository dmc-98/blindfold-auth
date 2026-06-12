/**
 * MongoDB (NoSQL) storage adapter for Blindfold Auth.
 *
 * Implements the 5-method storage contract over a MongoDB `Db`. Each Blindfold
 * table maps to a collection; each record is a document keyed by `_id = record.id`.
 * This demonstrates the engine's backend-agnosticism: the same runtime runs on a
 * document store with no schema migrations.
 *
 *   import { MongoClient } from "mongodb";
 *   import { createMongoStorage } from "@dmc--98/blindfold-auth-storage-mongo";
 *   const client = await new MongoClient(uri).connect();
 *   const storage = createMongoStorage({ db: client.db("blindfold") });
 *   const auth = createAuth({ secret, storage });
 *
 * For tests without a server, pair with the in-memory db fake:
 *   import { createInMemoryMongoDb } from "@dmc--98/blindfold-auth-storage-mongo/memory";
 *
 * The adapter depends only on the standard collection API
 * (findOne / find().toArray() / replaceOne / deleteOne), so it works with the
 * real `mongodb` driver and the fake alike.
 */
import type { Storage, StorageRecord } from "@dmc--98/blindfold-auth";

export interface MongoLikeCollection {
  findOne(query?: Record<string, any>): Promise<Record<string, any> | null>;
  find(query?: Record<string, any>): { toArray(): Promise<Record<string, any>[]> };
  replaceOne(filter: Record<string, any>, replacement: Record<string, any>, options?: { upsert?: boolean }): Promise<any>;
  deleteOne(filter: Record<string, any>): Promise<any>;
  createIndex?(...args: any[]): Promise<any>;
}

export interface MongoLikeDb {
  collection(name: string): MongoLikeCollection;
}

export interface MongoStorageOptions {
  db?: MongoLikeDb;
  collectionPrefix?: string;
}

export interface MongoStorage extends Storage {
  db: MongoLikeDb;
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toRecord(doc: Record<string, any> | null): StorageRecord | null {
  if (!doc) {
    return null;
  }
  const { _id, ...rest } = doc;
  return rest as StorageRecord;
}

export function createMongoStorage(options: MongoStorageOptions = {}): MongoStorage {
  const db = options.db;
  if (!db || typeof db.collection !== "function") {
    throw new Error("createMongoStorage requires { db } (a MongoDB Db or compatible object)");
  }
  const prefix = options.collectionPrefix || "";

  function collection(table: string): MongoLikeCollection {
    return db!.collection(`${prefix}${table}`);
  }

  return {
    db,

    async ensureTables(tables: readonly string[] = []): Promise<void> {
      // Collections are created lazily by MongoDB. Optionally index `id` for
      // faster exact-match lookups when an index API is available.
      for (const table of Array.isArray(tables) ? tables : []) {
        const col = collection(table);
        if (typeof col.createIndex === "function") {
          try {
            await col.createIndex({ id: 1 });
          } catch {
            // index creation is best-effort; never block startup on it
          }
        }
      }
    },

    async get(table: string, id: string): Promise<StorageRecord | null> {
      const doc = await collection(table).findOne({ _id: String(id) });
      return toRecord(doc);
    },

    async put(table: string, record: StorageRecord): Promise<StorageRecord> {
      if (!record || record.id == null) {
        throw new Error("put requires a record with an id");
      }
      const _id = String(record.id);
      const doc = { _id, ...record };
      await collection(table).replaceOne({ _id }, doc, { upsert: true });
      return clone(record);
    },

    async delete(table: string, id: string): Promise<void> {
      await collection(table).deleteOne({ _id: String(id) });
    },

    async list(table: string, filter: Record<string, unknown> = {}): Promise<StorageRecord[]> {
      // Exact-match filter maps directly onto stored top-level fields.
      const docs = await collection(table).find(filter || {}).toArray();
      return docs.map(toRecord) as StorageRecord[];
    }
  };
}

export default createMongoStorage;
export { createInMemoryMongoDb } from "./in-memory-db.js";
