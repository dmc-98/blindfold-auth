import { createAuth } from "@dmc--98/blindfold-auth";
import type { Storage } from "@dmc--98/blindfold-auth";
import { resolveStorage, isStorageAdapter } from "./storage.js";

/**
 * @dmc--98/blindfold-client — the drop-in SDK.
 *
 * Goal (M1): reduce integration to a few lines while exposing the full engine:
 * authn, RBAC + ABAC (M2), sessions, and the prebuilt auth handlers.
 *
 *   const auth = await blindfold({ project: "my-app", secret, storage: "postgres" });
 *   app.use(auth.express());                       // mounts /auth/* + attaches req.auth
 *   app.get("/admin", auth.guard({ resource: "billing", action: "read" }), handler);
 *
 * `blindfold()` is async because storage resolution may lazy-load an adapter.
 */
export async function blindfold(config: Record<string, any> = {}): Promise<Record<string, any>> {
  const {
    project,
    workspaceId,
    secret,
    storage = "memory",
    storageOptions = {},
    session,
    security,
    authMethods,
    mode
  } = config;

  if (!secret) {
    throw new Error("blindfold() requires a secret (set BLINDFOLD_SECRET).");
  }

  const resolvedStorage: Storage = isStorageAdapter(storage)
    ? storage
    : await resolveStorage(storage, storageOptions);

  const auth = createAuth({
    workspaceId: workspaceId || project || "workspace_local",
    secret,
    storage: resolvedStorage,
    session,
    security,
    authMethods
  });

  const client = {
    /** The underlying @dmc--98/blindfold-auth instance — full escape hatch. */
    auth,
    project: project || null,
    mode: mode || "default",
    storage: resolvedStorage,

    /** RBAC + ABAC decision. Accepts the same shape as auth.can(). */
    can: (...args: any[]) => (auth.can as (...a: any[]) => any)(...args),

    /** Wrap a handler with authn (+ optional RBAC/ABAC authz). */
    protect: (...args: any[]) => (auth.protect as (...a: any[]) => any)(...args),

    /** Session primitives. */
    session: auth.session,

    /** Prebuilt request handlers (login, refresh, logout, magic link, passkeys). */
    handlers: auth.handlers,

    /** Admin / management surface (used by CLI, MCP, Studio, and seeding). */
    admin: auth.admin,

    /**
     * Framework-agnostic guard returning a normalized-request handler.
     * Express/etc. adapters translate their req/res into this shape.
     */
    guard(options: any, handler?: any) {
      if (typeof options === "function") {
        return auth.protect(options);
      }
      if (typeof handler === "function") {
        return auth.protect(options, handler);
      }
      // Guard-only (no inner handler): resolve to a pass/deny decision handler.
      return auth.protect(options || {}, async (ctx: any) => ({
        statusCode: 200,
        body: { ok: true, subject: ctx.subject?.id, decision: ctx.decision || null }
      }));
    },

    /**
     * One-call project setup for demos, local dev, and tests. Idempotent-ish:
     * intended for fresh workspaces. Returns the created entities.
     */
    async setup({
      workspaceName = "Blindfold Workspace",
      app = { slug: "app", name: "App" },
      admin: adminUser = null,
      roles = []
    }: Record<string, any> = {}): Promise<Record<string, any>> {
      await auth.admin.bootstrapWorkspace({ name: workspaceName });
      const application = await auth.admin.applications.create({
        slug: app.slug,
        name: app.name
      });

      const created: Record<string, any> = { application, principal: null, roles: [] };

      if (adminUser) {
        created.principal = await auth.admin.principals.create({
          email: adminUser.email,
          password: adminUser.password,
          displayName: adminUser.displayName || adminUser.email,
          attributes: adminUser.attributes || {}
        });
      }

      for (const roleDef of roles as any[]) {
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
        if (created.principal && roleDef.assignToAdmin) {
          await auth.admin.memberships.assignRole({
            principalId: created.principal.id,
            applicationId: application.id,
            roleId: role.id
          });
        }
        created.roles.push(role);
      }

      return created;
    }
  };

  return client;
}

export { resolveStorage } from "./storage.js";
export { blindfoldExpress } from "./express.js";
export { generateSnippet, SNIPPET_FRAMEWORKS } from "./snippet.js";
