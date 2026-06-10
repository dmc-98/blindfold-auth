import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { runCli } from "../src/index.js";

function createIo() {
  const lines: string[] = [];
  return {
    lines,
    log(message: any) {
      lines.push(String(message));
    }
  };
}

test("CLI help works without requiring a config file", async () => {
  const io = createIo();
  await runCli(["--help"], io);

  assert.equal(io.lines.length > 0, true);
  assert.match(io.lines.join("\n"), /Blindfold Auth CLI/);
  assert.match(io.lines.join("\n"), /studio --config/);
});

test("CLI migrate uses a named migrate hook when present", async () => {
  const io = createIo();
  await runCli(["migrate", "--config", resolve(process.cwd(), "packages/auth-cli/dist/test/fixtures/migrate.config.js")], io);

  assert.match(io.lines.join("\n"), /Migration completed/);
  assert.match(io.lines.join("\n"), /0001_core_tables/);
});

test("CLI migrate does not construct auth unless the migrate hook accesses it", async () => {
  const io = createIo();
  await runCli(["migrate", "--config", resolve(process.cwd(), "packages/auth-cli/dist/test/fixtures/lazy-migrate.config.js")], io);

  assert.match(io.lines.join("\n"), /Migration completed/);
  assert.match(io.lines.join("\n"), /0001_core_tables/);
});

test("CLI migrate dry run explains when only ensureTables is available", async () => {
  const io = createIo();
  await runCli(["migrate", "--dry-run", "--config", resolve(process.cwd(), "packages/auth-cli/dist/test/fixtures/ensure-tables.config.js")], io);

  assert.match(io.lines.join("\n"), /Dry run is only supported/);
});

test("CLI can seed the launch demo workspace with passkey, OIDC, and SAML assets", async () => {
  const io = createIo();
  await runCli(
    ["seed-launch-demo", "--config", resolve(process.cwd(), "packages/auth-cli/dist/test/fixtures/launch-demo.config.js")],
    io
  );

  assert.match(io.lines.join("\n"), /Seeded launch demo apps/);
  assert.match(io.lines.join("\n"), /launch-local-passkeys/);
  assert.match(io.lines.join("\n"), /okta-workforce/);
});
