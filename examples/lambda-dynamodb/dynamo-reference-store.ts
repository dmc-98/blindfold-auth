import { TABLES } from "@blindfold/auth";
import type { Storage } from "@blindfold/auth";

export interface DynamoReferenceStoreOptions {
  client: any;
  tablePrefix?: string;
}

export function createDynamoReferenceStore({ client, tablePrefix = "blindfold" }: DynamoReferenceStoreOptions): Storage {
  if (!client || typeof client.get !== "function" || typeof client.put !== "function" || typeof client.delete !== "function" || typeof client.scan !== "function") {
    throw new Error("createDynamoReferenceStore requires a client with get, put, delete, and scan methods");
  }

  return {
    kind: "dynamodb-reference",
    async ensureTables() {
      return TABLES as unknown as void;
    },
    async list(table: string, filter: Record<string, unknown> = {}) {
      const result = await client.scan({ tableName: `${tablePrefix}_${table}` });
      return (result.items || [])
        .map((item: any) => item.document)
        .filter((record: any) => Object.entries(filter).every(([key, value]) => record?.[key] === value));
    },
    async get(table: string, id: string) {
      const result = await client.get({ tableName: `${tablePrefix}_${table}`, key: { id } });
      return result.item?.document || null;
    },
    async put(table: string, record: any) {
      await client.put({
        tableName: `${tablePrefix}_${table}`,
        item: {
          id: record.id,
          document: record
        }
      });
      return record;
    },
    async delete(table: string, id: string) {
      await client.delete({ tableName: `${tablePrefix}_${table}`, key: { id } });
    }
  };
}
