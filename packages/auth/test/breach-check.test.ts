import { test } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { checkPasswordBreached } from "../src/breach-check.js";

// Build a fake HIBP range response containing the suffix for "password123".
function fakeHibp(password: string, count: number) {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const suffix = sha1.slice(5);
  const body = `00000AAAA:1\r\n${suffix}:${count}\r\nFFFFFBBBB:2`;
  let requestedUrl = "";
  const fetchImpl = async (url: string) => {
    requestedUrl = url;
    return { ok: true, status: 200, text: async () => body } as Response;
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requestedUrl: () => requestedUrl, prefix: sha1.slice(0, 5) };
}

test("breached password is detected with its count; only the 5-char prefix leaves the process", async () => {
  const { fetchImpl, requestedUrl, prefix } = fakeHibp("password123", 99999);
  const result = await checkPasswordBreached("password123", { fetchImpl });
  assert.equal(result.breached, true);
  assert.equal(result.count, 99999);
  assert.ok(requestedUrl().endsWith(`/range/${prefix}`), `url was ${requestedUrl()}`);
  assert.ok(!requestedUrl().includes("password123"), "raw password must never appear in the URL");
  assert.ok(!requestedUrl().toUpperCase().includes(createHash("sha1").update("password123").digest("hex").toUpperCase().slice(5)), "full hash suffix must never leave the process");
});

test("clean password returns breached:false", async () => {
  const { fetchImpl } = fakeHibp("some-other-password", 5);
  const result = await checkPasswordBreached("correct-horse-battery-staple-9!", { fetchImpl });
  assert.equal(result.breached, false);
  assert.equal(result.count, 0);
});

test("fail-open by default with a checked:false marker when HIBP is unreachable", async () => {
  const fetchImpl = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
  const result = await checkPasswordBreached("anything", { fetchImpl });
  assert.equal(result.checked, false);
  assert.equal(result.breached, false);
});

// ── registration wiring ───────────────────────────────────────────────────────
import { createAuth } from "../src/auth.js";

test("opt-in breachPasswordCheck rejects breached passwords at registration", async () => {
  const { fetchImpl } = fakeHibp("common-breached-password-123", 1200);
  const auth = createAuth({
    secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9",
    security: { breachPasswordCheck: { fetchImpl } },
  });
  await auth.admin.bootstrapWorkspace({ name: "Breach WS" });
  await assert.rejects(
    () => auth.admin.principals.create({ email: "victim@x.com", password: "common-breached-password-123", displayName: "V" }),
    /known data breaches/
  );
  // A clean password registers fine through the same path.
  const ok = await auth.admin.principals.create({ email: "safe@x.com", password: "uncommon-pass-77!", displayName: "S" });
  assert.ok(ok.id);
});

test("breach check is off by default — breached passwords register (back-compat)", async () => {
  const auth = createAuth({ secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9" });
  await auth.admin.bootstrapWorkspace({ name: "Default WS" });
  const created = await auth.admin.principals.create({ email: "legacy@x.com", password: "legacy-password-123456", displayName: "L" });
  assert.ok(created.id);
});

// ── setPassword wiring ────────────────────────────────────────────────────────

test("setPassword rejects a breached password when breachPasswordCheck is enabled", async () => {
  const { fetchImpl } = fakeHibp("bad-password-breached-123", 500);
  const auth = createAuth({
    secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9",
    security: { breachPasswordCheck: { fetchImpl } },
  });
  await auth.admin.bootstrapWorkspace({ name: "SPW Breach WS" });
  const p = await auth.admin.principals.create({ email: "user@spw.com", password: "initial-safe-77!", displayName: "U" });
  await assert.rejects(
    () => auth.admin.principals.setPassword({ principalId: p.id, newPassword: "bad-password-breached-123" }),
    /known data breaches/
  );
});

test("setPassword accepts a clean password and principal can authenticate with it", async () => {
  const { fetchImpl } = fakeHibp("bad-password-breached-123", 500);
  const auth = createAuth({
    secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9",
    security: { breachPasswordCheck: { fetchImpl } },
  });
  await auth.admin.bootstrapWorkspace({ name: "SPW Clean WS" });
  const app = await auth.admin.applications.create({ slug: "app", name: "app" });
  const p = await auth.admin.principals.create({ email: "user2@spw.com", password: "old-pass-77!", displayName: "U2" });
  await auth.admin.memberships.assignRole({ principalId: p.id, applicationId: app.id, roleId: null });
  await auth.admin.principals.setPassword({ principalId: p.id, newPassword: "new-safe-pass-99!" });
  const result = await auth.handlers.login()({
    body: { applicationId: app.id, email: "user2@spw.com", password: "new-safe-pass-99!" }
  });
  assert.equal(result.statusCode, 200, `login after setPassword returned ${result.statusCode}`);
});

test("setPassword works with breach check off (back-compat)", async () => {
  const auth = createAuth({ secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9" });
  await auth.admin.bootstrapWorkspace({ name: "SPW Default WS" });
  const p = await auth.admin.principals.create({ email: "user3@spw.com", password: "initial-password-ok!", displayName: "U3" });
  // Common (but long enough) password accepted when breach check is off
  const updated = await auth.admin.principals.setPassword({ principalId: p.id, newPassword: "another-password-456" });
  assert.ok(updated.id);
  assert.ok(!updated.passwordHash.includes("another-password-456"), "raw password must not appear in stored hash");
});

test("setPassword throws for unknown principalId", async () => {
  const auth = createAuth({ secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9" });
  await auth.admin.bootstrapWorkspace({ name: "SPW Unknown WS" });
  await assert.rejects(
    () => auth.admin.principals.setPassword({ principalId: "principal_nonexistent", newPassword: "any-test-password-123" }),
    /Principal not found/
  );
});

// ── passwordMinLength hardening-by-default ────────────────────────────────────

test("passwordMinLength: create rejects a password shorter than the configured minimum", async () => {
  const auth = createAuth({
    secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9",
    security: { passwordMinLength: 12 },
  });
  await auth.admin.bootstrapWorkspace({ name: "PML WS" });
  await assert.rejects(
    () => auth.admin.principals.create({ email: "short@x.com", password: "tooshort!", displayName: "S" }),
    /at least 12/
  );
});

test("passwordMinLength: create accepts a password at exactly the minimum length", async () => {
  const auth = createAuth({
    secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9",
    security: { passwordMinLength: 12 },
  });
  await auth.admin.bootstrapWorkspace({ name: "PML Exact WS" });
  // Exactly 12 characters
  const p = await auth.admin.principals.create({ email: "exact@x.com", password: "exactly-12ch", displayName: "E" });
  assert.ok(p.id);
});

test("passwordMinLength: setPassword rejects a password shorter than the minimum", async () => {
  const auth = createAuth({
    secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9",
    security: { passwordMinLength: 12 },
  });
  await auth.admin.bootstrapWorkspace({ name: "PML Set WS" });
  const p = await auth.admin.principals.create({ email: "user@pml.com", password: "initial-pass-ok", displayName: "U" });
  await assert.rejects(
    () => auth.admin.principals.setPassword({ principalId: p.id, newPassword: "too-short!" }),
    /at least 12/
  );
});

test("passwordMinLength: default is 12 (OWASP ASVS §2.1.1)", async () => {
  // No explicit passwordMinLength in config — default must be 12.
  const auth = createAuth({ secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9" });
  await auth.admin.bootstrapWorkspace({ name: "PML Default WS" });
  await assert.rejects(
    () => auth.admin.principals.create({ email: "default@x.com", password: "tooshort!", displayName: "D" }),
    /at least 12/
  );
  // A password ≥12 chars succeeds without any explicit config.
  const p = await auth.admin.principals.create({ email: "ok@x.com", password: "long-enough-pass", displayName: "O" });
  assert.ok(p.id);
});

test("passwordMinLength: set to 0 disables the check (escape hatch)", async () => {
  const auth = createAuth({
    secret: "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9",
    security: { passwordMinLength: 0 },
  });
  await auth.admin.bootstrapWorkspace({ name: "PML Off WS" });
  // Very short password allowed when check is explicitly disabled.
  const p = await auth.admin.principals.create({ email: "nopml@x.com", password: "short", displayName: "N" });
  assert.ok(p.id);
});
