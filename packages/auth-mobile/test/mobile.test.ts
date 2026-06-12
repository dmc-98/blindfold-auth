import test from "node:test";
import assert from "node:assert/strict";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
// @ts-ignore — @dmc--98/blindfold-auth is plain JS.
import * as authPkg from "@dmc--98/blindfold-auth";
import { createMobileClient, generatePkcePair, createMemoryTokenStore, MOBILE_VERSION } from "../src/index.js";

const createAuth = (authPkg as any).createAuth as (opts: any) => any;
const createMemoryStorage = (authPkg as any).createMemoryStorage as () => any;

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}
function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization || "";
  const [scheme, token] = String(h).split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

async function startTestServer() {
  const auth = createAuth({ workspaceId: "mobile_test_ws", secret: "mobile-secret", storage: createMemoryStorage() });
  await auth.admin.bootstrapWorkspace({ name: "Mobile WS" });
  const app = await auth.admin.applications.create({ slug: "mobile-app", name: "Mobile App" });
  const role = await auth.admin.roles.create({ applicationId: app.id, name: "member" });
  await auth.admin.roles.grantPermission({ applicationId: app.id, roleId: role.id, resource: "workspace", action: "read" });
  const user = await auth.admin.principals.create({ email: "mobile@acme.co", password: "pw-correct-horse", displayName: "Mobile User" });
  await auth.admin.memberships.assignRole({ principalId: user.id, applicationId: app.id, roleId: role.id });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://x");
      if (req.method === "POST" && url.pathname === "/auth/login") {
        const body = await readJson(req);
        const r = await auth.handlers.login()({ body: { applicationId: app.id, email: body.email, password: body.password } });
        return send(res, r.statusCode, JSON.parse(r.body));
      }
      if (req.method === "POST" && url.pathname === "/auth/refresh") {
        const body = await readJson(req);
        const r = await auth.handlers.refresh()({ body });
        return send(res, r.statusCode, JSON.parse(r.body));
      }
      if (req.method === "POST" && url.pathname === "/auth/logout") {
        const body = await readJson(req);
        const r = await auth.handlers.logout()({ body });
        return send(res, r.statusCode, JSON.parse(r.body));
      }
      if (req.method === "GET" && url.pathname === "/api/me") {
        const token = bearer(req);
        if (!token) return send(res, 401, { error: "missing bearer" });
        const v = await auth.session.verify({ accessToken: token });
        if (!v.ok) return send(res, 401, { error: v.reason });
        return send(res, 200, { id: v.principal.id, email: v.principal.email });
      }
      return send(res, 404, { error: "not found" });
    } catch (e) {
      return send(res, 500, { error: (e as Error).message });
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    auth,
    close: () => new Promise<void>((r) => server.close(() => r()))
  };
}

test("version is exposed", () => {
  assert.equal(MOBILE_VERSION, "1.0.0-rc.1");
});

test("generatePkcePair returns an RFC-7636 S256 verifier+challenge", () => {
  const a = generatePkcePair();
  const b = generatePkcePair();
  assert.equal(a.codeChallengeMethod, "S256");
  // 32 bytes base64url -> 43 chars, no padding.
  assert.match(a.codeVerifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(a.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.codeVerifier, b.codeVerifier, "verifiers are random");
});

test("memory token store round-trips and clears", async () => {
  const s = createMemoryTokenStore();
  assert.equal(await s.read(), null);
  await s.write({ accessToken: "a", refreshToken: "r" });
  assert.deepEqual(await s.read(), { accessToken: "a", refreshToken: "r" });
  await s.clear();
  assert.equal(await s.read(), null);
});

test("login → /api/me → refresh → logout against a real auth server", async () => {
  const srv = await startTestServer();
  try {
    const client = createMobileClient({ baseUrl: srv.url, deviceId: "ios-test-device" });
    const session = await client.login({ email: "mobile@acme.co", password: "pw-correct-horse" });
    assert.ok(session.accessToken);
    assert.ok(session.refreshToken);

    const me = await client.fetch<{ email: string }>("/api/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.email, "mobile@acme.co");

    const before = await client.getTokens();
    const rotated = await client.refresh();
    assert.notEqual(rotated.accessToken, before?.accessToken, "access token rotates");
    assert.notEqual(rotated.refreshToken, before?.refreshToken, "refresh token rotates");

    // After logout the store is cleared.
    await client.logout();
    assert.equal(await client.getTokens(), null);
  } finally {
    await srv.close();
  }
});

test("login throws an MfaRequired error when the server returns a step-up challenge", async () => {
  const url = "http://127.0.0.1:1"; // unreachable — we'll stub fetch
  const client = createMobileClient({
    baseUrl: url,
    deviceId: "ios",
    fetchImpl: (async () => new Response(JSON.stringify({ mfaRequired: true, challengeId: "ch_1", demoCode: "123456" }), {
      status: 200, headers: { "content-type": "application/json" }
    })) as unknown as typeof fetch
  });
  await assert.rejects(
    () => client.login({ email: "x@y", password: "z" }),
    (err: any) => err.mfaRequired === true && err.challengeId === "ch_1"
  );
});

test("fetch auto-refreshes once on 401 if a refresh token is stored", async () => {
  const calls: { path: string; auth?: string }[] = [];
  let accessSeq = 1;
  const fakeFetch: typeof fetch = (async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const auth = (init.headers || {}).authorization as string | undefined;
    calls.push({ path, auth });
    if (path === "/auth/login") {
      return new Response(JSON.stringify({ accessToken: "access-1", refreshToken: "refresh-1" }), { status: 200 });
    }
    if (path === "/auth/refresh") {
      accessSeq++;
      return new Response(JSON.stringify({ accessToken: `access-${accessSeq}`, refreshToken: `refresh-${accessSeq}` }), { status: 200 });
    }
    if (path === "/api/me") {
      if (auth === "Bearer access-1") return new Response(JSON.stringify({ error: "expired" }), { status: 401 });
      return new Response(JSON.stringify({ ok: true, used: auth }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;

  const client = createMobileClient({ baseUrl: "http://x", deviceId: "d", fetchImpl: fakeFetch });
  await client.login({ email: "a@b", password: "p" });
  const res = await client.fetch<{ ok: boolean; used: string }>("/api/me");
  assert.equal(res.status, 200);
  assert.equal(res.data.used, "Bearer access-2", "second attempt uses rotated token");
  const meCalls = calls.filter((c) => c.path === "/api/me");
  assert.equal(meCalls.length, 2, "exactly one auto-retry");
});
