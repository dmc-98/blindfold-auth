import assert from "node:assert/strict";
import test from "node:test";
import { createAuth, createMemoryStorage } from "@blindfold/auth";
import { startStudio } from "../src/index.js";

test("Studio exposes workspace snapshot and validated admin endpoints", async (t) => {
  const auth = createAuth({
    workspaceId: "workspace_studio_test",
    secret: "studio-secret",
    storage: createMemoryStorage()
  });

  let started: any;
  try {
    started = await startStudio({ auth, port: 0 });
  } catch (error) {
    if ((error as any)?.code === "EPERM" || (error as any)?.code === "EACCES") {
      t.skip(`Studio socket binding is blocked in this environment: ${(error as any).code}`);
      return;
    }

    throw error;
  }

  const { server, url } = started;

  try {
    let response = await fetch(`${url}/api/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Studio Test Workspace" })
    });
    assert.equal(response.status, 200);

    response = await fetch(`${url}/api/applications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: "studio-app", name: "Studio App" })
    });
    const application: any = await response.json();
    assert.equal(application.slug, "studio-app");

    response = await fetch(`${url}/api/identity-providers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: "studio-okta",
        name: "Studio Okta",
        type: "oidc",
        issuer: "https://studio.okta.example.com/oauth2/default",
        authorizationUrl: "https://studio.okta.example.com/oauth2/v1/authorize",
        clientId: "studio-client-id"
      })
    });
    const provider: any = await response.json();
    assert.equal(provider.key, "studio-okta");

    response = await fetch(`${url}/api/roles`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        applicationId: application.id,
        name: "studio_reader"
      })
    });
    const role: any = await response.json();

    response = await fetch(`${url}/api/application-providers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        applicationId: application.id,
        providerId: provider.id,
        domains: ["studio.example.com"],
        defaultRoleIds: [role.id]
      })
    });
    const binding: any = await response.json();
    assert.equal(binding.providerId, provider.id);

    response = await fetch(`${url}/api/workspace`);
    const snapshot: any = await response.json();
    assert.equal(snapshot.workspace.name, "Studio Test Workspace");
    assert.equal(snapshot.snapshot.applications.length, 1);
    assert.equal(snapshot.snapshot.identity_providers.length, 1);
    assert.equal(snapshot.snapshot.application_identity_providers.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error: any) => (error ? reject(error) : resolve()));
    });
  }
});
