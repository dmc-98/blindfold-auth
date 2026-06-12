import { createServer, IncomingMessage, ServerResponse } from "node:http";

interface StudioResponse {
  statusCode?: number;
  headers?: Record<string, any>;
  body?: string;
}

function json(statusCode: number, payload: any): StudioResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload, null, 2)
  };
}

function html(body: string): StudioResponse {
  return {
    statusCode: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body
  };
}

async function readJson(request: IncomingMessage): Promise<any> {
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

function send(nodeResponse: ServerResponse, response: StudioResponse): void {
  nodeResponse.writeHead(response.statusCode ?? 200, response.headers || {});
  nodeResponse.end(response.body ?? "");
}

function createStudioHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Blindfold Studio</title>
    <style>
      :root {
        --bg: #f7f1e6;
        --paper: rgba(255, 250, 241, 0.94);
        --ink: #221714;
        --muted: #6f5a52;
        --accent: #aa4b2f;
        --accent-soft: #f0c4a6;
        --line: rgba(34, 23, 20, 0.14);
        --card-shadow: 0 20px 45px rgba(77, 43, 28, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Avenir Next", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top right, rgba(240, 196, 166, 0.55), transparent 28%),
          radial-gradient(circle at left, rgba(170, 75, 47, 0.12), transparent 22%),
          linear-gradient(180deg, #fff8ef 0%, var(--bg) 100%);
      }

      .shell {
        width: min(1200px, calc(100vw - 32px));
        margin: 24px auto 48px;
      }

      .hero {
        padding: 28px;
        border-radius: 28px;
        background: linear-gradient(135deg, rgba(255, 245, 232, 0.96), rgba(246, 221, 203, 0.92));
        box-shadow: var(--card-shadow);
        position: relative;
        overflow: hidden;
      }

      .hero::after {
        content: "";
        position: absolute;
        inset: auto -40px -50px auto;
        width: 240px;
        height: 240px;
        border-radius: 999px;
        background: rgba(170, 75, 47, 0.12);
        filter: blur(8px);
      }

      h1, h2 {
        margin: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", ui-serif, serif;
        font-weight: 700;
        letter-spacing: -0.03em;
      }

      h1 {
        font-size: clamp(2rem, 5vw, 3.4rem);
      }

      .hero p {
        max-width: 820px;
        color: var(--muted);
        margin: 14px 0 0;
        font-size: 1.02rem;
        line-height: 1.6;
      }

      .grid {
        display: grid;
        gap: 18px;
        margin-top: 22px;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }

      .card {
        background: var(--paper);
        border: 1px solid var(--line);
        border-radius: 22px;
        box-shadow: var(--card-shadow);
        padding: 20px;
      }

      .card h2 {
        font-size: 1.35rem;
        margin-bottom: 10px;
      }

      .metric {
        font-size: 2.1rem;
        font-weight: 700;
        letter-spacing: -0.04em;
      }

      .muted {
        color: var(--muted);
      }

      .workspace {
        display: grid;
        gap: 18px;
        grid-template-columns: 1.1fr 0.9fr;
        margin-top: 22px;
      }

      .forms {
        display: grid;
        gap: 16px;
      }

      form {
        display: grid;
        gap: 10px;
      }

      input, textarea, select, button {
        font: inherit;
      }

      input, textarea, select {
        width: 100%;
        padding: 11px 12px;
        border-radius: 14px;
        border: 1px solid rgba(34, 23, 20, 0.16);
        background: rgba(255, 255, 255, 0.9);
        color: var(--ink);
      }

      textarea {
        min-height: 100px;
        resize: vertical;
      }

      button {
        padding: 11px 14px;
        border: none;
        border-radius: 14px;
        background: var(--ink);
        color: white;
        cursor: pointer;
        font-weight: 600;
      }

      button.secondary {
        background: rgba(34, 23, 20, 0.1);
        color: var(--ink);
      }

      .stack {
        display: grid;
        gap: 14px;
      }

      .list {
        display: grid;
        gap: 12px;
      }

      .list-item {
        padding: 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.84);
        border: 1px solid rgba(34, 23, 20, 0.08);
      }

      .list-item strong {
        display: block;
        margin-bottom: 4px;
      }

      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "SFMono-Regular", "Menlo", monospace;
        font-size: 0.86rem;
        line-height: 1.55;
      }

      .toolbar {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 18px;
      }

      .status {
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.8);
        border: 1px solid rgba(34, 23, 20, 0.08);
      }

      @media (max-width: 960px) {
        .workspace {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <h1>Blindfold Studio</h1>
        <p>Local-first auth management for teams that want sessions, policies, users, and audit events to stay inside their own system. This Studio talks directly to your embedded runtime instead of a hosted control plane.</p>
        <div class="toolbar">
          <button id="refreshButton">Refresh Snapshot</button>
          <button id="bootstrapButton" class="secondary">Bootstrap Workspace</button>
          <div class="status" id="statusBox">Studio ready.</div>
        </div>
      </section>

      <section class="grid" id="metrics"></section>

      <section class="workspace">
        <div class="forms stack">
          <div class="card" id="applicationCard">
            <h2>Create Application</h2>
            <form id="applicationForm">
              <input name="slug" placeholder="billing-app" required />
              <input name="name" placeholder="Billing App" required />
              <textarea name="description" placeholder="What this app needs from auth"></textarea>
              <button type="submit">Create application</button>
            </form>
          </div>

          <div class="card" id="principalCard">
            <h2>Create Principal</h2>
            <form id="principalForm">
              <input name="displayName" placeholder="Ada Lovelace" required />
              <input name="email" placeholder="ada@example.com" required />
              <input name="password" type="password" placeholder="Strong password" required />
              <textarea name="attributes" placeholder='{"department":"finance","region":"eu"}'></textarea>
              <button type="submit">Create principal</button>
            </form>
          </div>

          <div class="card" id="identityProviderCard">
            <h2>Shared Identity Provider</h2>
            <form id="identityProviderForm">
              <input name="key" placeholder="okta-workforce" required />
              <input name="name" placeholder="Okta Workforce" required />
              <select name="mode">
                <option value="live">live</option>
                <option value="demo">demo</option>
              </select>
              <select name="type">
                <option value="oidc">oidc</option>
                <option value="saml">saml</option>
              </select>
              <input name="issuer" placeholder="https://example.okta.com" />
              <input name="discoveryUrl" placeholder="https://example.okta.com/.well-known/openid-configuration" />
              <input name="authorizationUrl" placeholder="https://example.okta.com/oauth2/v1/authorize" />
              <input name="ssoUrl" placeholder="https://login.microsoftonline.com/.../saml2" />
              <input name="clientId" placeholder="client id" />
              <select name="allowInsecureDiscovery">
                <option value="false">https_only</option>
                <option value="true">allow_http_local</option>
              </select>
              <textarea name="claimMappings" placeholder='{"subject":"sub","email":"email","displayName":"name"}'></textarea>
              <textarea name="x509Certificate" placeholder="SAML certificate (optional)"></textarea>
              <button type="submit">Create identity provider</button>
            </form>
          </div>

          <div class="card" id="rolePermissionCard">
            <h2>Create Role and Permission</h2>
            <form id="roleForm">
              <input name="applicationId" placeholder="application id" required />
              <input name="name" placeholder="finance_admin" required />
              <textarea name="description" placeholder="Role description"></textarea>
              <button type="submit">Create role</button>
            </form>
            <form id="permissionForm" style="margin-top:14px">
              <input name="applicationId" placeholder="application id" required />
              <input name="roleId" placeholder="role id" required />
              <input name="resource" placeholder="invoice" required />
              <input name="action" placeholder="read" required />
              <input name="field" placeholder="internalNotes or *" />
              <select name="effect">
                <option value="allow">allow</option>
                <option value="deny">deny</option>
                <option value="mask">mask</option>
                <option value="readonly">readonly</option>
              </select>
              <button type="submit">Grant permission</button>
            </form>
          </div>

          <div class="card" id="applicationProviderCard">
            <h2>Bind Provider to Application</h2>
            <form id="applicationProviderForm">
              <input name="applicationId" placeholder="application id" required />
              <input name="providerId" placeholder="provider id" required />
              <textarea name="domains" placeholder="okta.example.com, entra.example.com"></textarea>
              <textarea name="defaultRoleIds" placeholder="role id per line or comma-separated"></textarea>
              <textarea name="claimMappings" placeholder='{"email":"email","displayName":"name"}'></textarea>
              <input name="authorizationUrl" placeholder="Override authorization URL" />
              <input name="ssoUrl" placeholder="Override SSO URL" />
              <input name="clientId" placeholder="Override client id" />
              <input name="audience" placeholder="SAML audience override" />
              <input name="entityId" placeholder="blindfold-sp-demo" />
              <select name="authnRequestBinding">
                <option value="">redirect_default</option>
                <option value="HTTP-POST">http_post</option>
              </select>
              <select name="enabled">
                <option value="true">enabled</option>
                <option value="false">disabled</option>
              </select>
              <select name="allowIdpInitiated">
                <option value="false">sp_initiated_only</option>
                <option value="true">allow_idp_initiated</option>
              </select>
              <button type="submit">Bind provider</button>
            </form>
          </div>

          <div class="card" id="membershipPolicyCard">
            <h2>Membership and Policy</h2>
            <form id="membershipForm">
              <input name="applicationId" placeholder="application id" required />
              <input name="principalId" placeholder="principal id" required />
              <input name="roleId" placeholder="role id" required />
              <input name="tenantId" placeholder="tenant id (optional)" />
              <button type="submit">Assign role</button>
            </form>
            <form id="policyForm" style="margin-top:14px">
              <input name="applicationId" placeholder="application id" required />
              <input name="resource" placeholder="invoice" required />
              <input name="action" placeholder="read" required />
              <input name="field" placeholder="salary or blank" />
              <select name="effect">
                <option value="allow">allow</option>
                <option value="deny">deny</option>
                <option value="mask">mask</option>
                <option value="readonly">readonly</option>
              </select>
              <textarea name="conditionJson" placeholder='{"all":[{"eq":["subject.tenantId","resource.tenantId"]}]}'></textarea>
              <button type="submit">Create policy rule</button>
            </form>
          </div>

          <div class="card" id="policyDebuggerCard">
            <h2>Policy Debugger</h2>
            <form id="debugForm">
              <input name="applicationId" placeholder="application id" required />
              <input name="principalId" placeholder="principal id" required />
              <input name="resource" placeholder="invoice" required />
              <input name="action" placeholder="read" required />
              <input name="field" placeholder="internalNotes or blank" />
              <textarea name="resourceAttributes" placeholder='{"tenantId":"tenant_acme","ownerId":"principal_123"}'></textarea>
              <button type="submit">Evaluate decision</button>
            </form>
            <div class="list-item" style="margin-top:12px">
              <strong>Latest decision</strong>
              <pre id="debugOutput">No decision yet.</pre>
            </div>
          </div>
        </div>

        <div class="stack">
          <div class="card" id="applicationsCard">
            <h2>Applications</h2>
            <div class="list" id="applicationsList"></div>
          </div>
          <div class="card" id="principalsCard">
            <h2>Principals</h2>
            <div class="list" id="principalsList"></div>
          </div>
          <div class="card" id="identityProvidersCard">
            <h2>Identity Providers</h2>
            <div class="list" id="identityProvidersList"></div>
          </div>
          <div class="card" id="applicationProvidersCard">
            <h2>App Provider Bindings</h2>
            <div class="list" id="applicationProvidersList"></div>
          </div>
          <div class="card" id="passkeysCard">
            <h2>Passkeys</h2>
            <div class="list" id="passkeysList"></div>
          </div>
          <div class="card" id="policiesAuditCard">
            <h2>Policies and Audit</h2>
            <div class="list" id="policiesList"></div>
            <div class="list" id="auditList" style="margin-top:14px"></div>
          </div>
        </div>
      </section>
    </main>

    <script>
      const statusBox = document.getElementById("statusBox");
      const metrics = document.getElementById("metrics");
      const applicationsList = document.getElementById("applicationsList");
      const principalsList = document.getElementById("principalsList");
      const identityProvidersList = document.getElementById("identityProvidersList");
      const applicationProvidersList = document.getElementById("applicationProvidersList");
      const passkeysList = document.getElementById("passkeysList");
      const policiesList = document.getElementById("policiesList");
      const auditList = document.getElementById("auditList");
      const debugOutput = document.getElementById("debugOutput");

      function setStatus(message) {
        statusBox.textContent = message;
      }

      function safeParse(value) {
        if (!value) return {};
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      }

      function parseList(value) {
        return String(value || "")
          .split(/[\\n,]/)
          .map((item) => item.trim())
          .filter(Boolean);
      }

      async function request(path, method = "GET", body) {
        const response = await fetch(path, {
          method,
          headers: { "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined
        });
        return response.json();
      }

      function metricCard(title, value, subtitle) {
        return '<article class="card"><div class="muted">' + title + '</div><div class="metric">' + value + '</div><div class="muted">' + subtitle + '</div></article>';
      }

      function renderList(node, items, formatter) {
        if (!items.length) {
          node.innerHTML = '<div class="list-item"><strong>Nothing here yet</strong><span class="muted">Use the forms on the left to populate the workspace.</span></div>';
          return;
        }
        node.innerHTML = items.map(formatter).join("");
      }

      async function refreshSnapshot() {
        const payload = await request("/api/workspace");
        const workspace = payload.workspace || { name: "Uninitialized workspace" };
        const snapshot = payload.snapshot || {};
        const applications = snapshot.applications || [];
        const principals = snapshot.principals || [];
        const policies = snapshot.policy_rules || [];
        const providers = snapshot.identity_providers || [];
        const bindings = snapshot.application_identity_providers || [];
        const passkeys = snapshot.webauthn_credentials || [];
        metrics.innerHTML = [
          metricCard("Workspace", workspace.name || "Uninitialized", "Shared auth workspace"),
          metricCard("Applications", applications.length, "App-level auth configs"),
          metricCard("Principals", principals.length, "Shared user directory"),
          metricCard("Providers", providers.length, "Shared SAML and OIDC connections"),
          metricCard("Passkeys", passkeys.length, "Registered app-scoped credentials"),
          metricCard("Policies", policies.length, "ABAC and field rules")
        ].join("");

        renderList(applicationsList, applications, (item) => '<div class="list-item"><strong>' + item.name + '</strong><span class="muted">' + item.slug + ' · ' + item.id + '</span><pre>' + JSON.stringify(item, null, 2) + '</pre></div>');
        renderList(principalsList, principals, (item) => '<div class="list-item"><strong>' + item.displayName + '</strong><span class="muted">' + item.email + ' · ' + item.id + '</span><pre>' + JSON.stringify(item.attributes || {}, null, 2) + '</pre></div>');
        renderList(
          identityProvidersList,
          providers,
          (item) =>
            '<div class="list-item"><strong>' +
            item.name +
            '</strong><span class="muted">' +
            item.type +
            ' · ' +
            item.key +
            ' · ' +
            item.id +
            '</span><pre>' +
            JSON.stringify(
              {
                issuer: item.issuer,
                discoveryUrl: item.discoveryUrl || null,
                mode: item.mode || "live",
                authorizationUrl: item.authorizationUrl,
                ssoUrl: item.ssoUrl,
                claimMappings: item.claimMappings || {}
              },
              null,
              2
            ) +
            '</pre></div>'
        );
        renderList(
          applicationProvidersList,
          bindings,
          (item) =>
            '<div class="list-item"><strong>' +
            item.applicationId +
            '</strong><span class="muted">' +
            item.providerId +
            ' · ' +
            item.id +
            '</span><pre>' +
            JSON.stringify(
              {
                domains: item.domains || [],
                defaultRoleIds: item.defaultRoleIds || [],
                allowIdpInitiated: item.allowIdpInitiated === true,
                enabled: item.enabled !== false,
                audience: item.audience || null,
                authnRequestBinding: item.authnRequestBinding || null,
                claimMappings: item.claimMappings || {}
              },
              null,
              2
            ) +
            '</pre></div>'
        );
        renderList(
          passkeysList,
          passkeys,
          (item) =>
            '<div class="list-item"><strong>' +
            (item.nickname || item.credentialId) +
            '</strong><span class="muted">' +
            item.principalId +
            ' · ' +
            item.applicationId +
            ' · ' +
            item.status +
            '</span><pre>' +
            JSON.stringify(
              {
                credentialId: item.credentialId,
                rpID: item.rpID,
                transports: item.transports || [],
                lastUsedAt: item.lastUsedAt
              },
              null,
              2
            ) +
            '</pre><button type="button" data-passkey-revoke="' +
            item.credentialId +
            '" class="secondary">Revoke passkey</button></div>'
        );
        renderList(
          policiesList,
          policies,
          (item) =>
            '<div class="list-item"><strong>' +
            item.effect +
            ' ' +
            item.action +
            ' ' +
            item.resource +
            (item.field ? '.' + item.field : '') +
            '</strong><span class="muted">' +
            item.id +
            '</span><pre>' +
            JSON.stringify(
              {
                field: item.field,
                condition: item.conditionJson || {}
              },
              null,
              2
            ) +
            '</pre></div>'
        );
        renderList(auditList, payload.audit || [], (item) => '<div class="list-item"><strong>' + item.type + '</strong><span class="muted">' + item.createdAt + '</span><pre>' + JSON.stringify(item.data || {}, null, 2) + '</pre></div>');
        setStatus("Snapshot refreshed.");
      }

      async function bindForm(id, path, transform) {
        const form = document.getElementById(id);
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const formData = new FormData(form);
          const values = Object.fromEntries(formData.entries());
          const payload = transform ? transform(values) : values;
          const result = await request(path, "POST", payload);
          if (result.error) {
            setStatus(result.error);
            return;
          }
          form.reset();
          setStatus("Saved " + id + ".");
          await refreshSnapshot();
        });
      }

      document.getElementById("refreshButton").addEventListener("click", refreshSnapshot);
      document.getElementById("bootstrapButton").addEventListener("click", async () => {
        await request("/api/bootstrap", "POST", {});
        await refreshSnapshot();
      });

      bindForm("applicationForm", "/api/applications");
      bindForm("principalForm", "/api/principals", (values) => ({ ...values, attributes: safeParse(values.attributes) }));
      bindForm("identityProviderForm", "/api/identity-providers", (values) => ({
        ...values,
        mode: values.mode || "live",
        claimMappings: safeParse(values.claimMappings),
        issuer: values.issuer || null,
        discoveryUrl: values.discoveryUrl || null,
        authorizationUrl: values.authorizationUrl || null,
        ssoUrl: values.ssoUrl || null,
        clientId: values.clientId || null,
        allowInsecureDiscovery: values.allowInsecureDiscovery === "true",
        x509Certificate: values.x509Certificate || null
      }));
      bindForm("roleForm", "/api/roles");
      bindForm("permissionForm", "/api/permissions");
      bindForm("applicationProviderForm", "/api/application-providers", (values) => ({
        ...values,
        domains: parseList(values.domains),
        defaultRoleIds: parseList(values.defaultRoleIds),
        claimMappings: safeParse(values.claimMappings),
        authorizationUrl: values.authorizationUrl || null,
        ssoUrl: values.ssoUrl || null,
        clientId: values.clientId || null,
        audience: values.audience || null,
        authnRequestBinding: values.authnRequestBinding || null,
        entityId: values.entityId || null,
        enabled: values.enabled !== "false",
        allowIdpInitiated: values.allowIdpInitiated === "true"
      }));
      bindForm("membershipForm", "/api/memberships", (values) => ({ ...values, tenantId: values.tenantId || null }));
      bindForm("policyForm", "/api/policies", (values) => ({
        ...values,
        field: values.field || null,
        conditionJson: safeParse(values.conditionJson)
      }));

      function esc(value) {
        return String(value == null ? "" : value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      }

      // Decision narrative: banner + per-rule trace (why each rule did or
      // didn't participate), powered by auth.explain() traces.
      function renderDecision(result) {
        const effect = esc(result.effect || (result.allowed ? "allow" : "deny"));
        const color = result.allowed ? "#15803d" : "#b91c1c";
        let html = '<div style="font-weight:700;color:' + color + '">' +
          (result.allowed ? "ALLOWED" : "DENIED") + " — " + effect.toUpperCase() +
          '</div><div style="margin:4px 0 8px">' + esc(result.reason) + "</div>";
        const obligations = result.obligations || {};
        if ((obligations.maskedFields || []).length) html += "<div>masked: " + esc(obligations.maskedFields.join(", ")) + "</div>";
        if ((obligations.readonlyFields || []).length) html += "<div>readonly: " + esc(obligations.readonlyFields.join(", ")) + "</div>";
        const trace = result.trace;
        if (trace) {
          if (trace.hardDenyReason) {
            html += '<div style="margin-top:6px">⛔ hard deny: ' + esc(trace.hardDenyReason) + " (rules never evaluated)</div>";
          }
          if (trace.steps && trace.steps.length) {
            html += '<div style="margin-top:8px;font-weight:600">Rule trace</div>';
            for (const step of trace.steps) {
              const deciding = trace.decidingRuleId === step.ruleId;
              let line;
              if (step.outcome === "applied") line = "✓ applied" + (deciding ? " — DECIDING RULE" : "");
              else if (step.outcome === "shadowed") line = "◦ matched but outranked";
              else if (step.outcome === "skipped-scope") line = "✗ skipped — scope mismatch: " + esc(step.scopeMisses.join(", "));
              else line = "✗ skipped — condition evaluated false";
              html += '<div style="margin:2px 0' + (deciding ? ";font-weight:700" : "") + '">' +
                esc(step.ruleId) + ' <span style="opacity:.75">[' + esc(step.source) + " · " + esc(step.effect) +
                " · priority " + esc(step.priority) + "]</span> " + line + "</div>";
            }
          } else if (!trace.hardDenyReason) {
            html += '<div style="margin-top:6px">No rules in scope.</div>';
          }
          if (trace.defaultDeny) html += '<div style="margin-top:6px">⚠ default deny — no rule allowed this request.</div>';
        }
        html += '<details style="margin-top:8px"><summary>raw decision JSON</summary><pre>' +
          esc(JSON.stringify(result, null, 2)) + "</pre></details>";
        return html;
      }

      document.getElementById("debugForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const formData = new FormData(event.target);
        const values = Object.fromEntries(formData.entries());
        const payload = {
          ...values,
          field: values.field || null,
          resourceAttributes: safeParse(values.resourceAttributes)
        };
        const result = await request("/api/debug", "POST", payload);
        debugOutput.innerHTML = renderDecision(result);
        setStatus("Decision evaluated.");
      });

      document.addEventListener("click", async (event) => {
        const credentialId = event.target?.dataset?.passkeyRevoke;
        if (!credentialId) {
          return;
        }

        const result = await request("/api/passkeys/revoke", "POST", { credentialId });
        if (result.error) {
          setStatus(result.error);
          return;
        }

        setStatus("Passkey revoked.");
        await refreshSnapshot();
      });

      refreshSnapshot();
    </script>
  </body>
</html>`;
}

export function startStudio({ auth, port = 4110, host = "127.0.0.1" }: { auth: any; port?: number; host?: string }) {
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url as string, `http://${request.headers.host || `${host}:${port}`}`);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return send(response, html(createStudioHtml()));
      }

      if (request.method === "GET" && url.pathname === "/api/workspace") {
        const snapshot = await auth.admin.exportSnapshot();
        const workspace = await auth.admin.getWorkspace();
        const audit = await auth.admin.audit.list({ limit: 12 });
        return send(
          response,
          json(200, {
            workspace,
            snapshot,
            audit
          })
        );
      }

      if (request.method === "POST" && url.pathname === "/api/bootstrap") {
        const payload = await readJson(request);
        const workspace = await auth.admin.bootstrapWorkspace({
          name: payload.name || "Blindfold Workspace"
        });
        return send(response, json(200, workspace));
      }

      if (request.method === "POST" && url.pathname === "/api/applications") {
        const payload = await readJson(request);
        return send(
          response,
          json(
            200,
            await auth.admin.applications.create({
              slug: payload.slug,
              name: payload.name,
              description: payload.description || ""
            })
          )
        );
      }

      if (request.method === "POST" && url.pathname === "/api/principals") {
        const payload = await readJson(request);
        return send(
          response,
          json(
            200,
            await auth.admin.principals.create({
              displayName: payload.displayName,
              email: payload.email,
              password: payload.password,
              attributes: payload.attributes || {}
            })
          )
        );
      }

      if (request.method === "POST" && url.pathname === "/api/identity-providers") {
        const payload = await readJson(request);
        return send(
          response,
          json(
            200,
            await auth.admin.identityProviders.create({
              key: payload.key,
              name: payload.name,
              type: payload.type,
              mode: payload.mode || "live",
              issuer: payload.issuer || null,
              discoveryUrl: payload.discoveryUrl || null,
              authorizationUrl: payload.authorizationUrl || null,
              ssoUrl: payload.ssoUrl || null,
              clientId: payload.clientId || null,
              allowInsecureDiscovery: payload.allowInsecureDiscovery === true,
              claimMappings: payload.claimMappings || {},
              x509Certificate: payload.x509Certificate || null
            })
          )
        );
      }

      if (request.method === "POST" && url.pathname === "/api/roles") {
        const payload = await readJson(request);
        return send(
          response,
          json(
            200,
            await auth.admin.roles.create({
              applicationId: payload.applicationId,
              name: payload.name,
              description: payload.description || ""
            })
          )
        );
      }

      if (request.method === "POST" && url.pathname === "/api/permissions") {
        const payload = await readJson(request);
        return send(
          response,
          json(
            200,
            await auth.admin.roles.grantPermission({
              applicationId: payload.applicationId,
              roleId: payload.roleId,
              resource: payload.resource,
              action: payload.action,
              field: payload.field || "*",
              effect: payload.effect || "allow"
            })
          )
        );
      }

      if (request.method === "POST" && url.pathname === "/api/memberships") {
        const payload = await readJson(request);
        return send(
          response,
          json(
            200,
            await auth.admin.memberships.assignRole({
              principalId: payload.principalId,
              applicationId: payload.applicationId,
              roleId: payload.roleId,
              tenantId: payload.tenantId
            })
          )
        );
      }

      if (request.method === "POST" && url.pathname === "/api/policies") {
        const payload = await readJson(request);
        return send(
          response,
          json(
            200,
            await auth.admin.policies.add({
              applicationId: payload.applicationId,
              principalId: payload.principalId || null,
              roleId: payload.roleId || null,
              resource: payload.resource,
              action: payload.action,
              field: payload.field,
              effect: payload.effect,
              conditionJson: payload.conditionJson || null
            })
          )
        );
      }

      if (request.method === "POST" && url.pathname === "/api/application-providers") {
        const payload = await readJson(request);
        return send(
          response,
          json(
            200,
            await auth.admin.applicationProviders.bind({
              applicationId: payload.applicationId,
              providerId: payload.providerId,
              domains: payload.domains || [],
              defaultRoleIds: payload.defaultRoleIds || [],
              claimMappings: payload.claimMappings || {},
              enabled: payload.enabled !== false,
              allowIdpInitiated: payload.allowIdpInitiated === true,
              authorizationUrl: payload.authorizationUrl || null,
              ssoUrl: payload.ssoUrl || null,
              clientId: payload.clientId || null,
              audience: payload.audience || null,
              authnRequestBinding: payload.authnRequestBinding || null,
              entityId: payload.entityId || null
            })
          )
        );
      }

      if (request.method === "POST" && url.pathname === "/api/debug") {
        const payload = await readJson(request);
        const decision = await auth.admin.debugDecision({
          principalId: payload.principalId,
          applicationId: payload.applicationId,
          action: payload.action,
          resource: payload.resource,
          field: payload.field,
          tenantId: payload.tenantId || null,
          resourceAttributes: payload.resourceAttributes || {}
        });
        return send(response, json(200, decision));
      }

      if (request.method === "POST" && url.pathname === "/api/passkeys/revoke") {
        const payload = await readJson(request);
        const credential = await auth.admin.passkeys.revoke({
          credentialId: payload.credentialId
        });
        return send(response, json(200, credential));
      }

      return send(response, json(404, { error: "not found" }));
    } catch (error) {
      return send(response, json(500, { error: (error as Error).message }));
    }
  });

  return new Promise<{ server: typeof server; url: string }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : port;
      resolve({
        server,
        url: `http://${host}:${resolvedPort}`
      });
    });
  });
}
