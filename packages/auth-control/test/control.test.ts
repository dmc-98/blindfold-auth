import { test } from "node:test";
import assert from "node:assert";
import { createControlPlane, createMemoryStore } from "../src/index.js";

function cp() {
  return createControlPlane({ store: createMemoryStore() });
}

test("projects: create, slug, list, get, getBySlug, duplicate guard", () => {
  const c = cp();
  const p = c.projects.create({ name: "Billing API", storage: "postgres" });
  assert.equal(p.slug, "billing-api");
  assert.equal(p.storage, "postgres");
  assert.ok(p.workspaceId);
  assert.equal(c.projects.list().length, 1);
  assert.equal(c.projects.get(p.id)!.id, p.id);
  assert.equal(c.projects.getBySlug("billing-api")!.id, p.id);
  assert.throws(() => c.projects.create({ name: "Billing API" }), /already exists/);
});

test("keys: issue returns token once, verify works, hash never leaked", () => {
  const c = cp();
  const p = c.projects.create({ name: "App", storage: "memory" });
  const issued = c.keys.issue({ projectId: p.id, env: "live" });
  assert.match(issued.token, /^bf_live_[0-9a-f]{48}$/);

  const verified = c.keys.verify(issued.token);
  assert.equal(verified!.projectId, p.id);
  assert.equal(verified!.keyId, issued.id);

  assert.equal(c.keys.verify("bf_live_wrong"), null);

  const listed = c.keys.list({ projectId: p.id });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].hash, undefined, "hash must never be returned");
  assert.ok(listed[0].prefix.startsWith("bf_live_"));
});

test("keys: revoke invalidates verification", () => {
  const c = cp();
  const p = c.projects.create({ name: "App" });
  const issued = c.keys.issue({ projectId: p.id });
  assert.ok(c.keys.verify(issued.token));
  c.keys.revoke(issued.id);
  assert.equal(c.keys.verify(issued.token), null, "revoked key no longer verifies");
});

test("keys: issuing for an unknown project throws", () => {
  const c = cp();
  assert.throws(() => c.keys.issue({ projectId: "proj_nope" }), /Unknown project/);
});

test("removing a project cascades its keys", () => {
  const c = cp();
  const p = c.projects.create({ name: "App" });
  const issued = c.keys.issue({ projectId: p.id });
  c.projects.remove(p.id);
  assert.equal(c.projects.get(p.id), null);
  assert.equal(c.keys.verify(issued.token), null);
});

test("file store persists across control-plane instances", async () => {
  const { createFileStore } = await import("../src/index.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const file = join(mkdtempSync(join(tmpdir(), "bf-control-")), "control.json");

  const c1 = createControlPlane({ store: createFileStore(file) });
  const p = c1.projects.create({ name: "Persisted" });
  c1.keys.issue({ projectId: p.id });

  const c2 = createControlPlane({ store: createFileStore(file) });
  assert.equal(c2.projects.list().length, 1);
  assert.equal(c2.keys.list().length, 1);
});
