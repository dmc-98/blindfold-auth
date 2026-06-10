import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chromium } from "playwright";
import { createAuth, createMemoryStorage, getTotpCode } from "@blindfold/auth";
import { startStudio } from "@blindfold/auth-studio";

function json(statusCode: number, payload: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload, null, 2)
  };
}

function html(body: string) {
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body
  };
}

function send(nodeResponse: ServerResponse, response: any) {
  nodeResponse.writeHead(response.statusCode ?? 200, response.headers || {});
  nodeResponse.end(response.body ?? "");
}

async function readJson(request: IncomingMessage) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;
  }

  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function closeServer(server: any) {
  return new Promise<void>((resolve, reject) => {
    server.close((error: any) => (error ? reject(error) : resolve()));
  });
}

function maybeSkipForSandbox(t: any, error: any) {
  if (error?.code === "EPERM" || error?.code === "EACCES") {
    t.skip(`Socket binding is blocked in this environment: ${error.code}`);
    return true;
  }

  return false;
}

export async function launchBrowser(t: any) {
  try {
    return await chromium.launch({
      headless: true,
      args: ["--no-sandbox"]
    });
  } catch (error) {
    const message = String((error as Error)?.message || error);
    if (message.includes("Executable doesn't exist") || message.includes("Please run the following command")) {
      t.skip("Playwright Chromium is not installed. Run `npm run playwright:install`.");
      return null;
    }

    throw error;
  }
}

export async function attachVirtualAuthenticator(page: any) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true
    }
  });

  return {
    client,
    authenticatorId,
    async close() {
      try {
        await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
      } catch {}
      try {
        await client.detach();
      } catch {}
    }
  };
}

function createRuntimeHtml({ applicationId, financeEmail, mfaEmail, oidcEmail, samlEmail }: any) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Blindfold Runtime Playground</title>
    <style>
      body {
        font-family: ui-sans-serif, system-ui, sans-serif;
        margin: 0;
        background: #f8f6f2;
        color: #1f1713;
      }
      main {
        width: min(1120px, calc(100vw - 32px));
        margin: 24px auto 48px;
        display: grid;
        gap: 16px;
      }
      .card {
        background: white;
        border: 1px solid #e8ddd4;
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 16px 40px rgba(44, 26, 17, 0.08);
      }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      }
      form {
        display: grid;
        gap: 10px;
      }
      label {
        display: grid;
        gap: 6px;
        font-size: 0.95rem;
      }
      input, button {
        font: inherit;
      }
      input {
        padding: 10px 12px;
        border-radius: 12px;
        border: 1px solid #d8cabd;
      }
      button {
        padding: 10px 12px;
        border: none;
        border-radius: 12px;
        background: #2d1e18;
        color: white;
        cursor: pointer;
      }
      button.secondary {
        background: #d67a4d;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        background: #f7efe9;
        border-radius: 12px;
        padding: 12px;
        min-height: 72px;
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <h1>Blindfold Runtime Playground</h1>
        <p id="sessionState">No active session.</p>
        <p>Application id: <strong id="applicationId">${applicationId}</strong></p>
      </section>

      <section class="grid">
        <div class="card" id="passwordCard">
          <h2>Password Login</h2>
          <form id="loginForm">
            <label>Email <input id="loginEmail" name="email" value="${financeEmail}" /></label>
            <label>Password <input id="loginPassword" name="password" type="password" value="demo-password-123" /></label>
            <label>MFA Code <input id="loginMfaCode" name="mfaCode" placeholder="Only for MFA login" /></label>
            <button type="submit" id="loginButton">Login</button>
          </form>
          <div class="toolbar" style="margin-top: 12px;">
            <button type="button" id="loadTotpButton" class="secondary">Load current TOTP</button>
            <button type="button" id="useMfaProfileButton" class="secondary">Use MFA profile</button>
            <button type="button" id="useFinanceProfileButton" class="secondary">Use finance profile</button>
          </div>
        </div>

        <div class="card" id="passkeyCard">
          <h2>Magic Link</h2>
          <form id="magicLinkForm">
            <label>Email <input id="magicEmail" name="email" value="${financeEmail}" /></label>
            <button type="submit" id="requestMagicLinkButton">Request magic link</button>
          </form>
          <div class="toolbar" style="margin-top: 12px;">
            <button type="button" id="consumeMagicLinkButton" class="secondary">Consume latest magic link</button>
            <button type="button" id="passkeyEnrollButton">Enroll passkey from session</button>
            <button type="button" id="passkeyLoginButton" class="secondary">Sign in with passkey</button>
          </div>
        </div>

        <div class="card" id="federationCard">
          <h2>Enterprise Federation</h2>
          <form id="federationForm">
            <label>Email <input id="federationEmail" name="email" value="${oidcEmail}" /></label>
          </form>
          <div class="toolbar">
            <button type="button" id="oidcButton">Sign in with OIDC</button>
            <button type="button" id="samlButton" class="secondary">Sign in with SAML</button>
            <button type="button" id="useOidcProfileButton" class="secondary">Use OIDC profile</button>
            <button type="button" id="useSamlProfileButton" class="secondary">Use SAML profile</button>
          </div>
        </div>

        <div class="card" id="sessionActionsCard">
          <h2>Session Actions</h2>
          <div class="toolbar">
            <button type="button" id="refreshSessionButton">Refresh session</button>
            <button type="button" id="logoutButton" class="secondary">Logout</button>
          </div>
          <div class="toolbar" style="margin-top: 12px;">
            <button type="button" id="maskedRouteButton">Read masked invoice field</button>
            <button type="button" id="denyRouteButton" class="secondary">Try denied action</button>
          </div>
        </div>
      </section>

      <section class="grid">
        <div class="card">
          <h2>Auth Output</h2>
          <pre id="authOutput">No auth action yet.</pre>
        </div>
        <div class="card">
          <h2>Magic Link Output</h2>
          <pre id="magicLinkOutput">No magic link action yet.</pre>
        </div>
        <div class="card">
          <h2>Federation Output</h2>
          <pre id="federationOutput">No federation action yet.</pre>
        </div>
        <div class="card">
          <h2>Protected Output</h2>
          <pre id="protectedOutput">No protected route action yet.</pre>
        </div>
      </section>
    </main>

    <script>
      const state = {
        applicationId: ${JSON.stringify(applicationId)},
        financeEmail: ${JSON.stringify(financeEmail)},
        mfaEmail: ${JSON.stringify(mfaEmail)},
        oidcEmail: ${JSON.stringify(oidcEmail)},
        samlEmail: ${JSON.stringify(samlEmail)},
        accessToken: null,
        refreshToken: null,
        latestMagicToken: null
      };

      const sessionState = document.getElementById("sessionState");
      const authOutput = document.getElementById("authOutput");
      const magicLinkOutput = document.getElementById("magicLinkOutput");
      const federationOutput = document.getElementById("federationOutput");
      const protectedOutput = document.getElementById("protectedOutput");
      const loginEmail = document.getElementById("loginEmail");
      const loginPassword = document.getElementById("loginPassword");
      const loginMfaCode = document.getElementById("loginMfaCode");
      const magicEmail = document.getElementById("magicEmail");
      const federationEmail = document.getElementById("federationEmail");

      function updateSessionState() {
        sessionState.textContent = state.accessToken
          ? "Active session is loaded in the browser playground."
          : "No active session.";
      }

      function write(node, value) {
        node.textContent = JSON.stringify(value, null, 2);
      }

      function base64UrlToBytes(value) {
        const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
        const binary = atob(padded);
        return Uint8Array.from(binary, (char) => char.charCodeAt(0));
      }

      function bytesToBase64Url(value) {
        const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
        let binary = "";
        for (const byte of bytes) {
          binary += String.fromCharCode(byte);
        }
        return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
      }

      function prepareRegistrationOptions(options) {
        return {
          ...options,
          challenge: base64UrlToBytes(options.challenge),
          user: {
            ...options.user,
            id: base64UrlToBytes(options.user.id)
          },
          excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
            ...credential,
            id: base64UrlToBytes(credential.id)
          }))
        };
      }

      function serializeRegistrationCredential(credential) {
        return {
          id: credential.id,
          rawId: bytesToBase64Url(credential.rawId),
          type: credential.type,
          response: {
            clientDataJSON: bytesToBase64Url(credential.response.clientDataJSON),
            attestationObject: bytesToBase64Url(credential.response.attestationObject),
            transports: credential.response.getTransports ? credential.response.getTransports() : []
          },
          clientExtensionResults: credential.getClientExtensionResults()
        };
      }

      function prepareAuthenticationOptions(options) {
        return {
          ...options,
          challenge: base64UrlToBytes(options.challenge),
          allowCredentials: (options.allowCredentials || []).map((credential) => ({
            ...credential,
            id: base64UrlToBytes(credential.id)
          }))
        };
      }

      function serializeAuthenticationCredential(credential) {
        return {
          id: credential.id,
          rawId: bytesToBase64Url(credential.rawId),
          type: credential.type,
          response: {
            clientDataJSON: bytesToBase64Url(credential.response.clientDataJSON),
            authenticatorData: bytesToBase64Url(credential.response.authenticatorData),
            signature: bytesToBase64Url(credential.response.signature),
            userHandle: credential.response.userHandle ? bytesToBase64Url(credential.response.userHandle) : null
          },
          clientExtensionResults: credential.getClientExtensionResults()
        };
      }

      async function request(path, method = "GET", body, authenticated = false) {
        const headers = { "content-type": "application/json" };
        if (authenticated && state.accessToken) {
          headers.authorization = "Bearer " + state.accessToken;
        }

        const response = await fetch(path, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined
        });
        const payload = await response.json();
        return { status: response.status, payload };
      }

      function applySession(result, node) {
        if (result.status === 200 && result.payload.accessToken) {
          state.accessToken = result.payload.accessToken;
          state.refreshToken = result.payload.refreshToken;
        }
        updateSessionState();
        write(node, result);
      }

      document.getElementById("useFinanceProfileButton").addEventListener("click", () => {
        loginEmail.value = state.financeEmail;
        loginPassword.value = "demo-password-123";
        loginMfaCode.value = "";
      });

      document.getElementById("useMfaProfileButton").addEventListener("click", () => {
        loginEmail.value = state.mfaEmail;
        loginPassword.value = "mfa-password-123";
        loginMfaCode.value = "";
      });

      document.getElementById("useOidcProfileButton").addEventListener("click", () => {
        federationEmail.value = state.oidcEmail;
      });

      document.getElementById("useSamlProfileButton").addEventListener("click", () => {
        federationEmail.value = state.samlEmail;
      });

      document.getElementById("loadTotpButton").addEventListener("click", async () => {
        const result = await request("/test/totp-code");
        loginMfaCode.value = result.payload.code || "";
        write(authOutput, result);
      });

      document.getElementById("loginForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = await request("/auth/login", "POST", {
          applicationId: state.applicationId,
          email: loginEmail.value,
          password: loginPassword.value,
          mfaCode: loginMfaCode.value || undefined
        });
        applySession(result, authOutput);
      });

      document.getElementById("magicLinkForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = await request("/auth/request-magic-link", "POST", {
          applicationId: state.applicationId,
          email: magicEmail.value,
          redirectTo: "/runtime"
        });
        if (result.status === 200) {
          state.latestMagicToken = result.payload.token;
        }
        write(magicLinkOutput, result);
      });

      document.getElementById("consumeMagicLinkButton").addEventListener("click", async () => {
        const result = await request("/auth/consume-magic-link", "POST", {
          applicationId: state.applicationId,
          token: state.latestMagicToken
        });
        applySession(result, authOutput);
        write(magicLinkOutput, result);
      });

      document.getElementById("passkeyEnrollButton").addEventListener("click", async () => {
        const begin = await request(
          "/auth/passkeys/begin-registration",
          "POST",
          {
            applicationId: state.applicationId,
            nickname: "Browser Passkey"
          },
          true
        );
        if (begin.status !== 200) {
          write(authOutput, begin);
          return;
        }

        const credential = await navigator.credentials.create({
          publicKey: prepareRegistrationOptions(begin.payload.options)
        });
        const finish = await request(
          "/auth/passkeys/finish-registration",
          "POST",
          {
            applicationId: state.applicationId,
            challengeId: begin.payload.challengeId,
            response: serializeRegistrationCredential(credential)
          },
          true
        );
        write(authOutput, finish);
      });

      document.getElementById("passkeyLoginButton").addEventListener("click", async () => {
        const begin = await request("/auth/passkeys/begin-authentication", "POST", {
          applicationId: state.applicationId
        });
        if (begin.status !== 200) {
          write(authOutput, begin);
          return;
        }

        const credential = await navigator.credentials.get({
          publicKey: prepareAuthenticationOptions(begin.payload.options)
        });
        const finish = await request("/auth/passkeys/finish-authentication", "POST", {
          applicationId: state.applicationId,
          challengeId: begin.payload.challengeId,
          response: serializeAuthenticationCredential(credential)
        });
        applySession(finish, authOutput);
      });

      async function runFederation(protocol) {
        const start = await request("/auth/" + protocol + "/start", "POST", {
          applicationId: state.applicationId,
          email: federationEmail.value
        });
        write(federationOutput, start);
        if (start.status !== 200 || !start.payload.demoCallback) {
          return;
        }

        const finish = await request("/auth/" + protocol + "/callback", "POST", start.payload.demoCallback);
        applySession(finish, authOutput);
        write(federationOutput, finish);
      }

      document.getElementById("oidcButton").addEventListener("click", async () => {
        await runFederation("oidc");
      });

      document.getElementById("samlButton").addEventListener("click", async () => {
        await runFederation("saml");
      });

      document.getElementById("refreshSessionButton").addEventListener("click", async () => {
        const result = await request("/auth/refresh", "POST", {
          refreshToken: state.refreshToken
        });
        applySession(result, authOutput);
      });

      document.getElementById("logoutButton").addEventListener("click", async () => {
        const result = await request("/auth/logout", "POST", {
          refreshToken: state.refreshToken
        });
        state.accessToken = null;
        state.refreshToken = null;
        updateSessionState();
        write(authOutput, result);
      });

      document.getElementById("maskedRouteButton").addEventListener("click", async () => {
        write(protectedOutput, await request("/protected/masked", "GET", null, true));
      });

      document.getElementById("denyRouteButton").addEventListener("click", async () => {
        write(protectedOutput, await request("/protected/delete", "GET", null, true));
      });

      updateSessionState();
    </script>
  </body>
</html>`;
}

async function startRuntimeServer({ auth, application, financeEmail, mfaEmail, oidcEmail, samlEmail, mfaSecret }: any) {
  const maskedHandler = auth.protect(
    {
      applicationId: application.id,
      resource: "invoice",
      action: "read",
      field: "internalNotes"
    },
    async ({ decision, subject }: any) =>
      json(200, {
        principalEmail: subject.email,
        effect: decision.effect,
        obligations: decision.obligations,
        matchedRuleIds: decision.matchedRuleIds
      })
  );

  const denyHandler = auth.protect(
    {
      applicationId: application.id,
      resource: "invoice",
      action: "delete"
    },
    async ({ decision, subject }: any) =>
      json(200, {
        principalEmail: subject.email,
        effect: decision.effect,
        obligations: decision.obligations,
        matchedRuleIds: decision.matchedRuleIds
      })
  );

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url!, "http://127.0.0.1");

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return send(
          response,
          html(
            createRuntimeHtml({
              applicationId: application.id,
              financeEmail,
              mfaEmail,
              oidcEmail,
              samlEmail
            })
          )
        );
      }

      if (request.method === "GET" && url.pathname === "/test/totp-code") {
        return send(response, json(200, { code: getTotpCode(mfaSecret) }));
      }

      if (request.method === "POST" && url.pathname === "/auth/login") {
        return send(response, await auth.handlers.login()({ body: await readJson(request) }));
      }

      if (request.method === "POST" && url.pathname === "/auth/request-magic-link") {
        return send(response, await auth.handlers.requestMagicLink()({ body: await readJson(request) }));
      }

      if (request.method === "POST" && url.pathname === "/auth/consume-magic-link") {
        return send(response, await auth.handlers.consumeMagicLink()({ body: await readJson(request) }));
      }

      if (request.method === "POST" && url.pathname === "/auth/passkeys/begin-registration") {
        return send(
          response,
          await auth.handlers.passkeys.beginRegistration()({
            body: await readJson(request),
            headers: request.headers
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/auth/passkeys/finish-registration") {
        return send(
          response,
          await auth.handlers.passkeys.finishRegistration()({
            body: await readJson(request),
            headers: request.headers
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/auth/passkeys/begin-authentication") {
        return send(
          response,
          await auth.handlers.passkeys.beginAuthentication()({
            body: await readJson(request),
            headers: request.headers
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/auth/passkeys/finish-authentication") {
        return send(
          response,
          await auth.handlers.passkeys.finishAuthentication()({
            body: await readJson(request),
            headers: request.headers
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/auth/oidc/start") {
        return send(
          response,
          await auth.handlers.oidc.start()({
            body: await readJson(request),
            headers: request.headers
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/auth/oidc/callback") {
        return send(
          response,
          await auth.handlers.oidc.callback()({
            body: await readJson(request),
            headers: request.headers
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/auth/saml/start") {
        return send(
          response,
          await auth.handlers.saml.start()({
            body: await readJson(request),
            headers: request.headers
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/auth/saml/callback") {
        return send(
          response,
          await auth.handlers.saml.callback()({
            body: await readJson(request),
            headers: request.headers
          })
        );
      }

      if (request.method === "GET" && url.pathname === "/auth/saml/metadata") {
        return send(
          response,
          await auth.handlers.saml.metadata()({
            query: Object.fromEntries(url.searchParams.entries()),
            headers: request.headers
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/auth/refresh") {
        return send(response, await auth.handlers.refresh()({ body: await readJson(request) }));
      }

      if (request.method === "POST" && url.pathname === "/auth/logout") {
        return send(response, await auth.handlers.logout()({ body: await readJson(request) }));
      }

      if (request.method === "GET" && url.pathname === "/protected/masked") {
        return send(
          response,
          await maskedHandler({
            headers: request.headers,
            method: request.method,
            path: url.pathname
          })
        );
      }

      if (request.method === "GET" && url.pathname === "/protected/delete") {
        return send(
          response,
          await denyHandler({
            headers: request.headers,
            method: request.method,
            path: url.pathname
          })
        );
      }

      return send(response, json(404, { error: "not found" }));
    } catch (error) {
      return send(response, json(500, { error: (error as Error).message }));
    }
  });

  return new Promise<any>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address: any = server.address();
      assert.equal(typeof address, "object");
      resolve({
        server,
        url: `http://localhost:${address.port}`
      });
    });
  });
}

export async function createHarness(t: any) {
  const auth = createAuth({
    workspaceId: `workspace_e2e_${Date.now()}`,
    secret: "blindfold-e2e-secret",
    storage: createMemoryStorage(),
    security: {
      magicLinks: {
        returnTokenInResponse: true
      }
    }
  });

  await auth.admin.bootstrapWorkspace({
    name: "Blindfold E2E Workspace",
    defaults: {
      mfa: { required: false }
    }
  });

  const application = await auth.admin.applications.create({
    slug: "billing-app",
    name: "Billing App",
    description: "E2E runtime workspace"
  });

  const role = await auth.admin.roles.create({
    applicationId: application.id,
    name: "finance_admin",
    description: "Reads invoices"
  });
  const enterpriseRole = await auth.admin.roles.create({
    applicationId: application.id,
    name: "enterprise_member",
    description: "Default role for JIT-provisioned federation users"
  });

  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: role.id,
    resource: "invoice",
    action: "read"
  });
  await auth.admin.roles.grantPermission({
    applicationId: application.id,
    roleId: enterpriseRole.id,
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

  const financePrincipal = await auth.admin.principals.create({
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    password: "demo-password-123",
    attributes: {
      department: "finance",
      region: "eu"
    }
  });

  await auth.admin.memberships.assignRole({
    principalId: financePrincipal.id,
    applicationId: application.id,
    roleId: role.id
  });

  const mfaPrincipal = await auth.admin.principals.create({
    displayName: "Grace Hopper",
    email: "grace@example.com",
    password: "mfa-password-123",
    attributes: {
      department: "finance",
      region: "us"
    }
  });

  await auth.admin.memberships.assignRole({
    principalId: mfaPrincipal.id,
    applicationId: application.id,
    roleId: role.id
  });

  const oidcProvider = await auth.admin.identityProviders.create({
    key: "okta-shared",
    name: "Okta Shared",
    type: "oidc",
    mode: "demo",
    issuer: "https://blindfold.okta.example.com/oauth2/default",
    authorizationUrl: "https://blindfold.okta.example.com/oauth2/v1/authorize",
    clientId: "okta-client-id",
    claimMappings: {
      subject: "sub",
      email: "email",
      displayName: "name"
    }
  });

  const samlProvider = await auth.admin.identityProviders.create({
    key: "entra-shared",
    name: "Entra Shared",
    type: "saml",
    mode: "demo",
    issuer: "https://sts.windows.net/demo-tenant/",
    ssoUrl: "https://login.microsoftonline.com/demo-tenant/saml2",
    claimMappings: {
      subject: "sub",
      email: "email",
      displayName: "name"
    },
    x509Certificate: "MIICdzCCAhCgAwIBAgIBADANBgkqhkiG9w0BAQsFADBvMQswCQYDVQQGEwJVUzELMAkGA1UECAwCQ0ExFDASBgNVBAcMC0xvcyBBbmdlbGVzMRcwFQYDVQQKDA5CbGluZGZvbGQgRGVtbzEYMBYGA1UEAwwPQmxpbmRmb2xkIFNhbWwwHhcNMjYwMTAxMDAwMDAwWhcNMzYwMTAxMDAwMDAwWjBvMQswCQYDVQQGEwJVUzELMAkGA1UECAwCQ0ExFDASBgNVBAcMC0xvcyBBbmdlbGVzMRcwFQYDVQQKDA5CbGluZGZvbGQgRGVtbzEYMBYGA1UEAwwPQmxpbmRmb2xkIFNhbWwwDQYJKoZIhvcNAQEBBQADgY0AMIGJAoGBALaunchDemoCertificatep9d1f3g5h7j9k1m3n5p7q9rAgMBAAEwDQYJKoZIhvcNAQELBQADgYEAhwX0demoXxW6t8q3b9m4c1w7u2x5p8n4a1s6d9f2g5h8j1k4l7m0n3p6q9r2t5v8y1z4a7c0e3g6i9k2m5o8q1s4u7w0y3"
  });

  await auth.admin.applicationProviders.bind({
    applicationId: application.id,
    providerId: oidcProvider.id,
    domains: ["okta.example.com"],
    defaultRoleIds: [enterpriseRole.id],
    clientId: "okta-client-id"
  });

  await auth.admin.applicationProviders.bind({
    applicationId: application.id,
    providerId: samlProvider.id,
    domains: ["entra.example.com"],
    defaultRoleIds: [enterpriseRole.id],
    allowIdpInitiated: true,
    entityId: "blindfold-e2e-saml-sp"
  });

  const totpSetup = await auth.admin.principals.enableTotp({ principalId: mfaPrincipal.id });
  await auth.admin.principals.confirmTotp({
    principalId: mfaPrincipal.id,
    code: totpSetup.currentCode
  });

  let studio;
  try {
    studio = await startStudio({ auth, port: 0 });
  } catch (error) {
    if (maybeSkipForSandbox(t, error)) {
      return null;
    }

    throw error;
  }

  let runtime;
  try {
    runtime = await startRuntimeServer({
      auth,
      application,
      financeEmail: financePrincipal.email,
      mfaEmail: mfaPrincipal.email,
      oidcEmail: "jordan@okta.example.com",
      samlEmail: "taylor@entra.example.com",
      mfaSecret: totpSetup.secret
    });
  } catch (error) {
    await closeServer(studio.server).catch(() => {});
    if (maybeSkipForSandbox(t, error)) {
      return null;
    }

    throw error;
  }

  return {
    auth,
    application,
    financePrincipal,
    mfaPrincipal,
    role,
    enterpriseRole,
    studio,
    runtime,
    async close() {
      await closeServer(runtime.server).catch(() => {});
      await closeServer(studio.server).catch(() => {});
    }
  };
}

export async function waitForText(page: any, selector: string, text: string) {
  await page.waitForFunction(
    ({ selector: currentSelector, text: currentText }: any) =>
      document.querySelector(currentSelector)?.textContent?.includes(currentText),
    { selector, text }
  );
}

export async function readJsonFromPre(page: any, selector: string) {
  const value = await page.locator(selector).textContent();
  return JSON.parse(value || "null");
}
