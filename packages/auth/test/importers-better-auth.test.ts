/**
 * importFromBetterAuth — TDD test suite
 *
 * Tests the Better Auth → Blindfold user migration helper.
 * Uses an in-memory Blindfold instance; no external services required.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../src/auth.js";
import {
  importFromBetterAuth,
} from "../src/importers/better-auth.js";
import type { BetterAuthUser, BetterAuthImportOptions } from "../src/importers/better-auth.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_SECRET = "test-secret-32-chars-for-import-suite";

async function makeAuth() {
  const auth = createAuth({ secret: TEST_SECRET });
  await auth.admin.bootstrapWorkspace({ name: "Import Test Workspace" });
  return auth;
}

function makeUser(overrides: Partial<BetterAuthUser> = {}): BetterAuthUser {
  return {
    id: "ba_user_001",
    name: "Alice Liddell",
    email: "alice@wonderland.example",
    emailVerified: true,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("importFromBetterAuth", () => {
  test("imports a single user and returns correct counts", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser()],
    });

    assert.equal(result.imported, 1, "imported count");
    assert.equal(result.skipped, 0, "skipped count");
    assert.equal(result.failed.length, 0, "failed count");
    assert.equal(result.principals.length, 1, "principals mapping length");
  });

  test("maps original Better Auth id to a Blindfold principal id", async () => {
    const auth = await makeAuth();
    const user = makeUser({ id: "ba_user_xyz" });
    const result = await importFromBetterAuth({ auth, users: [user] });

    const mapping = result.principals[0];
    assert.ok(mapping, "principal mapping exists");
    assert.equal(mapping.originalId, "ba_user_xyz");
    assert.ok(
      mapping.principalId.startsWith("principal_"),
      `expected Blindfold id prefix, got: ${mapping.principalId}`,
    );
    assert.equal(mapping.email, "alice@wonderland.example");
  });

  test("maps Better Auth `name` to Blindfold displayName", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser({ name: "Queen of Hearts" })],
    });

    // Fetch the created principal from storage to verify displayName
    const principalId = result.principals[0]?.principalId;
    assert.ok(principalId, "principalId should exist");
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.equal(principal?.displayName, "Queen of Hearts");
  });

  test("falls back to email as displayName when name is empty", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser({ name: "", email: "noname@example.com" })],
    });

    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.equal(principal?.displayName, "noname@example.com");
  });

  test("imports emailVerified into attributes", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser({ emailVerified: true })],
    });

    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.equal(principal?.attributes?.emailVerified, true);
  });

  test("imports image into attributes when provided", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser({ image: "https://cdn.example.com/avatar.jpg" })],
    });

    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.equal(principal?.attributes?.image, "https://cdn.example.com/avatar.jpg");
  });

  test("does NOT add image attribute when image is null", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser({ image: null })],
    });

    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.equal(
      Object.prototype.hasOwnProperty.call(principal?.attributes ?? {}, "image"),
      false,
    );
  });

  test("stores originalCreatedAt from Date in attributes", async () => {
    const auth = await makeAuth();
    const createdAt = new Date("2024-01-15T10:00:00Z");
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser({ createdAt })],
    });

    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.equal(principal?.attributes?.originalCreatedAt, "2024-01-15T10:00:00.000Z");
  });

  test("stores originalCreatedAt from ISO string in attributes", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser({ createdAt: "2024-03-20T08:30:00Z" })],
    });

    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.equal(principal?.attributes?.originalCreatedAt, "2024-03-20T08:30:00Z");
  });

  test("passes unknown extra columns through as attributes", async () => {
    const auth = await makeAuth();
    const user: BetterAuthUser = {
      ...makeUser(),
      plan: "pro",
      teamId: "team_42",
    };
    const result = await importFromBetterAuth({ auth, users: [user] });

    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.equal(principal?.attributes?.plan, "pro");
    assert.equal(principal?.attributes?.teamId, "team_42");
  });

  test("imports without a password by default (passwordHash is null)", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser()],
    });

    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.equal(principal?.passwordHash, null, "passwordHash should be null when no password");
  });

  test("resolvePassword callback sets a hashed credential when it returns a string", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser()],
      resolvePassword: () => "Migration-Temp-Pass-9!",
    });

    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    // Blindfold hashes with bcrypt — check it's non-null and non-plaintext
    assert.ok(principal?.passwordHash, "passwordHash should be set");
    assert.notEqual(principal?.passwordHash, "Migration-Temp-Pass-9!", "hash must differ from plaintext");
  });

  test("resolvePassword returning null leaves passwordHash as null", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser()],
      resolvePassword: () => null,
    });

    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.equal(principal?.passwordHash, null);
  });

  test("resolvePassword can be async", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({
      auth,
      users: [makeUser()],
      resolvePassword: async (user) => {
        // Simulates an async lookup (e.g. external vault)
        await Promise.resolve();
        return `temp-for-${user.id}-9!X`;
      },
    });

    assert.equal(result.imported, 1);
    assert.equal(result.failed.length, 0);
    const principalId = result.principals[0]?.principalId;
    const principal = await (auth as any).storage.get("principals", principalId);
    assert.ok(principal?.passwordHash, "passwordHash should be set from async callback");
  });

  test("imports multiple users in sequence, all mapped", async () => {
    const auth = await makeAuth();
    const users = [
      makeUser({ id: "ba_u1", email: "user1@example.com", name: "User One" }),
      makeUser({ id: "ba_u2", email: "user2@example.com", name: "User Two" }),
      makeUser({ id: "ba_u3", email: "user3@example.com", name: "User Three" }),
    ];

    const result = await importFromBetterAuth({ auth, users });

    assert.equal(result.imported, 3);
    assert.equal(result.principals.length, 3);
    const originalIds = result.principals.map((p) => p.originalId);
    assert.deepEqual(originalIds, ["ba_u1", "ba_u2", "ba_u3"]);
  });

  test("empty user list imports zero users without error", async () => {
    const auth = await makeAuth();
    const result = await importFromBetterAuth({ auth, users: [] });
    assert.equal(result.imported, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed.length, 0);
    assert.equal(result.principals.length, 0);
  });

  test("duplicate email goes to failed[] by default (skipExisting: false)", async () => {
    const auth = await makeAuth();
    const user = makeUser();
    // First import succeeds
    await importFromBetterAuth({ auth, users: [user] });

    // Second import with same email (different BA id but same email)
    const duplicate: BetterAuthUser = { ...user, id: "ba_user_dup" };
    const result = await importFromBetterAuth({ auth, users: [duplicate] });

    assert.equal(result.imported, 0);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed.length, 1);
    assert.ok(
      result.failed[0]?.reason.includes("already exists"),
      `reason: ${result.failed[0]?.reason}`,
    );
  });

  test("duplicate email is skipped (not failed) when skipExisting: true", async () => {
    const auth = await makeAuth();
    const user = makeUser();
    // First import
    await importFromBetterAuth({ auth, users: [user] });

    // Second import with skipExisting
    const duplicate: BetterAuthUser = { ...user, id: "ba_user_dup" };
    const result = await importFromBetterAuth({
      auth,
      users: [duplicate],
      skipExisting: true,
    });

    assert.equal(result.imported, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.failed.length, 0);
  });

  test("skipExisting: true still imports non-duplicate users in the same batch", async () => {
    const auth = await makeAuth();
    const existing = makeUser({ id: "ba_existing", email: "existing@example.com" });
    await importFromBetterAuth({ auth, users: [existing] });

    const users = [
      { ...existing, id: "ba_existing_dup" },                           // duplicate → skip
      makeUser({ id: "ba_new", email: "new@example.com", name: "New" }), // fresh
    ];
    const result = await importFromBetterAuth({ auth, users, skipExisting: true });

    assert.equal(result.imported, 1, "one new user imported");
    assert.equal(result.skipped, 1, "one duplicate skipped");
    assert.equal(result.failed.length, 0);
  });

  test("user with no email goes to failed[] with a meaningful error", async () => {
    const auth = await makeAuth();
    const badUser = { id: "ba_bad", name: "No Email", email: "" };
    const result = await importFromBetterAuth({ auth, users: [badUser] });

    assert.equal(result.imported, 0);
    assert.equal(result.failed.length, 1);
    assert.ok(result.failed[0]?.reason.length > 0, "reason should be non-empty");
  });

  test("actorId is forwarded to audit events", async () => {
    const auth = await makeAuth();
    await importFromBetterAuth({
      auth,
      users: [makeUser()],
      actorId: "migration-script-v2",
    });

    const events = await auth.admin.audit.list({ limit: 10 });
    const created = events.find(
      (e: any) => e.type === "principal.created" && e.actorId === "migration-script-v2",
    );
    assert.ok(created, "audit event should carry the custom actorId");
  });
});
