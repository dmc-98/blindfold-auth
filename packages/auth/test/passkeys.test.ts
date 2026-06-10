import assert from "node:assert/strict";
import test from "node:test";
import { createAuth, createMemoryStorage } from "../src/index.js";

test("Passkey handlers create RP-scoped challenges, surface resident credentials, and support revocation", async () => {
  const auth = createAuth({
    workspaceId: "workspace_passkeys_test",
    secret: "passkeys-secret",
    storage: createMemoryStorage()
  });

  await auth.admin.bootstrapWorkspace({ name: "Passkey Workspace" });
  const application = await auth.admin.applications.create({
    slug: "passkey-app",
    name: "Passkey App",
    config: {
      passkeys: {
        rpId: "login.example.com",
        origins: ["https://login.example.com"]
      }
    }
  });
  const principal = await auth.admin.principals.create({
    displayName: "Passkey User",
    email: "passkey@example.com",
    password: "passkey-password"
  });
  const role = await auth.admin.roles.create({
    applicationId: application.id,
    name: "member"
  });
  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: role.id,
    resource: "account",
    action: "read"
  });
  await auth.admin.memberships.assignRole({
    principalId: principal.id,
    applicationId: application.id,
    roleId: role.id
  });

  const login = await auth.handlers.login()({
    body: {
      applicationId: application.id,
      email: principal.email,
      password: "passkey-password"
    }
  });
  const loginPayload = JSON.parse(login.body);

  const registration = await auth.handlers.passkeys.beginRegistration()({
    body: {
      applicationId: application.id,
      nickname: "Laptop Passkey"
    },
    headers: {
      authorization: `Bearer ${loginPayload.accessToken}`,
      host: "login.example.com",
      origin: "https://login.example.com"
    }
  });
  assert.equal(registration.statusCode, 200);
  const registrationPayload = JSON.parse(registration.body);
  assert.ok(registrationPayload.challengeId);
  assert.ok(registrationPayload.options.challenge);

  const registrationChallenge = await auth.storage.get("auth_challenges", registrationPayload.challengeId);
  assert.equal(registrationChallenge.type, "webauthn_registration");
  assert.equal(registrationChallenge.rpID, "login.example.com");
  assert.deepEqual(registrationChallenge.expectedOrigins, ["https://login.example.com"]);

  await auth.storage.put("webauthn_credentials", {
    id: "passkey_record_1",
    workspaceId: auth.workspaceId,
    principalId: principal.id,
    applicationId: application.id,
    credentialId: "resident-passkey-credential",
    publicKey: "fake-public-key",
    counter: 0,
    transports: ["internal"],
    rpID: "login.example.com",
    nickname: "Laptop Passkey",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const authentication = await auth.handlers.passkeys.beginAuthentication()({
    body: {
      applicationId: application.id,
      email: principal.email
    },
    headers: {
      host: "login.example.com",
      origin: "https://login.example.com"
    }
  });
  assert.equal(authentication.statusCode, 200);
  const authenticationPayload = JSON.parse(authentication.body);
  assert.equal(authenticationPayload.options.allowCredentials.length, 1);
  assert.equal(authenticationPayload.options.allowCredentials[0].id, "resident-passkey-credential");

  const revoked = await auth.admin.passkeys.revoke({
    credentialId: "resident-passkey-credential"
  });
  assert.equal(revoked.status, "revoked");

  const passkeys = await auth.admin.passkeys.list({
    principalId: principal.id,
    applicationId: application.id
  });
  assert.equal(passkeys.length, 1);
  assert.equal(passkeys[0].status, "revoked");
});
