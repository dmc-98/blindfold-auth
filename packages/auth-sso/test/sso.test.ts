import test from "node:test";
import assert from "node:assert/strict";
// @ts-ignore -- @dmc--98/blindfold-auth is plain JS; the inferred types are too narrow.
import * as authPkg from "@dmc--98/blindfold-auth";
const createAuth = (authPkg as any).createAuth as (opts: any) => any;
const createMemoryStorage = (authPkg as any).createMemoryStorage as () => any;
import { createSso, SSO_VERSION, SsoEngine } from "../src/index.js";

async function fixture() {
  const auth = createAuth({
    workspaceId: "workspace_sso_test",
    secret: "sso-test-secret",
    storage: createMemoryStorage()
  });
  await auth.admin.bootstrapWorkspace({ name: "SSO Workspace" });
  const application = await auth.admin.applications.create({ slug: "ent-app", name: "Enterprise App" });
  const role = await auth.admin.roles.create({ applicationId: application.id, name: "member" });
  await auth.admin.roles.grantPermission({ applicationId: application.id, roleId: role.id, resource: "workspace", action: "read" });
  const sso = createSso({ auth: auth as unknown as SsoEngine });
  return { auth, application, role, sso };
}

test("exposes a frozen v1 version", () => {
  assert.equal(SSO_VERSION, "1.0.0-rc.1");
  const sso = createSso({
    auth: { admin: { identityProviders: {}, applicationProviders: {} }, handlers: { oidc: {}, saml: {} } } as unknown as SsoEngine
  });
  assert.equal(sso.version, "1.0.0-rc.1");
});

test("createSso rejects an engine missing required surfaces", () => {
  assert.throws(() => createSso({ auth: {} as unknown as SsoEngine }), /requires an auth engine/);
});

test("providers.add + providers.list (OIDC)", async () => {
  const { sso } = await fixture();
  const before = await sso.providers.list();
  assert.equal(before.length, 0);

  const provider = await sso.providers.add({
    type: "oidc",
    key: "okta",
    name: "Okta",
    mode: "demo",
    issuer: "https://okta.example.com",
    authorizationUrl: "https://okta.example.com/authorize",
    clientId: "demo-client"
  });
  assert.equal(provider.type, "oidc");
  assert.equal(provider.key, "okta");

  const after = await sso.providers.list();
  assert.equal(after.length, 1);
  assert.equal(after[0]!.id, provider.id);
});

test("bindings.add binds an application to a provider", async () => {
  const { sso, application, role } = await fixture();
  const provider = await sso.providers.add({
    type: "oidc", key: "okta", name: "Okta", mode: "demo",
    issuer: "https://okta.example.com", authorizationUrl: "https://okta.example.com/authorize", clientId: "demo-client"
  });
  const binding = await sso.bindings.add({
    applicationId: application.id,
    providerId: provider.id,
    domains: ["okta.example.com"],
    defaultRoleIds: [role.id]
  });
  assert.equal(binding.applicationId, application.id);
  assert.deepEqual(binding.domains, ["okta.example.com"]);
  const list = await sso.bindings.list({ applicationId: application.id });
  assert.equal(list.length, 1);
});

test("end-to-end OIDC: start → complete returns a real session", async () => {
  const { sso, application, role } = await fixture();
  const provider = await sso.providers.add({
    type: "oidc", key: "okta", name: "Okta", mode: "demo",
    issuer: "https://okta.example.com", authorizationUrl: "https://okta.example.com/authorize", clientId: "demo-client"
  });
  await sso.bindings.add({
    applicationId: application.id, providerId: provider.id,
    domains: ["okta.example.com"], defaultRoleIds: [role.id]
  });

  const request = { headers: { host: "localhost:4110", origin: "http://localhost:4110" } };
  const start = await sso.login.start({
    protocol: "oidc",
    applicationId: application.id,
    email: "jordan@okta.example.com",
    request
  });
  assert.ok(start.redirectTo?.includes("state="), "redirect URL includes state");
  assert.equal(start.provider!.id, provider.id);
  assert.ok(start.demoCallback, "demo mode surfaces a synthetic callback payload");

  const completed = await sso.login.complete({
    protocol: "oidc",
    payload: start.demoCallback!,
    request
  });
  assert.equal(completed.session.applicationId, application.id);
  assert.equal(completed.session.authStrength, "oidc");
  assert.ok(completed.accessToken, "session issues an access token");
});

test("login.start with no matching provider hint surfaces a typed error", async () => {
  const { sso, application } = await fixture();
  await assert.rejects(
    () => sso.login.start({ protocol: "oidc", applicationId: application.id, email: "nobody@unknown.test" }),
    /provider/i
  );
});
