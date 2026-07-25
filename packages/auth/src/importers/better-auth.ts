/**
 * importFromBetterAuth — migrate users from a Better Auth installation
 * to Blindfold principals.
 *
 * Compatible with Better Auth ≥1.0 (schema: user / session / account tables).
 *
 * ## Password handling
 * Better Auth stores passwords as argon2/bcrypt/scrypt hashes (depending on
 * the adapter + plugin). These hashes are NOT compatible with Blindfold's
 * bcrypt variant — importing a hash directly would let users log in with the
 * wrong credentials.  For this reason, the importer sets `passwordHash: null`
 * on every migrated principal by default.  Users authenticate post-migration
 * via magic link or admin-initiated password reset.
 *
 * If you want to pre-set temporary plaintext passwords (e.g. a migration one-
 * time-password), supply a `resolvePassword` callback that returns a plaintext
 * string for each user.  Never pass a Better Auth password hash here.
 *
 * ## Sessions
 * Better Auth sessions are incompatible with Blindfold sessions (different
 * signing keys, token format, and revocation mechanism).  Sessions are NOT
 * imported — all existing sessions expire naturally in Better Auth and users
 * establish new sessions in Blindfold via fresh login.
 *
 * @example
 * ```typescript
 * const result = await importFromBetterAuth({
 *   auth,                // createAuth() result, workspace already bootstrapped
 *   users: await db.select().from(schema.user),
 * });
 * console.log(`Imported ${result.imported} users, skipped ${result.skipped}`);
 * ```
 */

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * A user row from the Better Auth `user` table.
 * Any columns beyond the standard ones are passed through to Blindfold as
 * `attributes` on the principal.
 */
export interface BetterAuthUser {
  /** Better Auth internal user id (string, CUID/UUID depending on adapter). */
  id: string;
  /** Display name — maps to Blindfold `displayName`. */
  name: string;
  /** User email — maps to Blindfold `email`. Normalised before storage. */
  email: string;
  /** Whether the email was verified in Better Auth — stored as `attributes.emailVerified`. */
  emailVerified?: boolean;
  /** Avatar URL — stored as `attributes.image`. */
  image?: string | null;
  /** Account creation timestamp — stored as `attributes.originalCreatedAt`. */
  createdAt?: Date | string;
  /** Last update timestamp — stored as `attributes.originalUpdatedAt`. */
  updatedAt?: Date | string;
  /** Any additional columns (custom fields) — passed through as attributes. */
  [key: string]: unknown;
}

/** Internal Blindfold auth shape required by the importer (subset of createAuth() return). */
export interface BlindfoldAuthHandle {
  admin: {
    principals: {
      create(opts: {
        email: string;
        password?: string | null | undefined;
        displayName: string;
        attributes?: Record<string, unknown>;
        actorId?: string;
      }): Promise<{ id: string; email: string; [key: string]: unknown }>;
    };
  };
}

export interface BetterAuthImportOptions {
  /**
   * The createAuth() instance to import users into.
   * Must have already had `admin.bootstrapWorkspace()` called.
   */
  auth: BlindfoldAuthHandle;

  /** Better Auth users to import. */
  users: BetterAuthUser[];

  /**
   * Optional plaintext password resolver.  Called once per user before
   * import.  Return a plaintext string to create a hashed Blindfold
   * credential; return `null` or `undefined` to import without a password.
   *
   * **Never pass a Better Auth password hash here** — pass only plaintext.
   */
  resolvePassword?: (
    user: BetterAuthUser,
  ) => string | null | undefined | Promise<string | null | undefined>;

  /**
   * Actor id recorded in Blindfold audit events for every `principal.created`
   * event emitted during the import run.
   * @default "importer:better-auth"
   */
  actorId?: string;

  /**
   * When `true`, users whose email already exists in Blindfold are silently
   * skipped (counted in `result.skipped`) rather than added to `result.failed`.
   * @default false
   */
  skipExisting?: boolean;
}

/** Mapping between the original Better Auth user id and the new Blindfold principal id. */
export interface ImportedPrincipal {
  /** Better Auth `user.id` value. */
  originalId: string;
  /** Blindfold principal id assigned at import time. */
  principalId: string;
  /** Normalised email (as stored by Blindfold). */
  email: string;
}

export interface BetterAuthImportResult {
  /** Number of users successfully imported. */
  imported: number;
  /** Number of users skipped because their email already existed (requires `skipExisting: true`). */
  skipped: number;
  /** Users that failed to import, each with its original record and error message. */
  failed: Array<{ user: BetterAuthUser; reason: string }>;
  /** Id mapping from original Better Auth user id → new Blindfold principal id. */
  principals: ImportedPrincipal[];
}

// ── Implementation ────────────────────────────────────────────────────────────

/**
 * Standard Better Auth user columns that receive first-class handling.
 * All other columns are forwarded to `attributes` on the principal.
 */
const KNOWN_FIELDS = new Set<string>([
  "id",
  "name",
  "email",
  "emailVerified",
  "image",
  "createdAt",
  "updatedAt",
]);

/**
 * Migrate a list of Better Auth users into a Blindfold workspace as principals.
 *
 * The function is intentionally sequential — a parallel bulk-insert would race
 * against the email-uniqueness check inside `principals.create` and risk
 * importing duplicates from the source list.
 */
export async function importFromBetterAuth(
  options: BetterAuthImportOptions,
): Promise<BetterAuthImportResult> {
  const {
    auth,
    users,
    resolvePassword,
    actorId = "importer:better-auth",
    skipExisting = false,
  } = options;

  const result: BetterAuthImportResult = {
    imported: 0,
    skipped: 0,
    failed: [],
    principals: [],
  };

  for (const user of users) {
    try {
      // ── Build attributes ─────────────────────────────────────────────────
      // Known metadata fields become typed attributes; unknown extra columns
      // are passed through verbatim.
      const attributes: Record<string, unknown> = {};

      if (user.emailVerified !== undefined) {
        attributes["emailVerified"] = user.emailVerified;
      }
      if (user.image != null) {
        attributes["image"] = user.image;
      }
      if (user.createdAt != null) {
        attributes["originalCreatedAt"] =
          user.createdAt instanceof Date
            ? user.createdAt.toISOString()
            : String(user.createdAt);
      }
      if (user.updatedAt != null) {
        attributes["originalUpdatedAt"] =
          user.updatedAt instanceof Date
            ? user.updatedAt.toISOString()
            : String(user.updatedAt);
      }
      // Pass-through any unknown / plugin-specific columns
      for (const key of Object.keys(user)) {
        if (!KNOWN_FIELDS.has(key)) {
          attributes[key] = user[key];
        }
      }

      // ── Resolve password (plaintext only) ────────────────────────────────
      const resolvedPassword: string | null | undefined = resolvePassword
        ? await resolvePassword(user)
        : undefined;

      // ── Create principal ─────────────────────────────────────────────────
      const principal = await auth.admin.principals.create({
        email: user.email,
        // undefined → Blindfold stores passwordHash:null (no credential)
        // string → Blindfold hashes it with its own bcrypt variant
        password: resolvedPassword ?? undefined,
        displayName: user.name || user.email,
        attributes,
        actorId,
      });

      result.principals.push({
        originalId: user.id,
        principalId: principal.id,
        email: String(principal.email),
      });
      result.imported++;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      if (skipExisting && reason.includes("already exists")) {
        result.skipped++;
      } else {
        result.failed.push({ user, reason });
      }
    }
  }

  return result;
}
