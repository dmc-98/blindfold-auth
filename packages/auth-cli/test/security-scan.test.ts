import { test } from "node:test";
import assert from "node:assert";
import { scanSecurityConfig } from "../src/security-scan.js";

function codes(findings: Array<{ code: string }>): string[] {
  return findings.map((f) => f.code).sort();
}

test("flags a missing secret as critical", () => {
  const findings = scanSecurityConfig({});
  const f = findings.find((x) => x.code === "secret-missing");
  assert.ok(f, "expected secret-missing finding");
  assert.equal(f!.severity, "critical");
});

test("flags short and low-entropy secrets", () => {
  const short = scanSecurityConfig({ BLINDFOLD_SECRET: "abc123" });
  assert.ok(codes(short).includes("secret-too-short"));

  const lowEntropy = scanSecurityConfig({ BLINDFOLD_SECRET: "a".repeat(48) });
  assert.ok(codes(lowEntropy).includes("secret-low-entropy"));
});

test("flags well-known placeholder secrets as critical even when long", () => {
  const findings = scanSecurityConfig({ BLINDFOLD_SECRET: "changeme-changeme-changeme-changeme" });
  const f = findings.find((x) => x.code === "secret-placeholder");
  assert.ok(f);
  assert.equal(f!.severity, "critical");
});

test("flags TLS-disabled database URLs in production", () => {
  const findings = scanSecurityConfig({
    NODE_ENV: "production",
    BLINDFOLD_SECRET: "f3a9c2e1d4b5a69788a1b2c3d4e5f60718293a4b",
    BLINDFOLD_DATABASE_URL: "postgres://app:pw@db.internal:5432/auth?sslmode=disable",
  });
  assert.ok(codes(findings).includes("db-tls-disabled"));
});

test("flags default credentials in the database URL", () => {
  const findings = scanSecurityConfig({
    BLINDFOLD_SECRET: "f3a9c2e1d4b5a69788a1b2c3d4e5f60718293a4b",
    BLINDFOLD_DATABASE_URL: "postgres://postgres:postgres@localhost:5432/auth",
  });
  assert.ok(codes(findings).includes("db-default-credentials"));
});

test("warns when production runs without a database URL (file/memory storage)", () => {
  const findings = scanSecurityConfig({
    NODE_ENV: "production",
    BLINDFOLD_SECRET: "f3a9c2e1d4b5a69788a1b2c3d4e5f60718293a4b",
  });
  assert.ok(codes(findings).includes("prod-no-database"));
});

test("warns when Studio binds beyond localhost", () => {
  const findings = scanSecurityConfig({
    BLINDFOLD_SECRET: "f3a9c2e1d4b5a69788a1b2c3d4e5f60718293a4b",
    BLINDFOLD_STUDIO_HOST: "0.0.0.0",
  });
  assert.ok(codes(findings).includes("studio-exposed"));
});

test("notes the default workspace id in production", () => {
  const findings = scanSecurityConfig({
    NODE_ENV: "production",
    BLINDFOLD_SECRET: "f3a9c2e1d4b5a69788a1b2c3d4e5f60718293a4b",
    BLINDFOLD_DATABASE_URL: "postgres://app:pw@db.internal:5432/auth?sslmode=require",
    BLINDFOLD_WORKSPACE_ID: "workspace_local",
  });
  assert.ok(codes(findings).includes("workspace-default-id"));
});

test("a hardened production config passes with zero findings", () => {
  const findings = scanSecurityConfig({
    NODE_ENV: "production",
    BLINDFOLD_SECRET: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9",
    BLINDFOLD_DATABASE_URL: "postgres://app:s3cr3t-rotated@db.internal:5432/auth?sslmode=verify-full",
    BLINDFOLD_WORKSPACE_ID: "workspace_prod_7f3k",
    BLINDFOLD_STUDIO_HOST: "127.0.0.1",
  });
  assert.deepEqual(findings, []);
});

test("every finding carries severity, message, and an actionable fix", () => {
  const findings = scanSecurityConfig({ BLINDFOLD_SECRET: "weak" });
  assert.ok(findings.length > 0);
  for (const f of findings) {
    assert.ok(["critical", "warning", "info"].includes(f.severity), `bad severity: ${f.severity}`);
    assert.ok(f.message.length > 10);
    assert.ok(f.fix.length > 10);
  }
});

// ── doctor command integration ────────────────────────────────────────────────
import { doctorCommand } from "../src/commands-m6.js";

test("doctor --security-only reports a hardened config as HEALTHY (exit 0)", async () => {
  const lines: string[] = [];
  const io = { log: (...a: any[]) => lines.push(a.join(" ")) };
  const code = await doctorCommand(["--security-only"], io, {
    NODE_ENV: "production",
    BLINDFOLD_SECRET: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9",
    BLINDFOLD_DATABASE_URL: "postgres://app:s3cr3t-rotated@db.internal:5432/auth?sslmode=verify-full",
    BLINDFOLD_WORKSPACE_ID: "workspace_prod_7f3k",
  });
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /No misconfigurations detected/);
  assert.match(lines.join("\n"), /Doctor: HEALTHY/);
});

test("doctor --security-only fails (exit 1) on critical findings and prints fixes", async () => {
  const lines: string[] = [];
  const io = { log: (...a: any[]) => lines.push(a.join(" ")) };
  const code = await doctorCommand(["--security-only"], io, { BLINDFOLD_SECRET: "changeme" });
  assert.equal(code, 1);
  assert.match(lines.join("\n"), /secret-placeholder/);
  assert.match(lines.join("\n"), /fix:/);
  assert.match(lines.join("\n"), /Doctor: FAILED/);
});
