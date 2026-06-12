import { blindfold, generateSnippet, SNIPPET_FRAMEWORKS } from "@dmc--98/blindfold-client";

/**
 * Playground sandbox — the testable core behind the interactive UI.
 *
 * Builds a real Blindfold instance over a chosen storage backend, seeds a small
 * scenario that exercises the full authorization surface (RBAC roles, an ABAC
 * field-masking policy, multiple users), and exposes high-level actions the UI
 * (and tests) drive: inspect state, log in, evaluate/explain a decision, author
 * roles and policies live, revoke sessions, and generate integration snippets.
 *
 * The seeded scenario:
 *   - app "Playground"
 *   - role "admin"   → can do everything (resource "*", action "*")
 *   - role "support" → can read "customer"
 *   - policy: support reading customer.ssn → effect "mask" (field-level)
 *   - users: alice@demo (admin), bob@demo (support)
 *
 * So in the UI you can show: bob can read a customer, bob's ssn field is masked,
 * bob cannot delete, and alice can do anything — live, with the matched rule ids.
 */
const DEMO_PASSWORD = "playground-123";

export async function createSandbox(options: Record<string, any> = {}): Promise<Record<string, any>> {
  const storage = options.storage || "memory";
  const client = await blindfold({
    project: "playground",
    secret: options.secret || "playground-secret",
    storage,
    storageOptions: options.storageOptions || {}
  });
  const { auth } = client;

  const principalsByEmail = new Map<string, any>();
  const rolesByName = new Map<string, any>();
  let application: any;

  async function seed(): Promise<void> {
    await auth.admin.bootstrapWorkspace({ name: "Playground Workspace" });
    application = await auth.admin.applications.create({ slug: "playground", name: "Playground" });

    await addRole({ name: "admin", permissions: [{ resource: "*", action: "*" }] });
    await addRole({ name: "support", permissions: [{ resource: "customer", action: "read" }] });

    await addUser({ email: "alice@demo", password: DEMO_PASSWORD, roles: ["admin"] });
    await addUser({ email: "bob@demo", password: DEMO_PASSWORD, roles: ["support"] });

    // ABAC field-level masking: support sees customer records but ssn is masked.
    await addPolicy({
      roleName: "support",
      resource: "customer",
      action: "read",
      field: "ssn",
      effect: "mask"
    });
  }

  async function addRole({ name, permissions = [] }: Record<string, any>): Promise<any> {
    const role = await auth.admin.roles.create({ applicationId: application.id, name });
    for (const perm of permissions) {
      await auth.admin.roles.grantPermission({
        applicationId: application.id,
        roleId: role.id,
        resource: perm.resource,
        action: perm.action,
        field: perm.field || "*",
        effect: perm.effect || "allow"
      });
    }
    rolesByName.set(name, role);
    return role;
  }

  async function addUser({ email, password, roles = [] }: Record<string, any>): Promise<any> {
    const principal = await auth.admin.principals.create({
      email,
      password,
      displayName: email,
      attributes: {}
    });
    for (const roleName of roles) {
      const role = rolesByName.get(roleName);
      if (!role) {
        throw new Error(`Unknown role "${roleName}"`);
      }
      await auth.admin.memberships.assignRole({
        principalId: principal.id,
        applicationId: application.id,
        roleId: role.id
      });
    }
    principalsByEmail.set(email, principal);
    return principal;
  }

  async function addPolicy({ roleName, resource, action, field = null, effect = "allow", conditionJson = null }: Record<string, any>): Promise<any> {
    const role = roleName ? rolesByName.get(roleName) : null;
    if (roleName && !role) {
      throw new Error(`Unknown role "${roleName}"`);
    }
    return auth.admin.policies.add({
      applicationId: application.id,
      roleId: role?.id || null,
      resource,
      action,
      field,
      effect,
      conditionJson
    });
  }

  function principalIdFor(emailOrId: string): string {
    return principalsByEmail.get(emailOrId)?.id || emailOrId;
  }

  async function login({ email, password }: Record<string, any>): Promise<any> {
    const res = await auth.handlers.login()({
      body: { applicationId: application.id, email, password }
    });
    const payload = JSON.parse(res.body);
    return { status: res.statusCode, ...payload };
  }

  /** Evaluate + explain a decision (RBAC/ABAC, field-level). */
  async function evaluate({ email, action, resource, field = null, resourceAttributes = {} }: Record<string, any>): Promise<any> {
    const decision = await auth.admin.debugDecision({
      principalId: principalIdFor(email),
      applicationId: application.id,
      action,
      resource,
      field,
      resourceAttributes
    });
    return decision; // { allowed, effect, matchedRuleIds, obligations, reason }
  }

  async function getState(): Promise<Record<string, any>> {
    const [roles, policies, principals, sessions, audit] = await Promise.all([
      auth.admin.roles.list({ applicationId: application.id }),
      auth.admin.policies.list({ applicationId: application.id }),
      auth.admin.principals.list(),
      auth.admin.sessions.list({ applicationId: application.id }),
      auth.admin.audit.list({ limit: 20 })
    ]);
    return {
      storage,
      application: { id: application.id, slug: application.slug, name: application.name },
      roles: roles.map((r: any) => ({ id: r.id, name: r.name })),
      policies: policies.map((p: any) => ({
        id: p.id,
        roleId: p.roleId,
        resource: p.resource,
        action: p.action,
        field: p.field,
        effect: p.effect
      })),
      users: principals.map((p: any) => ({ id: p.id, email: p.email })),
      sessionCount: sessions.length,
      audit: audit.map((a: any) => ({ type: a.type, at: a.createdAt }))
    };
  }

  async function revokeSession({ refreshToken }: Record<string, any>): Promise<Record<string, any>> {
    await auth.session.revoke({ refreshToken, reason: "playground" });
    return { ok: true };
  }

  function snippet({ framework = "express", storage: storageAlias }: Record<string, any> = {}): Record<string, any> {
    return {
      framework,
      frameworks: SNIPPET_FRAMEWORKS,
      code: generateSnippet({ framework, project: "playground", storage: storageAlias || storage })
    };
  }

  await seed();

  return {
    client,
    auth,
    get application() {
      return application;
    },
    seed,
    addRole,
    addUser,
    addPolicy,
    login,
    evaluate,
    getState,
    revokeSession,
    snippet,
    DEMO_PASSWORD
  };
}
