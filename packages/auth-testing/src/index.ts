import assert from "node:assert";
import { blindfold } from "@blindfold/client";

/**
 * @blindfold/testing — make local testing trivial after integrating auth.
 *
 * Spins up a fully in-memory Blindfold instance with a deterministic secret,
 * seeds a workspace/app/users/roles in one call, mints sessions without HTTP,
 * and asserts RBAC/ABAC decisions. No database, no IdP, no key management.
 *
 *   const t = await createTestAuth({
 *     app: { slug: "billing", name: "Billing" },
 *     users: [{ email: "admin@x.com", password: "pw", roles: ["operator"] }],
 *     roles: [{ name: "operator", permissions: [{ resource: "invoice", action: "read" }] }],
 *   });
 *   const session = await t.login("admin@x.com", "pw");
 *   await t.assertCan("admin@x.com", "invoice", "read");
 *   await t.assertCannot("admin@x.com", "invoice", "delete");
 */
export async function createTestAuth(options: Record<string, any> = {}): Promise<Record<string, any>> {
  const {
    secret = "test-secret-deterministic",
    workspaceName = "Test Workspace",
    app = { slug: "test-app", name: "Test App" },
    users = [],
    roles = [],
    session,
    security,
    authMethods
  } = options;

  const client = await blindfold({
    project: options.project || "workspace_test",
    secret,
    storage: "memory",
    mode: "test",
    session,
    security,
    authMethods
  });

  const { auth } = client;

  await auth.admin.bootstrapWorkspace({ name: workspaceName });
  const application = await auth.admin.applications.create({ slug: app.slug, name: app.name });

  // Roles first so users can be assigned on creation.
  const roleByName = new Map<string, any>();
  for (const roleDef of roles) {
    const role = await auth.admin.roles.create({
      applicationId: application.id,
      name: roleDef.name
    });
    for (const perm of roleDef.permissions || []) {
      await auth.admin.roles.grantPermission({
        applicationId: application.id,
        roleId: role.id,
        resource: perm.resource,
        action: perm.action,
        effect: perm.effect
      });
    }
    roleByName.set(roleDef.name, role);
  }

  const principalByEmail = new Map<string, any>();
  for (const userDef of users) {
    const principal = await auth.admin.principals.create({
      email: userDef.email,
      password: userDef.password,
      displayName: userDef.displayName || userDef.email,
      attributes: userDef.attributes || {}
    });
    for (const roleName of userDef.roles || []) {
      const role = roleByName.get(roleName);
      if (!role) {
        throw new Error(`Test user ${userDef.email} references unknown role "${roleName}"`);
      }
      await auth.admin.memberships.assignRole({
        principalId: principal.id,
        applicationId: application.id,
        roleId: role.id
      });
    }
    principalByEmail.set(userDef.email, principal);
  }

  function principalIdFor(emailOrId: string): string {
    return principalByEmail.get(emailOrId)?.id || emailOrId;
  }

  const harness = {
    client,
    auth,
    application,
    applicationId: application.id,
    roles: roleByName,
    users: principalByEmail,

    /** Authenticate by password; returns the login result (tokens, session). */
    async login(email: string, password: string): Promise<any> {
      const handler = auth.handlers.login();
      const result = await handler({ body: { applicationId: application.id, email, password } });
      const payload = JSON.parse(result.body);
      if (result.statusCode !== 200) {
        throw new Error(`login failed for ${email}: ${payload.error || result.statusCode}`);
      }
      return payload;
    },

    /**
     * Mint a session directly (no password round-trip) for fast tests.
     * Defaults to bypassing the application-access check so you can mint a
     * session for any principal; pass requireApplicationAccess:true to enforce it.
     */
    async mintSession(emailOrId: string, extra: Record<string, any> = {}): Promise<any> {
      const principal =
        principalByEmail.get(emailOrId) || (await auth.storage.get("principals", emailOrId));
      if (!principal) {
        throw new Error(`mintSession: unknown principal "${emailOrId}"`);
      }
      const { requireApplicationAccess = false, ...rest } = extra;
      return auth.session.create({
        applicationId: application.id,
        principal,
        requireApplicationAccess,
        ...rest
      });
    },

    /** Run an RBAC/ABAC decision for a principal. */
    async can(emailOrId: string, action: string, resource: string, context: Record<string, any> = {}): Promise<any> {
      return auth.can({
        principalId: principalIdFor(emailOrId),
        applicationId: application.id,
        action,
        resource,
        ...context
      });
    },

    /** Assert allowed; throws with the decision reason on failure. */
    async assertCan(emailOrId: string, action: string, resource: string, context: Record<string, any> = {}): Promise<any> {
      const decision = await harness.can(emailOrId, action, resource, context);
      assert.ok(
        decision.allowed,
        `Expected ${emailOrId} to be allowed ${action} on ${resource}, got: ${decision.reason}`
      );
      return decision;
    },

    /** Assert denied; throws if unexpectedly allowed. */
    async assertCannot(emailOrId: string, action: string, resource: string, context: Record<string, any> = {}): Promise<any> {
      const decision = await harness.can(emailOrId, action, resource, context);
      assert.ok(
        !decision.allowed,
        `Expected ${emailOrId} to be denied ${action} on ${resource}, but it was allowed`
      );
      return decision;
    },

    /** Recent audit events, newest first. */
    async auditEvents(limit = 100): Promise<any> {
      return auth.admin.audit.list({ limit });
    }
  };

  return harness;
}

export { blindfold } from "@blindfold/client";
export { runStorageConformance } from "./storage-conformance.js";
