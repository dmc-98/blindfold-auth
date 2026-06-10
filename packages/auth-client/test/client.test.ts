import { test } from "node:test";
import assert from "node:assert";
import { blindfold, resolveStorage } from "../src/index.js";
import { blindfoldExpress, guard } from "../src/express.js";

test("blindfold() requires a secret", async () => {
  await assert.rejects(() => blindfold({ project: "x" }), /requires a secret/);
});

test("blindfold() boots with memory storage and exposes the engine", async () => {
  const client = await blindfold({ project: "p", secret: "s" });
  assert.equal(typeof client.auth, "object");
  assert.equal(typeof client.can, "function");
  assert.equal(typeof client.protect, "function");
  assert.equal(typeof client.handlers.login, "function");
});

test("resolveStorage: aliases, custom adapters, and planned errors", async () => {
  const mem = await resolveStorage("memory");
  assert.equal(typeof mem.put, "function");

  const custom: any = {
    ensureTables() {},
    list() {},
    get() {},
    put() {},
    delete() {}
  };
  assert.equal(await resolveStorage(custom), custom);

  await assert.rejects(() => resolveStorage("file"), /requires options.storageOptions.filePath/);
  await assert.rejects(() => resolveStorage("mysql"), /M4 — universal storage/);
  await assert.rejects(() => resolveStorage("nonsense"), /Unknown storage/);

  // sqlite now ships and resolves to a working adapter
  const sqlite = await resolveStorage("sqlite", { filePath: ":memory:" });
  assert.equal(typeof sqlite.put, "function");
});

test("setup() seeds workspace, app, admin, and roles; login + protect end-to-end", async () => {
  const client = await blindfold({ project: "billing-app", secret: "s" });
  const { application, principal } = await client.setup({
    workspaceName: "Billing WS",
    app: { slug: "billing", name: "Billing" },
    admin: { email: "admin@x.com", password: "pw-123456" },
    roles: [
      {
        name: "operator",
        assignToAdmin: true,
        permissions: [{ resource: "invoice", action: "read" }]
      }
    ]
  });
  assert.ok(application.id);
  assert.ok(principal.id);

  // login via prebuilt handler
  const loginRes = await client.handlers.login()({
    body: { applicationId: application.id, email: "admin@x.com", password: "pw-123456" }
  });
  assert.equal(loginRes.statusCode, 200);
  const tokens = JSON.parse(loginRes.body);
  assert.ok(tokens.accessToken, "login returns an access token");

  // RBAC decision: allowed read, denied delete
  const allow = await client.can({
    principalId: principal.id,
    applicationId: application.id,
    action: "read",
    resource: "invoice"
  });
  assert.equal(allow.allowed, true);

  const deny = await client.can({
    principalId: principal.id,
    applicationId: application.id,
    action: "delete",
    resource: "invoice"
  });
  assert.equal(deny.allowed, false);

  // protect(): bearer token gates the handler
  const protectedHandler = client.protect(
    { applicationId: application.id, resource: "invoice", action: "read" },
    async (ctx: any) => ({ statusCode: 200, body: { who: ctx.subject.id } })
  );
  const ok = await protectedHandler({
    headers: { authorization: `Bearer ${tokens.accessToken}` }
  });
  assert.equal(ok.statusCode, 200);

  const missing = await protectedHandler({ headers: {} });
  assert.equal(missing.statusCode, 401);
});

test("Express adapter: mounts /auth routes and guard middleware attaches req.auth", async () => {
  const client = await blindfold({ project: "exp", secret: "s" });
  const { application } = await client.setup({
    app: { slug: "app", name: "App" },
    admin: { email: "u@x.com", password: "pw-123456" },
    roles: [{ name: "member", assignToAdmin: true, permissions: [{ resource: "doc", action: "read" }] }]
  });

  // Mount routes onto the built-in test router (no Express dependency needed).
  const router = blindfoldExpress(client, { prefix: "/auth" });
  const loginResult = await router.dispatch("POST", "/auth/login", {
    headers: {},
    body: { applicationId: application.id, email: "u@x.com", password: "pw-123456" }
  });
  assert.equal(loginResult.statusCode, 200);
  const tokens = typeof loginResult.body === "string" ? JSON.parse(loginResult.body) : loginResult.body;
  assert.ok(tokens.accessToken);

  // guard middleware: simulate Express req/res/next.
  const mw = guard(client, { applicationId: application.id, resource: "doc", action: "read" });
  let nextCalled = false;
  const req: any = { headers: { authorization: `Bearer ${tokens.accessToken}` } };
  const res = makeRes();
  await mw(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true, "guard calls next() on success");
  assert.ok(req.auth?.subject?.id, "guard attaches req.auth.subject");

  // unauthorized request short-circuits with 401
  const res2 = makeRes();
  let next2 = false;
  await mw({ headers: {} }, res2, () => {
    next2 = true;
  });
  assert.equal(next2, false);
  assert.equal(res2._status, 401);
});

function makeRes(): any {
  return {
    _status: 200,
    _headers: {} as Record<string, any>,
    getHeader(this: any, k: string) {
      return this._headers[k.toLowerCase()];
    },
    setHeader(this: any, k: string, v: any) {
      this._headers[k.toLowerCase()] = v;
    },
    status(this: any, c: number) {
      this._status = c;
      return this;
    },
    json(this: any, o: any) {
      this._body = o;
      return this;
    },
    send(this: any, s: any) {
      this._body = s;
      return this;
    },
    end(this: any) {
      return this;
    }
  };
}
