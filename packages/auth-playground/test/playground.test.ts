import { test } from "node:test";
import assert from "node:assert";
import { createSandbox, createPlaygroundServer } from "../src/index.js";

test("sandbox seeds the RBAC/ABAC scenario", async () => {
  const sb = await createSandbox();
  const state = await sb.getState();
  assert.equal(state.users.length, 2);
  assert.ok(state.roles.find((r: any) => r.name === "admin"));
  assert.ok(state.roles.find((r: any) => r.name === "support"));
  assert.ok(state.policies.find((p: any) => p.field === "ssn" && p.effect === "mask"));
});

test("login works for a seeded user", async () => {
  const sb = await createSandbox();
  const r = await sb.login({ email: "bob@demo", password: sb.DEMO_PASSWORD });
  assert.equal(r.status, 200);
  assert.ok(r.accessToken);
});

test("RBAC: admin allowed everything, support limited", async () => {
  const sb = await createSandbox();
  const adminRead = await sb.evaluate({ email: "alice@demo", action: "read", resource: "customer" });
  assert.equal(adminRead.allowed, true);

  const supportRead = await sb.evaluate({ email: "bob@demo", action: "read", resource: "customer" });
  assert.equal(supportRead.allowed, true);

  const supportDelete = await sb.evaluate({ email: "bob@demo", action: "delete", resource: "customer" });
  assert.equal(supportDelete.allowed, false);
});

test("ABAC field masking: support reading customer.ssn is masked", async () => {
  const sb = await createSandbox();
  const decision = await sb.evaluate({
    email: "bob@demo",
    action: "read",
    resource: "customer",
    field: "ssn"
  });
  // Allowed to read, but the field carries a mask effect / obligation.
  const masked =
    decision.effect === "mask" || (decision.obligations?.maskedFields || []).includes("ssn");
  assert.ok(masked, `expected ssn to be masked, got ${JSON.stringify(decision)}`);
});

test("live authoring: adding a role + policy changes decisions", async () => {
  const sb = await createSandbox();
  await sb.addRole({ name: "auditor", permissions: [{ resource: "ledger", action: "read" }] });
  await sb.addUser({ email: "carol@demo", password: "pw-123456", roles: ["auditor"] });

  const before = await sb.evaluate({ email: "carol@demo", action: "read", resource: "ledger" });
  assert.equal(before.allowed, true);

  const denied = await sb.evaluate({ email: "carol@demo", action: "write", resource: "ledger" });
  assert.equal(denied.allowed, false);
});

test("snippet generator returns framework code", async () => {
  const sb = await createSandbox();
  const s = sb.snippet({ framework: "express", storage: "sqlite" });
  assert.match(s.code, /@dmc--98\/blindfold-client/);
  assert.ok(Array.isArray(s.frameworks));
});

test("HTTP server serves the UI and the JSON API end-to-end", async () => {
  const pg = await createPlaygroundServer({ storage: "memory" });
  const { url } = await pg.listen(0); // ephemeral port
  try {
    const html = await fetch(url + "/").then((r) => r.text());
    assert.match(html, /Blindfold Auth — Playground/);

    const state: any = await fetch(url + "/api/state").then((r) => r.json());
    assert.equal(state.users.length, 2);

    const decision: any = await fetch(url + "/api/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "bob@demo", action: "delete", resource: "customer" })
    }).then((r) => r.json());
    assert.equal(decision.allowed, false);

    const login: any = await fetch(url + "/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@demo", password: "playground-123" })
    }).then((r) => r.json());
    assert.equal(login.status, 200);
  } finally {
    await pg.close();
  }
});
