import createConfiguredAuth, { migrate } from "./blindfold.config.js";

const auth = typeof createConfiguredAuth === "function" ? createConfiguredAuth() : createConfiguredAuth;

function expect(condition: any, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureApplication() {
  const applications = await auth.admin.applications.list();
  const existing = applications.find((application: any) => application.slug === "postgres-billing");
  if (existing) {
    return existing;
  }

  return auth.admin.applications.create({
    slug: "postgres-billing",
    name: "Postgres Billing",
    description: "Postgres-backed Blindfold demo application"
  });
}

async function ensurePrincipal() {
  const principals = await auth.admin.principals.list();
  const existing = principals.find((principal: any) => principal.email === "postgres-admin@example.com");
  if (existing) {
    return existing;
  }

  return auth.admin.principals.create({
    displayName: "Postgres Admin",
    email: "postgres-admin@example.com",
    password: "postgres-demo-password",
    attributes: {
      department: "finance",
      region: "in"
    }
  });
}

async function ensureRole(applicationId: string) {
  const roles = await auth.admin.roles.list({ applicationId });
  const existing = roles.find((role: any) => role.name === "finance_admin");
  if (existing) {
    return existing;
  }

  return auth.admin.roles.create({
    applicationId,
    name: "finance_admin",
    description: "Reads invoice data with field masking"
  });
}

async function ensurePermission({ applicationId, roleId }: { applicationId: string; roleId: string }) {
  const existing = await auth.storage.list("role_permissions", {
    applicationId,
    roleId,
    resource: "invoice",
    action: "read"
  });

  if (existing.length > 0) {
    return existing[0];
  }

  return auth.admin.roles.grantPermission({
    applicationId,
    roleId,
    resource: "invoice",
    action: "read"
  });
}

async function ensureMembership({ applicationId, principalId, roleId }: { applicationId: string; principalId: string; roleId: string }) {
  const existing = await auth.storage.list("memberships", {
    applicationId,
    principalId,
    roleId
  });

  if (existing.length > 0) {
    return existing[0];
  }

  return auth.admin.memberships.assignRole({
    applicationId,
    principalId,
    roleId
  });
}

async function ensureMaskPolicy({ applicationId }: { applicationId: string }) {
  const existing = await auth.storage.list("policy_rules", {
    applicationId,
    resource: "invoice",
    action: "read",
    field: "internalNotes",
    effect: "mask"
  });

  if (existing.length > 0) {
    return existing[0];
  }

  return auth.admin.policies.add({
    applicationId,
    resource: "invoice",
    action: "read",
    field: "internalNotes",
    effect: "mask",
    conditionJson: {
      eq: ["subject.department", "finance"]
    }
  });
}

async function main() {
  await migrate();
  await auth.admin.bootstrapWorkspace({
    name: "Blindfold Postgres Workspace",
    defaults: {
      mfa: { required: false }
    }
  });

  const application = await ensureApplication();
  const principal = await ensurePrincipal();
  const role = await ensureRole(application.id);

  await ensurePermission({ applicationId: application.id, roleId: role.id });
  await ensureMembership({
    applicationId: application.id,
    principalId: principal.id,
    roleId: role.id
  });
  await ensureMaskPolicy({ applicationId: application.id });

  const loginResponse = await auth.handlers.login()({
    body: {
      applicationId: application.id,
      email: principal.email,
      password: "postgres-demo-password"
    }
  });

  expect(loginResponse.statusCode === 200, `Expected login success, received ${loginResponse.statusCode}`);
  const loginPayload = JSON.parse(loginResponse.body);
  expect(loginPayload.accessToken, "Expected access token from login handler");
  expect(loginPayload.refreshToken, "Expected refresh token from login handler");

  const verified = await auth.session.verify({ accessToken: loginPayload.accessToken });
  expect(verified.ok, "Expected session verification to succeed");

  const decision = await auth.can({
    principalId: principal.id,
    applicationId: application.id,
    action: "read",
    resource: "invoice",
    field: "internalNotes",
    request: {
      authStrength: verified.session.authStrength
    }
  });

  expect(decision.allowed, "Expected invoice read to be allowed");
  expect(decision.effect === "mask", `Expected mask effect, received ${decision.effect}`);
  expect(decision.obligations.maskedFields.includes("internalNotes"), "Expected internalNotes to be masked");

  console.log("Blindfold Postgres smoke check passed.");
  console.log(`Application: ${application.slug}`);
  console.log(`Principal: ${principal.email}`);
  console.log(`Session: ${verified.session.id}`);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
