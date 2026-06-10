import { test } from "node:test";
import assert from "node:assert";
import { createDemoServer } from "../src/server.js";
import { TRUSTED_DEVICE_ID } from "../src/app.js";

async function withServer(fn: (url: string) => Promise<void>): Promise<void> {
  const srv = await createDemoServer({ storage: "memory" });
  const { url } = await srv.listen(0);
  try {
    await fn(url);
  } finally {
    await srv.close();
  }
}

// Trusted-device login: matches the baselined deviceId+IP so risk stays low and
// no step-up is required. Returns the access token directly.
const loginTrusted = async (url: string, email: string): Promise<string> => {
  const r: any = await fetch(url + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-id": TRUSTED_DEVICE_ID, "x-forwarded-for": "10.0.0.1" },
    body: JSON.stringify({ email, password: "password123" })
  }).then((r) => r.json());
  return r.accessToken;
};
const get = (url: string, path: string, token: string): Promise<any> =>
  fetch(url + path, { headers: { authorization: "Bearer " + token } }).then((r) => r.json());

test("admin sees full SSN and can delete (RBAC + ABAC allow)", async () => {
  await withServer(async (url) => {
    const token = await loginTrusted(url, "alice@acme.co");
    assert.ok(token, "admin logs in");
    const data = await get(url, "/api/customers", token);
    assert.equal(data.canDelete, true, "admin canDelete");
    assert.equal(data.ssnEffect, "allow");
    assert.ok(/^\d{3}-\d{2}-\d{4}$/.test(data.customers[0].ssn), "admin sees raw ssn");
    assert.equal(data.customers[0].ssnMasked, false);

    const del = await fetch(url + "/api/customers/" + data.customers[0].id, {
      method: "DELETE",
      headers: { authorization: "Bearer " + token }
    });
    assert.equal(del.status, 200, "admin delete allowed");
  });
});

test("support sees masked SSN and is denied delete (ABAC mask + RBAC deny)", async () => {
  await withServer(async (url) => {
    const token = await loginTrusted(url, "bob@acme.co");
    assert.ok(token, "support logs in");
    const data = await get(url, "/api/customers", token);
    assert.equal(data.canDelete, false, "support cannot delete");
    assert.equal(data.ssnEffect, "mask", "ssn decision is mask");
    assert.equal(data.customers[0].ssnMasked, true);
    assert.ok(data.customers[0].ssn.includes("*"), "support sees masked ssn");
    assert.ok(!/^\d{3}-\d{2}-\d{4}$/.test(data.customers[0].ssn), "raw ssn not exposed");

    const del = await fetch(url + "/api/customers/" + data.customers[0].id, {
      method: "DELETE",
      headers: { authorization: "Bearer " + token }
    });
    assert.equal(del.status, 403, "support delete forbidden");
  });
});

test("unauthenticated requests are rejected", async () => {
  await withServer(async (url) => {
    const r = await fetch(url + "/api/customers");
    assert.equal(r.status, 401);
  });
});

test("the SPA is served at /", async () => {
  await withServer(async (url) => {
    const html = await fetch(url + "/").then((r) => r.text());
    assert.match(html, /Acme Support Console/);
  });
});

// --- M7: dynamic step-up MFA --------------------------------------------------

test("login from a new device requires step-up MFA before issuing a session", async () => {
  await withServer(async (url) => {
    // Untrusted deviceId + untrusted IP → risk engine should require step-up.
    const challenge: any = await fetch(url + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": "fresh-browser-xyz", "x-forwarded-for": "203.0.113.45" },
      body: JSON.stringify({ email: "alice@acme.co", password: "password123" })
    }).then((r) => r.json());

    assert.equal(challenge.mfaRequired, true, "first response is an MFA challenge, not a token");
    assert.equal(typeof challenge.accessToken, "undefined", "no token leaks before MFA");
    assert.ok(challenge.challengeId, "challenge id issued");
    assert.match(challenge.demoCode, /^\d{6}$/, "6-digit demo code surfaced");
    assert.ok(challenge.risk.score >= 40, "risk score crosses step-up threshold");
    assert.ok(challenge.risk.reasons.length > 0, "risk reasons reported");

    // Wrong code is rejected.
    const wrong = await fetch(url + "/auth/mfa/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: challenge.challengeId, code: "000000" })
    });
    assert.equal(wrong.status, 401, "wrong code rejected");

    // Correct code returns the access token.
    const ok: any = await fetch(url + "/auth/mfa/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId: challenge.challengeId, code: challenge.demoCode })
    }).then((r) => r.json());
    assert.ok(ok.accessToken, "session issued after MFA verify");
    assert.equal(ok.mfaVerified, true);

    // Token works against the protected API.
    const me = await get(url, "/api/me", ok.accessToken);
    assert.equal(me.email, "alice@acme.co");
  });
});
