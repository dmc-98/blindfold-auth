import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore - plain JS package
import * as authPkg from "@dmc--98/blindfold-auth";
import { createScimServer, SCIM_VERSION, SCIM_SCHEMAS, ScimEngine, ScimUser, ScimListResponse } from "../src/index.js";

const createAuth = (authPkg as any).createAuth as (opts: any) => any;
const createMemoryStorage = (authPkg as any).createMemoryStorage as () => any;

async function fixture() {
  const auth = createAuth({ workspaceId: "scim_ws", secret: "scim-secret", storage: createMemoryStorage() });
  await auth.admin.bootstrapWorkspace({ name: "SCIM Workspace" });
  const app = await auth.admin.applications.create({ slug: "ent", name: "Enterprise" });
  const role = await auth.admin.roles.create({ applicationId: app.id, name: "members" });
  await auth.admin.roles.grantPermission({ applicationId: app.id, roleId: role.id, resource: "workspace", action: "read" });
  const existing = await auth.admin.principals.create({ email: "founder@acme.co", password: "scim-test-password!", displayName: "Founder" });
  await auth.admin.memberships.assignRole({ principalId: existing.id, applicationId: app.id, roleId: role.id });
  const scim = createScimServer({ auth: auth as unknown as ScimEngine });
  return { auth, scim, app, role, existing };
}

test("SCIM_VERSION + ServiceProviderConfig discovery", async () => {
  assert.equal(SCIM_VERSION, "1.0.0-rc.1");
  const { scim } = await fixture();
  const cfg: any = await scim.handle({ method: "GET", path: "/ServiceProviderConfig" });
  assert.equal(cfg.status, 200);
  assert.deepEqual(cfg.body.schemas, [SCIM_SCHEMAS.serviceProviderConfig]);
  assert.equal(cfg.body.patch.supported, true);
  assert.equal(cfg.body.filter.supported, true);

  const rt: any = await scim.handle({ method: "GET", path: "/ResourceTypes" });
  assert.equal(rt.status, 200);
  const ids = rt.body.map((r: any) => r.id).sort();
  assert.deepEqual(ids, ["Group", "User"]);
});

test("createScimServer rejects an engine missing required surfaces", () => {
  assert.throws(() => createScimServer({ auth: {} as unknown as ScimEngine }), /requires an auth engine/);
});

test("Users: POST creates a principal, GET lists + filters by userName", async () => {
  const { scim } = await fixture();
  const created: any = await scim.handle({
    method: "POST",
    path: "/Users",
    body: { schemas: [SCIM_SCHEMAS.user], userName: "alice@acme.co", displayName: "Alice", active: true }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.userName, "alice@acme.co");
  assert.equal(created.body.active, true);
  assert.ok(created.body.id.startsWith("principal_"));

  const list: any = await scim.handle({ method: "GET", path: "/Users" });
  assert.equal(list.status, 200);
  const body = list.body as ScimListResponse<ScimUser>;
  assert.ok(body.totalResults >= 2, "fixture user + created user");

  const filtered: any = await scim.handle({
    method: "GET", path: "/Users",
    query: { filter: 'userName eq "alice@acme.co"' }
  });
  assert.equal(filtered.body.totalResults, 1);
  assert.equal(filtered.body.Resources[0].userName, "alice@acme.co");
});

test("Users: POST is idempotent on uniqueness (409)", async () => {
  const { scim, existing } = await fixture();
  const conflict: any = await scim.handle({
    method: "POST", path: "/Users",
    body: { userName: existing.email }
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.scimType, "uniqueness");
});

test("Users: GET/{id} 404s for unknown id", async () => {
  const { scim } = await fixture();
  const res: any = await scim.handle({ method: "GET", path: "/Users/principal_unknown" });
  assert.equal(res.status, 404);
});

test("Users: PATCH active=false soft-disables; PATCH active=true re-enables", async () => {
  const { scim, existing } = await fixture();
  const off: any = await scim.handle({
    method: "PATCH", path: `/Users/${existing.id}`,
    body: { schemas: [SCIM_SCHEMAS.patchOp], Operations: [{ op: "replace", path: "active", value: false }] }
  });
  assert.equal(off.status, 200);
  assert.equal(off.body.active, false);

  const on: any = await scim.handle({
    method: "PATCH", path: `/Users/${existing.id}`,
    body: { schemas: [SCIM_SCHEMAS.patchOp], Operations: [{ op: "replace", path: "active", value: true }] }
  });
  assert.equal(on.body.active, true);
});

test("Users: PUT full replace updates displayName and active", async () => {
  const { scim, existing } = await fixture();
  const res: any = await scim.handle({
    method: "PUT", path: `/Users/${existing.id}`,
    body: { userName: existing.email, displayName: "Founder (Updated)", active: true }
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.displayName, "Founder (Updated)");
});

test("Users: DELETE soft-disables and subsequent GET shows active=false", async () => {
  const { scim, existing } = await fixture();
  const del: any = await scim.handle({ method: "DELETE", path: `/Users/${existing.id}` });
  assert.equal(del.status, 204);
  const after: any = await scim.handle({ method: "GET", path: `/Users/${existing.id}` });
  assert.equal(after.status, 200);
  assert.equal(after.body.active, false);
});

test("Groups: mapped from roles, members from memberships", async () => {
  const { scim, role, existing } = await fixture();
  const res: any = await scim.handle({ method: "GET", path: "/Groups" });
  assert.equal(res.status, 200);
  const group = res.body.Resources.find((g: any) => g.id === role.id);
  assert.ok(group, "role surfaces as a Group");
  const member = group.members.find((m: any) => m.value === existing.id);
  assert.ok(member, "founder shows up as group member");
  assert.equal(member.display, existing.email);
});

test("Compliance export (JSON) returns principals, memberships, audit events with counts", async () => {
  const { scim } = await fixture();
  // Provision two users via SCIM to grow the audit trail.
  await scim.handle({ method: "POST", path: "/Users", body: { userName: "a@x.co" } });
  await scim.handle({ method: "POST", path: "/Users", body: { userName: "b@x.co" } });

  const out = await scim.compliance.export();
  assert.equal(out.format, "json");
  assert.ok(out.data, "data payload populated for JSON");
  assert.ok(out.counts.principals >= 3);
  assert.ok(out.counts.auditEvents > 0);
  assert.ok(out.data!.principals.every((p) => p.id && p.email));
});

test("Compliance export (NDJSON) emits newline-delimited records", async () => {
  const { scim } = await fixture();
  const out = await scim.compliance.export({ format: "ndjson" });
  assert.equal(out.format, "ndjson");
  assert.ok(out.ndjson, "ndjson populated");
  const lines = out.ndjson!.split("\n");
  assert.ok(lines.length >= out.counts.principals);
  for (const line of lines) {
    const parsed = JSON.parse(line);
    assert.ok(["principal", "membership", "audit_event"].includes(parsed.kind), `unexpected kind ${parsed.kind}`);
    assert.ok(parsed.record);
  }
});

test("Schemas: GET /Schemas returns ListResponse with User and Group schema definitions", async () => {
  const { scim } = await fixture();
  const res: any = await scim.handle({ method: "GET", path: "/Schemas" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.schemas, [SCIM_SCHEMAS.listResponse]);
  assert.ok(res.body.totalResults >= 2, "at least User + Group schemas");
  const ids: string[] = res.body.Resources.map((s: any) => s.id);
  assert.ok(ids.includes(SCIM_SCHEMAS.user), "User schema present");
  assert.ok(ids.includes(SCIM_SCHEMAS.group), "Group schema present");
  const userSchema = res.body.Resources.find((s: any) => s.id === SCIM_SCHEMAS.user);
  assert.ok(userSchema, "User schema found");
  assert.ok(Array.isArray(userSchema.attributes), "User schema has attributes array");
  assert.ok(userSchema.attributes.some((a: any) => a.name === "userName"), "userName attribute present");
});

test("Groups: GET /Groups/{id} returns a single group by role id", async () => {
  const { scim, role } = await fixture();
  const res: any = await scim.handle({ method: "GET", path: `/Groups/${role.id}` });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.schemas, [SCIM_SCHEMAS.group]);
  assert.equal(res.body.id, role.id);
  assert.ok(typeof res.body.displayName === "string", "displayName is a string");
  assert.ok(Array.isArray(res.body.members), "members is an array");
});

test("Groups: GET /Groups/{id} returns 404 for unknown group", async () => {
  const { scim } = await fixture();
  const res: any = await scim.handle({ method: "GET", path: "/Groups/role_does_not_exist" });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body.schemas, [SCIM_SCHEMAS.error]);
});

test("Unknown endpoint returns 404 with SCIM error envelope", async () => {
  const { scim } = await fixture();
  const res: any = await scim.handle({ method: "GET", path: "/Things" });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body.schemas, [SCIM_SCHEMAS.error]);
});
