import { blindfold } from "@dmc--98/blindfold-client";

/**
 * runDoctor — a self-contained health check that proves an integration works.
 *
 * Spins up an in-memory Blindfold instance (or uses a provided client) and runs
 * the nine-step smoke sequence: bootstrap → app → user → role/permission →
 * login → protected allow → protected deny → refresh/revoke → audit. Returns a
 * structured report so the CLI and MCP can present pass/fail per step.
 */
export async function runDoctor(options: Record<string, any> = {}): Promise<Record<string, any>> {
  const steps: Array<Record<string, any>> = [];
  const record = async (name: string, fn: () => Promise<any>): Promise<void> => {
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail: detail || null });
    } catch (error) {
      steps.push({ name, ok: false, error: (error as Error).message });
      throw Object.assign(new Error(`doctor step failed: ${name}`), { steps });
    }
  };

  const client =
    options.client ||
    (await blindfold({ project: "doctor", secret: options.secret || "doctor-secret", storage: "memory" }));
  const { auth } = client;

  let app: any;
  let principal: any;
  let role: any;
  let tokens: any;
  let refreshed: any;

  try {
    await record("bootstrap workspace", async () => {
      await auth.admin.bootstrapWorkspace({ name: "Doctor WS" });
    });
    await record("create application", async () => {
      app = await auth.admin.applications.create({ slug: "doctor-app", name: "Doctor App" });
      return app.id;
    });
    await record("create principal", async () => {
      principal = await auth.admin.principals.create({
        email: "doctor@x.com",
        password: "test-password-123!",
        displayName: "Doctor"
      });
      return principal.id;
    });
    await record("assign role + permission", async () => {
      role = await auth.admin.roles.create({ applicationId: app.id, name: "doctor" });
      await auth.admin.roles.grantPermission({
        applicationId: app.id,
        roleId: role.id,
        resource: "ping",
        action: "read"
      });
      await auth.admin.memberships.assignRole({
        principalId: principal.id,
        applicationId: app.id,
        roleId: role.id
      });
    });
    await record("login", async () => {
      const res = await auth.handlers.login()({
        body: { applicationId: app.id, email: "doctor@x.com", password: "test-password-123!" }
      });
      if (res.statusCode !== 200) {
        throw new Error(`login status ${res.statusCode}`);
      }
      tokens = JSON.parse(res.body);
    });
    const handler = auth.protect(
      { applicationId: app.id, resource: "ping", action: "read" },
      async (ctx: any) => ({ statusCode: 200, body: { who: ctx.subject.id } })
    );
    await record("protected route allow", async () => {
      const r = await handler({ headers: { authorization: `Bearer ${tokens.accessToken}` } });
      if (r.statusCode !== 200) {
        throw new Error(`expected 200, got ${r.statusCode}`);
      }
    });
    await record("protected route deny", async () => {
      const r = await handler({ headers: {} });
      if (r.statusCode !== 401) {
        throw new Error(`expected 401, got ${r.statusCode}`);
      }
    });
    await record("refresh + revoke", async () => {
      refreshed = await auth.session.refresh({ refreshToken: tokens.refreshToken });
      if (!refreshed.accessToken) {
        throw new Error("refresh returned no access token");
      }
      await auth.session.revoke({ refreshToken: refreshed.refreshToken, reason: "doctor" });
    });
    await record("audit events recorded", async () => {
      const events = await auth.admin.audit.list({ limit: 50 });
      if (!events.length) {
        throw new Error("no audit events");
      }
      return events.length;
    });
  } catch {
    // failure already recorded in steps; fall through to report
  }

  const ok = steps.every((s) => s.ok);
  return { ok, steps, passed: steps.filter((s) => s.ok).length, total: steps.length };
}
