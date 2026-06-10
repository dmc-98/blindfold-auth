import { test } from "node:test";
import assert from "node:assert";
import { createTestAuth } from "../src/index.js";

test("createTestAuth seeds users + roles and supports login", async () => {
  const t = await createTestAuth({
    app: { slug: "billing", name: "Billing" },
    roles: [{ name: "operator", permissions: [{ resource: "invoice", action: "read" }] }],
    users: [{ email: "admin@x.com", password: "pw-123456", roles: ["operator"] }]
  });

  const login = await t.login("admin@x.com", "pw-123456");
  assert.ok(login.accessToken, "login yields an access token");
});

test("assertCan / assertCannot reflect RBAC permissions", async () => {
  const t = await createTestAuth({
    roles: [{ name: "reader", permissions: [{ resource: "doc", action: "read" }] }],
    users: [{ email: "r@x.com", password: "pw-123456", roles: ["reader"] }]
  });

  await t.assertCan("r@x.com", "read", "doc");
  await t.assertCannot("r@x.com", "write", "doc");

  await assert.rejects(() => t.assertCan("r@x.com", "write", "doc"), /Expected/);
});

test("mintSession issues a session without a password round-trip", async () => {
  const t = await createTestAuth({
    users: [{ email: "u@x.com", password: "pw-123456" }]
  });
  const session = await t.mintSession("u@x.com");
  assert.ok(session.accessToken || session.session, "mintSession returns session material");
});

test("unknown role reference is rejected loudly", async () => {
  await assert.rejects(
    () =>
      createTestAuth({
        users: [{ email: "u@x.com", password: "pw", roles: ["ghost"] }]
      }),
    /unknown role "ghost"/
  );
});
