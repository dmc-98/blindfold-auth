import { test } from "node:test";
import assert from "node:assert";
import { createMemoryStorage } from "@dmc--98/blindfold-auth";
import { createRiskEngine } from "../src/index.js";
import type { RiskConfig } from "../src/index.js";

function engine(config?: Partial<RiskConfig>) {
  const storage = createMemoryStorage();
  storage.ensureTables();
  return { storage, risk: createRiskEngine({ storage, config }) };
}

const P = "principal_1";
const APP = "app_1";

test("first assessment is baseline low-risk (no step-up)", async () => {
  const { risk } = engine();
  const r = await risk.assess({ principalId: P, applicationId: APP, context: { ip: "1.1.1.1", deviceId: "devA" } });
  assert.equal(r.baseline, true);
  assert.equal(r.level, "low");
  assert.equal(r.requireStepUp, false);
});

test("returning on the same device + IP stays low", async () => {
  const { risk } = engine();
  const ctx = { ip: "1.1.1.1", deviceId: "devA" };
  await risk.assess({ principalId: P, context: ctx, applicationId: APP });
  const r = await risk.assess({ principalId: P, context: { ...ctx, now: Date.now() + 10 * 60_000 }, applicationId: APP });
  assert.equal(r.level, "low");
  assert.equal(r.requireStepUp, false);
});

test("a single new factor (device only) is not enough to force step-up", async () => {
  const { risk } = engine();
  const base = Date.now();
  await risk.assess({ principalId: P, context: { ip: "1.1.1.1", deviceId: "devA", now: base } });
  // same IP, new device, well outside velocity/travel windows
  const r = await risk.assess({ principalId: P, context: { ip: "1.1.1.1", deviceId: "devB", now: base + 30 * 60_000 } });
  assert.equal(r.signals.newDevice, true);
  assert.equal(r.signals.newIp, false);
  assert.equal(r.requireStepUp, false, "30 < stepUp threshold 40");
});

test("new device + new IP crosses the step-up threshold", async () => {
  const { risk } = engine();
  const base = Date.now();
  await risk.assess({ principalId: P, context: { ip: "1.1.1.1", deviceId: "devA", now: base } });
  const r = await risk.assess({ principalId: P, context: { ip: "9.9.9.9", deviceId: "devZ", now: base + 30 * 60_000 } });
  assert.equal(r.signals.newDevice, true);
  assert.equal(r.signals.newIp, true);
  assert.ok(r.score >= 40);
  assert.equal(r.requireStepUp, true);
  assert.equal(r.level, "medium");
});

test("impossible travel: different IP within the travel window flags high risk", async () => {
  const { risk } = engine();
  const base = Date.now();
  await risk.assess({ principalId: P, context: { ip: "1.1.1.1", deviceId: "devA", now: base } });
  const r = await risk.assess({ principalId: P, context: { ip: "2.2.2.2", deviceId: "devA", now: base + 60_000 } });
  assert.equal(r.signals.impossibleTravel, true);
  assert.equal(r.signals.newIp, true);
  assert.ok(r.score >= 60, `score ${r.score}`);
  assert.equal(r.level, "high");
  assert.equal(r.requireStepUp, true);
});

test("velocity: too many assessments in the window trips the signal", async () => {
  const { risk } = engine({ velocityMax: 3, velocityWindowMs: 60_000 });
  const base = Date.now();
  // 3 prior assessments same device/ip within the window
  for (let i = 0; i < 3; i++) {
    await risk.assess({ principalId: P, context: { ip: "1.1.1.1", deviceId: "devA", now: base + i * 1000 } });
  }
  const r = await risk.assess({ principalId: P, context: { ip: "1.1.1.1", deviceId: "devA", now: base + 4000 } });
  assert.equal(r.signals.velocity, true);
});

test("assessments are recorded to risk_events", async () => {
  const { storage, risk } = engine();
  await risk.assess({ principalId: P, context: { ip: "1.1.1.1", deviceId: "devA" } });
  await risk.assess({ principalId: P, context: { ip: "9.9.9.9", deviceId: "devB" } });
  const events = await storage.list("risk_events", { principalId: P });
  assert.equal(events.length, 2);
  assert.ok(events.every((e: any) => e.type === "risk_assessment"));
});

test("enforceStepUp gates until MFA is verified", async () => {
  const { risk } = engine();
  const base = Date.now();
  await risk.assess({ principalId: P, context: { ip: "1.1.1.1", deviceId: "devA", now: base } });
  const high = await risk.assess({ principalId: P, context: { ip: "9.9.9.9", deviceId: "devZ", now: base + 60_000 } });

  const blocked = risk.enforceStepUp(high, { mfaVerified: false });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.action, "step_up_required");

  const allowed = risk.enforceStepUp(high, { mfaVerified: true });
  assert.equal(allowed.ok, true);
});

test("integrates over a live blindfold runtime instance", async () => {
  const { blindfold } = await import("@dmc--98/blindfold-client");
  const client = await blindfold({ project: "risk_demo", secret: "s", storage: "memory" });
  const risk = createRiskEngine({ storage: client.storage });

  await client.setup({
    app: { slug: "app", name: "App" },
    admin: { email: "u@x.com", password: "pw-123456" },
    roles: [{ name: "member", assignToAdmin: true, permissions: [{ resource: "doc", action: "read" }] }]
  });

  // baseline + a suspicious second login share the same real storage as auth
  const first = await risk.assess({ principalId: "u@x.com", context: { ip: "1.1.1.1", deviceId: "d1" } });
  assert.equal(first.requireStepUp, false);
  const second = await risk.assess({ principalId: "u@x.com", context: { ip: "5.5.5.5", deviceId: "d2", now: Date.now() + 60_000 } });
  assert.equal(second.requireStepUp, true);

  const events = await risk.listEvents({ principalId: "u@x.com" });
  assert.equal(events.length, 2);
});
