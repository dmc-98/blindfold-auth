import assert from "node:assert/strict";
import test from "node:test";
import { createAuth, createMemoryStorage } from "../src/index.js";

async function createFederationFixture({ mode = "demo" }: { mode?: string } = {}) {
  const auth = createAuth({
    workspaceId: "workspace_federation_test",
    secret: "federation-secret",
    storage: createMemoryStorage()
  });

  await auth.admin.bootstrapWorkspace({ name: "Federation Workspace" });
  const application = await auth.admin.applications.create({
    slug: "enterprise-app",
    name: "Enterprise App"
  });
  const enterpriseRole = await auth.admin.roles.create({
    applicationId: application.id,
    name: "enterprise_member"
  });
  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: enterpriseRole.id,
    resource: "workspace",
    action: "read"
  });

  const oidcProvider = await auth.admin.identityProviders.create({
    key: "okta-enterprise",
    name: "Okta Enterprise",
    type: "oidc",
    mode,
    issuer: "https://blindfold.okta.example.com/oauth2/default",
    authorizationUrl: "https://blindfold.okta.example.com/oauth2/v1/authorize",
    clientId: "okta-client-id"
  });
  const samlProvider = await auth.admin.identityProviders.create({
    key: "entra-enterprise",
    name: "Entra Enterprise",
    type: "saml",
    mode,
    issuer: "https://sts.windows.net/demo/",
    ssoUrl: "https://login.microsoftonline.com/demo/saml2",
    x509Certificate: "demo-cert"
  });

  await auth.admin.applicationProviders.bind({
    applicationId: application.id,
    providerId: oidcProvider.id,
    domains: ["okta.example.com"],
    defaultRoleIds: [enterpriseRole.id]
  });
  await auth.admin.applicationProviders.bind({
    applicationId: application.id,
    providerId: samlProvider.id,
    domains: ["entra.example.com"],
    defaultRoleIds: [enterpriseRole.id],
    allowIdpInitiated: true,
    entityId: "blindfold-saml-sp"
  });

  return {
    auth,
    application,
    enterpriseRole,
    oidcProvider,
    samlProvider
  };
}

test("OIDC federation creates a shared provider session, JIT-provisions a principal, and assigns default roles", async () => {
  const { auth, application, enterpriseRole, oidcProvider } = await createFederationFixture();

  const start = await auth.handlers.oidc.start()({
    body: {
      applicationId: application.id,
      email: "jordan@okta.example.com"
    },
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(start.statusCode, 200);
  const startPayload = JSON.parse(start.body);
  assert.equal(startPayload.provider.id, oidcProvider.id);
  assert.ok(startPayload.redirectTo.includes("state="));

  const callback = await auth.handlers.oidc.callback()({
    body: startPayload.demoCallback,
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(callback.statusCode, 200);
  const callbackPayload = JSON.parse(callback.body);
  assert.equal(callbackPayload.session.authStrength, "oidc");

  const principals = await auth.admin.principals.list();
  const createdPrincipal = principals.find((principal: any) => principal.email === "jordan@okta.example.com");
  assert.ok(createdPrincipal);

  const memberships = await auth.storage.list("memberships", {
    principalId: createdPrincipal.id,
    applicationId: application.id
  });
  assert.equal(memberships.some((membership: any) => membership.roleId === enterpriseRole.id), true);

  const federatedIdentity = (
    await auth.storage.list("federated_identities", {
      applicationId: application.id,
      providerId: oidcProvider.id
    })
  )[0];
  assert.equal(federatedIdentity.email, "jordan@okta.example.com");
});

test("SAML federation supports SP-initiated login, IdP-initiated login, and metadata output", async () => {
  const { auth, application, samlProvider } = await createFederationFixture();

  const start = await auth.handlers.saml.start()({
    body: {
      applicationId: application.id,
      email: "taylor@entra.example.com"
    },
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(start.statusCode, 200);
  const startPayload = JSON.parse(start.body);
  assert.ok(startPayload.samlRequest);

  const callback = await auth.handlers.saml.callback()({
    body: startPayload.demoCallback,
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(callback.statusCode, 200);
  assert.equal(JSON.parse(callback.body).session.authStrength, "saml");

  const idpInitiated = await auth.handlers.saml.callback()({
    body: {
      applicationId: application.id,
      providerId: samlProvider.id,
      claims: {
        sub: "entra:idp-initiated",
        email: "idp-user@entra.example.com",
        name: "IdP User"
      }
    },
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(idpInitiated.statusCode, 200);
  assert.equal(JSON.parse(idpInitiated.body).session.authStrength, "saml");

  const metadata = await auth.handlers.saml.metadata()({
    query: {
      applicationId: application.id,
      providerId: samlProvider.id
    },
    headers: {
      host: "localhost:4110"
    }
  });
  assert.equal(metadata.statusCode, 200);
  assert.match(metadata.body, /EntityDescriptor/);
  assert.match(metadata.body, /blindfold-saml-sp/);
});

test("Federation surfaces provider choice conflicts and rejects ambiguous email linking", async () => {
  const { auth, application, oidcProvider } = await createFederationFixture();

  const alternateProvider = await auth.admin.identityProviders.create({
    key: "okta-alt",
    name: "Okta Alt",
    type: "oidc",
    mode: "demo",
    issuer: "https://alt.okta.example.com/oauth2/default",
    authorizationUrl: "https://alt.okta.example.com/oauth2/v1/authorize",
    clientId: "alt-client-id"
  });
  await auth.admin.applicationProviders.bind({
    applicationId: application.id,
    providerId: alternateProvider.id,
    domains: ["shared.example.com"],
    defaultRoleIds: []
  });
  await auth.admin.applicationProviders.bind({
    applicationId: application.id,
    providerId: oidcProvider.id,
    domains: ["shared.example.com"],
    defaultRoleIds: []
  });

  const providerConflict = await auth.handlers.oidc.start()({
    body: {
      applicationId: application.id,
      email: "choice@shared.example.com"
    }
  });
  assert.equal(providerConflict.statusCode, 409);
  const providerConflictPayload = JSON.parse(providerConflict.body);
  assert.equal(providerConflictPayload.multipleProviders, true);
  assert.equal(providerConflictPayload.providerChoices.length, 2);

  await auth.storage.put("principals", {
    id: "principal_duplicate_1",
    workspaceId: auth.workspaceId,
    email: "ambiguous@okta.example.com",
    displayName: "Duplicate One",
    status: "active",
    passwordHash: null,
    mfa: {
      totp: { enabled: false, secret: null },
      recoveryCodes: []
    }
  });
  await auth.storage.put("principals", {
    id: "principal_duplicate_2",
    workspaceId: auth.workspaceId,
    email: "ambiguous@okta.example.com",
    displayName: "Duplicate Two",
    status: "active",
    passwordHash: null,
    mfa: {
      totp: { enabled: false, secret: null },
      recoveryCodes: []
    }
  });

  const start = await auth.handlers.oidc.start()({
    body: {
      applicationId: application.id,
      email: "ambiguous@okta.example.com",
      providerId: oidcProvider.id
    },
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(start.statusCode, 200);

  const callback = await auth.handlers.oidc.callback()({
    body: JSON.parse(start.body).demoCallback,
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(callback.statusCode, 401);
  assert.deepEqual(JSON.parse(callback.body), {
    error: "Federation claims map ambiguously to multiple principals"
  });
});

test("Live federation providers do not allow direct demo callbacks", async () => {
  const { auth, application } = await createFederationFixture({ mode: "live" });

  const oidcStart = await auth.handlers.oidc.start()({
    body: {
      applicationId: application.id,
      email: "strict@okta.example.com"
    },
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(oidcStart.statusCode, 200);
  const oidcStartPayload = JSON.parse(oidcStart.body);
  assert.equal("demoCallback" in oidcStartPayload, false);

  const oidcCallback = await auth.handlers.oidc.callback()({
    body: {
      state: oidcStartPayload.state,
      claims: {
        sub: "strict:subject",
        email: "strict@okta.example.com"
      }
    },
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(oidcCallback.statusCode, 401);
  assert.deepEqual(JSON.parse(oidcCallback.body), {
    error: "Direct OIDC claims are only allowed for demo providers"
  });

  const samlStart = await auth.handlers.saml.start()({
    body: {
      applicationId: application.id,
      email: "strict@entra.example.com"
    },
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(samlStart.statusCode, 200);
  const samlStartPayload = JSON.parse(samlStart.body);
  assert.equal("demoCallback" in samlStartPayload, false);

  const samlCallback = await auth.handlers.saml.callback()({
    body: {
      applicationId: application.id,
      providerId: samlStartPayload.provider.id,
      claims: {
        sub: "strict:subject",
        email: "strict@entra.example.com"
      }
    },
    headers: {
      host: "localhost:4110",
      origin: "http://localhost:4110"
    }
  });
  assert.equal(samlCallback.statusCode, 401);
  assert.deepEqual(JSON.parse(samlCallback.body), {
    error: "Direct SAML claims are only allowed for demo providers"
  });
});
