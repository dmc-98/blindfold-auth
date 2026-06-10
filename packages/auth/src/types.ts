/**
 * Shared domain types for the Blindfold Auth engine.
 *
 * The storage layer is intentionally generic — adapters persist plain JSON
 * documents keyed by `id` across a fixed set of tables. Domain records extend
 * {@link StorageRecord} so the engine can treat any table row uniformly while
 * still naming the fields that matter on the public surface.
 */

/** JSON-serializable value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * A persisted document. Every record has a string `id`; other fields are
 * dynamic JSON. The index signature is `any` deliberately — this is a schemaless
 * document store and domain modules narrow fields at their own call sites.
 */
export interface StorageRecord {
  id: string;
  [key: string]: any;
}

/** The five-method storage contract every adapter implements. */
export interface Storage {
  kind?: string;
  ensureTables(): Promise<void>;
  list(table: string, filter?: Record<string, unknown>): Promise<StorageRecord[]>;
  get(table: string, id: string): Promise<StorageRecord | null>;
  put(table: string, record: StorageRecord): Promise<StorageRecord>;
  delete(table: string, id: string): Promise<void>;
  reset?(): Promise<void>;
}

/** A generic HTTP-ish request the handlers accept (framework-agnostic). */
export interface AuthRequest {
  body?: Record<string, any>;
  query?: Record<string, any>;
  headers?: Record<string, string | string[] | undefined>;
  host?: string;
  origin?: string;
}

/** A generic HTTP-ish response the handlers emit. */
export interface AuthResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

/** Result of a `can()` / policy evaluation. */
export interface PolicyDecision {
  allowed: boolean;
  effect: "allow" | "deny" | "mask" | "readonly";
  matchedRuleIds: string[];
  obligations: { maskedFields: string[]; readonlyFields: string[] };
  reason: string;
}

export interface SessionConfig {
  accessTokenTtl: string | number;
  refreshTokenTtl: string | number;
  rotationGraceMs: number;
}
