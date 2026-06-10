import { performance } from "node:perf_hooks";
import { createAuth, createMemoryStorage } from "@blindfold/auth";

interface Budget {
  avgMs: number;
  p95Ms: number;
}

const budgets: Record<string, Budget> = {
  passwordLogin: { avgMs: 90, p95Ms: 120 },
  failedLoginRateLimitPath: { avgMs: 2, p95Ms: 4 },
  sessionVerify: { avgMs: 0.4, p95Ms: 1.5 },
  authorizationCheck: { avgMs: 0.8, p95Ms: 2.5 },
  protectedRoute: { avgMs: 0.9, p95Ms: 3 },
  refreshRotation: { avgMs: 0.8, p95Ms: 2.5 }
};

interface BenchResult {
  name: string;
  iterations: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index]!;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

async function measure(
  name: string,
  iterations: number,
  fn: (index: number, warmup: boolean) => Promise<void>,
  warmups: number = Math.min(5, iterations)
): Promise<BenchResult> {
  for (let index = 0; index < warmups; index += 1) {
    await fn(index, true);
  }

  const durations: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    await fn(index, false);
    durations.push(performance.now() - startedAt);
  }

  return {
    name,
    iterations,
    avgMs: round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p50Ms: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    maxMs: round(Math.max(...durations))
  };
}

function formatTable(results: BenchResult[]): string {
  const header = ["Scenario", "Iterations", "Avg (ms)", "P50 (ms)", "P95 (ms)", "Max (ms)", "Budget"];
  const rows = results.map((result) => [
    result.name,
    String(result.iterations),
    String(result.avgMs),
    String(result.p50Ms),
    String(result.p95Ms),
    String(result.maxMs),
    `${budgets[result.name]!.avgMs}/${budgets[result.name]!.p95Ms}`
  ]);

  const widths = header.map((column, index) => Math.max(column.length, ...rows.map((row) => row[index]!.length)));

  const formatRow = (columns: string[]) => columns.map((column, index) => column.padEnd(widths[index]!, " ")).join(" | ");

  return [formatRow(header), widths.map((width) => "-".repeat(width)).join("-|-"), ...rows.map(formatRow)].join("\n");
}

function assertBudgets(results: BenchResult[]): void {
  const failures = results.filter((result) => {
    const budget = budgets[result.name]!;
    return result.avgMs > budget.avgMs || result.p95Ms > budget.p95Ms;
  });

  if (failures.length === 0) {
    return;
  }

  throw new Error(
    `Performance budgets exceeded for: ${failures
      .map((result) => `${result.name} (avg ${result.avgMs}ms, p95 ${result.p95Ms}ms)`)
      .join(", ")}`
  );
}

async function main(): Promise<void> {
  const auth = createAuth({
    workspaceId: "workspace_perf",
    secret: "performance-secret",
    storage: createMemoryStorage(),
    security: {
      magicLinks: {
        returnTokenInResponse: true
      }
    }
  });

  await auth.admin.bootstrapWorkspace({
    name: "Performance Workspace",
    defaults: {
      mfa: { required: false }
    }
  });

  const application = await auth.admin.applications.create({
    slug: "perf-app",
    name: "Performance App"
  });

  const role = await auth.admin.roles.create({
    applicationId: application.id,
    name: "finance_reader"
  });
  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: role.id,
    resource: "invoice",
    action: "read"
  });
  await auth.admin.policies.add({
    applicationId: application.id,
    resource: "invoice",
    action: "read",
    field: "internalNotes",
    effect: "mask",
    conditionJson: {
      eq: ["subject.department", "finance"]
    }
  });

  for (let index = 0; index < 400; index += 1) {
    const principal = await auth.admin.principals.create({
      displayName: `Background User ${index}`,
      email: `background-${index}@example.com`,
      password: "background-password"
    });
    if (index % 6 === 0) {
      await auth.admin.memberships.assignRole({
        principalId: principal.id,
        applicationId: application.id,
        roleId: role.id
      });
    }
  }

  const principal = await auth.admin.principals.create({
    displayName: "Performance User",
    email: "perf@example.com",
    password: "perf-password",
    attributes: { department: "finance", region: "in" }
  });
  await auth.admin.memberships.assignRole({
    principalId: principal.id,
    applicationId: application.id,
    roleId: role.id
  });

  const loginHandler = auth.handlers.login();
  const refreshHandler = auth.handlers.refresh();
  const protectedRoute = auth.protect(
    {
      applicationId: application.id,
      resource: "invoice",
      action: "read",
      field: "internalNotes"
    },
    async ({ decision }: any) => ({
      statusCode: 200,
      body: JSON.stringify({ effect: decision.effect })
    })
  );

  const initialLogin = JSON.parse(
    (
      await loginHandler({
        body: {
          applicationId: application.id,
          email: principal.email,
          password: "perf-password"
        }
      })
    ).body
  );

  let accessToken = initialLogin.accessToken;
  let refreshToken = initialLogin.refreshToken;

  const results: BenchResult[] = [];

  results.push(
    await measure("passwordLogin", 25, async () => {
      const response = await loginHandler({
        body: {
          applicationId: application.id,
          email: principal.email,
          password: "perf-password"
        }
      });
      if (response.statusCode !== 200) {
        throw new Error(`Password login benchmark failed: ${response.body}`);
      }
    })
  );

  results.push(
    await measure("failedLoginRateLimitPath", 50, async (index) => {
      const response = await loginHandler({
        body: {
          applicationId: application.id,
          email: `missing-${index}@example.com`,
          password: "nope"
        }
      });
      if (response.statusCode !== 401) {
        throw new Error(`Failed login benchmark expected 401, got ${response.statusCode}`);
      }
    })
  );

  results.push(
    await measure("sessionVerify", 750, async () => {
      const verification = await auth.session.verify({ accessToken });
      if (!verification.ok) {
        throw new Error(`Session verify benchmark failed: ${verification.reason}`);
      }
    })
  );

  results.push(
    await measure("authorizationCheck", 750, async () => {
      const decision = await auth.can({
        principalId: principal.id,
        applicationId: application.id,
        action: "read",
        resource: "invoice",
        field: "internalNotes",
        resourceAttributes: { tenantId: "tenant_perf" }
      });
      if (!decision.allowed) {
        throw new Error(`Authorization benchmark failed: ${decision.reason}`);
      }
    })
  );

  results.push(
    await measure("protectedRoute", 500, async () => {
      const response = await protectedRoute({
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      });
      if (response.statusCode !== 200) {
        throw new Error(`Protected route benchmark failed: ${response.body}`);
      }
    })
  );

  results.push(
    await measure("refreshRotation", 150, async () => {
      const response = await refreshHandler({
        body: {
          refreshToken
        }
      });
      if (response.statusCode !== 200) {
        throw new Error(`Refresh benchmark failed: ${response.body}`);
      }

      const payload = JSON.parse(response.body);
      accessToken = payload.accessToken;
      refreshToken = payload.refreshToken;
    })
  );

  console.log("Blindfold Auth performance baseline");
  console.log(formatTable(results));

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ budgets, results }, null, 2));
  }

  if (process.argv.includes("--assert")) {
    assertBudgets(results);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
