import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/index.js";

function fakeIo() {
  const lines: string[] = [];
  return { lines, log: (...args: any[]) => lines.push(args.join(" ")), text: () => lines.join("\n") };
}

function storeFile() {
  return join(mkdtempSync(join(tmpdir(), "bf-cli-")), "control.json");
}

test("add-auth prints a few-lines integration snippet (no config required)", async () => {
  const io = fakeIo();
  const code = await runCli(["add-auth", "--framework", "express", "--project", "shop"], io);
  assert.equal(code, 0);
  assert.match(io.text(), /@dmc--98\/blindfold-client/);
  assert.match(io.text(), /blindfoldExpress/);
});

test("project + keys lifecycle through the CLI", async () => {
  const store = storeFile();

  const io1 = fakeIo();
  await runCli(["project", "create", "--name", "Shop API", "--storage", "postgres", "--store", store], io1);
  assert.match(io1.text(), /Created project Shop API/);

  const io2 = fakeIo();
  await runCli(["keys", "issue", "--project", "shop-api", "--store", store], io2);
  assert.match(io2.text(), /bf_live_[0-9a-f]+/);

  const io3 = fakeIo();
  await runCli(["keys", "list", "--store", store], io3);
  assert.match(io3.text(), /active/);
});

test("doctor runs the nine-step smoke and the security scan", async () => {
  // The CLI path reads process.env for the security scan; harden it for the
  // duration so the smoke's health is what decides the exit code.
  const saved = { ...process.env };
  process.env.BLINDFOLD_SECRET = "f3a9c2e1d4b5a697-8a1b2c3d4e5f6071-8293a4b5c6d7e8f9";
  delete process.env.BLINDFOLD_DATABASE_URL;
  delete process.env.NODE_ENV;
  delete process.env.BLINDFOLD_STUDIO_HOST;
  try {
    const io = fakeIo();
    const code = await runCli(["doctor"], io);
    assert.equal(code, 0);
    assert.match(io.text(), /Smoke: \d+\/\d+ checks passed — HEALTHY/);
    assert.match(io.text(), /Security configuration scan/);
    assert.match(io.text(), /Doctor: HEALTHY/);
  } finally {
    process.env = saved;
  }
});

test("help still works and lists the new commands", async () => {
  const io = fakeIo();
  await runCli(["help"], io);
  assert.match(io.text(), /add-auth/);
  assert.match(io.text(), /doctor/);
  assert.match(io.text(), /playground/);
});

test("playground command starts a server (ephemeral port) and reports the url", async () => {
  const io = fakeIo();
  // Use port 0 so the OS assigns a free port; the command logs the bound url.
  const pg = await runCli(["playground", "--port", "0"], io);
  assert.match(io.text(), /Blindfold Playground running at http:\/\//);
  if (pg && typeof pg.close === "function") {
    await pg.close();
  }
});
