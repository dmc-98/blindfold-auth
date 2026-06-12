import { test } from "node:test";
import assert from "node:assert";
import { createAuth, TABLES } from "@dmc--98/blindfold-auth";

/**
 * Storage adapter conformance kit (M4 — universal storage).
 *
 * Any SQL or NoSQL adapter that implements the 5-method contract
 * (ensureTables / list / get / put / delete) can prove it behaves identically
 * to the reference adapters by running this suite:
 *
 *   import { runStorageConformance } from "@dmc--98/blindfold-testing/conformance";
 *   runStorageConformance({
 *     name: "sqlite",
 *     createStorage: () => createSqliteStorage({ filePath: ":memory:" }),
 *   });
 *
 * It checks (a) the low-level method contract and (b) the nine-step auth smoke
 * sequence end-to-end through createAuth() over the adapter.
 *
 * @param {object} opts
 * @param {string} opts.name - label for the backend (e.g. "sqlite", "mongo")
 * @param {() => (object|Promise<object>)} opts.createStorage - fresh adapter per call
 */
export function runStorageConformance({ name, createStorage }: { name: string; createStorage: () => any }): void {
  if (!name || typeof createStorage !== "function") {
    throw new Error("runStorageConformance requires { name, createStorage }");
  }

  test(`[${name}] implements the 5-method storage contract`, async () => {
    const storage = await createStorage();
    for (const method of ["ensureTables", "list", "get", "put", "delete"]) {
      assert.equal(typeof storage[method], "function", `missing ${method}()`);
    }
  });

  test(`[${name}] put/get/list/delete semantics`, async () => {
    const storage = await createStorage();
    await storage.ensureTables(TABLES);
    const table = "principals";

    // missing record -> null; missing list -> []
    assert.equal(await storage.get(table, "nope"), null);
    assert.deepEqual(await storage.list(table, { email: "x" }), []);

    // put returns the stored record, preserving shape
    const rec = { id: "p1", email: "a@x.com", attributes: { tier: "gold" }, createdAt: "t", updatedAt: "t" };
    const stored = await storage.put(table, rec);
    assert.equal(stored.id, "p1");
    assert.equal(stored.email, "a@x.com");
    assert.deepEqual(stored.attributes, { tier: "gold" }, "nested objects preserved");

    // get round-trips the exact shape
    const got = await storage.get(table, "p1");
    assert.deepEqual(got, rec);

    // put replaces by id
    await storage.put(table, { ...rec, email: "b@x.com" });
    assert.equal((await storage.get(table, "p1")).email, "b@x.com");

    // exact-match filter
    await storage.put(table, { id: "p2", email: "c@x.com" });
    const byEmail = await storage.list(table, { email: "b@x.com" });
    assert.equal(byEmail.length, 1);
    assert.equal(byEmail[0].id, "p1");
    assert.equal((await storage.list(table, {})).length, 2, "empty filter lists all");

    // delete is safe on missing and removes present
    await storage.delete(table, "missing");
    await storage.delete(table, "p1");
    assert.equal(await storage.get(table, "p1"), null);
    assert.equal((await storage.list(table, {})).length, 1);
  });

  test(`[${name}] does not leak references between reads`, async () => {
    const storage = await createStorage();
    await storage.ensureTables(TABLES);
    await storage.put("roles", { id: "r1", name: "admin", meta: { a: 1 } });
    const first = await storage.get("roles", "r1");
    first.meta.a = 999;
    const second = await storage.get("roles", "r1");
    assert.equal(second.meta.a, 1, "reads must return independent copies");
  });

  test(`[${name}] nine-step auth smoke sequence through createAuth()`, async () => {
    const storage = await createStorage();
    const auth = createAuth({ workspaceId: "ws_conformance", secret: "conformance-secret", storage });

    // 1. bootstrap workspace
    await auth.admin.bootstrapWorkspace({ name: "Conformance WS" });
    // 2. create app
    const app = await auth.admin.applications.create({ slug: "app", name: "App" });
    // 3. create principal
    const principal = await auth.admin.principals.create({
      email: "user@x.com",
      password: "pw-123456",
      displayName: "User"
    });
    // 4. role + permission + membership
    const role = await auth.admin.roles.create({ applicationId: app.id, name: "reader" });
    await auth.admin.roles.grantPermission({
      applicationId: app.id,
      roleId: role.id,
      resource: "doc",
      action: "read"
    });
    await auth.admin.memberships.assignRole({
      principalId: principal.id,
      applicationId: app.id,
      roleId: role.id
    });

    // 5. login
    const loginRes = await auth.handlers.login()({
      body: { applicationId: app.id, email: "user@x.com", password: "pw-123456" }
    });
    assert.equal(loginRes.statusCode, 200, "login succeeds");
    const tokens = JSON.parse(loginRes.body);
    assert.ok(tokens.accessToken);

    // 6. protected route allow
    const protectedHandler = auth.protect(
      { applicationId: app.id, resource: "doc", action: "read" },
      async (ctx: any) => ({ statusCode: 200, body: { who: ctx.subject.id } })
    );
    const allowed = await protectedHandler({ headers: { authorization: `Bearer ${tokens.accessToken}` } });
    assert.equal(allowed.statusCode, 200, "authorized access allowed");

    // 7. protected route deny (no token)
    const denied = await protectedHandler({ headers: {} });
    assert.equal(denied.statusCode, 401, "missing token denied");

    // 8. refresh, then revoke
    const refreshed = await auth.session.refresh({ refreshToken: tokens.refreshToken });
    assert.ok(refreshed.accessToken, "refresh issues a new access token");
    await auth.session.revoke({ refreshToken: refreshed.refreshToken, reason: "test" });

    // 9. audit events recorded
    const events = await auth.admin.audit.list({ limit: 50 });
    assert.ok(events.length > 0, "audit events were written");
  });
}
