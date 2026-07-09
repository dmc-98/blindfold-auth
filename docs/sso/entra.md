# Microsoft Entra ID (Azure AD) OIDC — SSO Recipe

**Target time: < 30 minutes** from a fresh Azure app registration to a working
enterprise login with JIT user provisioning.

> **Name note:** Microsoft renamed Azure Active Directory to **Microsoft Entra ID**
> in 2023. The two names are interchangeable; all API endpoints remain the same.

---

## Prerequisites

- Azure subscription with permission to register applications in Entra ID
  (Global Administrator, Application Administrator, or Cloud Application Administrator role)
- Node.js ≥ 18
- Blindfold Auth installed: `npm install @dmc--98/blindfold-auth @dmc--98/blindfold-sso`
- A running Blindfold auth instance (see `examples/postgres-workspace` or
  `examples/local-workspace` for a quick local setup)

---

## Step 1 — Register an application in Entra ID (8 min)

1. Go to [portal.azure.com](https://portal.azure.com) and open
   **Microsoft Entra ID → App registrations → New registration**.
2. Fill in:
   - **Name**: `My App (Blindfold Dev)`
   - **Supported account types**: choose one:
     - *Single tenant* — only users from your own Entra ID directory
     - *Multitenant* — users from any Microsoft Entra tenant (B2B/SaaS)
   - **Redirect URI**: Web → `http://localhost:3000/auth/sso/oidc/callback`
3. Click **Register**.
4. Copy the **Application (client) ID** and **Directory (tenant) ID** from the
   Overview page — you will need both.
5. Open **Certificates & secrets → Client secrets → New client secret**.
   - Description: `blindfold-sso-dev`
   - Expires: 6 months (rotate before expiry)
   - Click **Add** and copy the **Value** immediately — it is not shown again.
6. *(Optional — for group-based role mapping)* Open **Token configuration →
   Add groups claim → Security groups**. This embeds `groups` in the ID token
   so Blindfold can map them to roles.

Your OIDC discovery URL is:

```
# Single-tenant (most common for enterprise SSO):
https://login.microsoftonline.com/{tenantId}/v2.0/.well-known/openid-configuration

# Multi-tenant (accept any Microsoft work/school account):
https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration
```

Replace `{tenantId}` with the **Directory (tenant) ID** you copied in step 4.

---

## Step 2 — Validate the IdP metadata (2 min)

Before wiring anything, run `blindfold sso doctor` to catch common
misconfigurations (expired certs, missing PKCE, non-HTTPS endpoints):

```sh
npx blindfold sso doctor \
  --url "https://login.microsoftonline.com/{tenantId}/v2.0/.well-known/openid-configuration"
```

Expected healthy output:

```
✓ issuer                   https://login.microsoftonline.com/{tenantId}/v2.0
✓ authorization_endpoint   https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize (https)
✓ token_endpoint           https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token (https)
✓ jwks_uri                 https://login.microsoftonline.com/{tenantId}/discovery/v2.0/keys (https)
✓ id_token signing alg     RS256 (alg:none not present)
✓ PKCE S256 supported
✓ Signing cert             expires 2027-03-15 (248 days)

HEALTHY — no critical findings
```

Fix any `CRITICAL` findings before proceeding.

> **Common `WARNING`:** When using the `common` (multi-tenant) endpoint, the
> doctor may flag that the `issuer` in the discovery document contains
> `{tenantid}` as a literal placeholder — this is expected Microsoft behaviour.
> It resolves to the caller's actual tenant at runtime. Safe to ignore for dev.

---

## Step 3 — Configure the Blindfold provider (3 min)

Run this once — in a migration script, a seed, or Blindfold Studio
(**Admin → SSO → Add Provider**). The provider record is stored in your
Blindfold storage (Postgres, SQLite, or in-memory):

```ts
import { createAuth, createFileStorage } from "@dmc--98/blindfold-auth";
import { createSso } from "@dmc--98/blindfold-sso";

const auth = createAuth({
  workspaceId: process.env.BLINDFOLD_WORKSPACE_ID!,
  secret: process.env.BLINDFOLD_SECRET!,
  storage: createFileStorage({ filePath: ".blindfold/workspace.json" }),
});

const sso = createSso({ auth });

const tenantId = process.env.ENTRA_TENANT_ID!;

// Create the provider (idempotent — re-running is safe)
const provider = await sso.providers.add({
  type: "oidc",
  key: "entra",                       // stable slug used in URLs
  name: "Microsoft",
  mode: "live",
  discoveryUrl: `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`,
  clientId: process.env.ENTRA_CLIENT_ID!,
  clientSecret: process.env.ENTRA_CLIENT_SECRET!,
});

// Bind the provider to your application, with optional domain routing
await sso.bindings.add({
  applicationId: "app_your_app_id",  // your Blindfold application id
  providerId: provider.id,
  // Users whose email domain matches are auto-routed to Entra.
  // Update to your company's real email domain, e.g. ["contoso.com"].
  domains: ["yourcompany.com"],
});

console.log("Provider registered:", provider.id);
```

---

## Step 4 — Wire the login flow into your server (10 min)

```ts
import express from "express";
import { createAuth, createFileStorage } from "@dmc--98/blindfold-auth";
import { createSso } from "@dmc--98/blindfold-sso";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const auth = createAuth({
  workspaceId: process.env.BLINDFOLD_WORKSPACE_ID!,
  secret: process.env.BLINDFOLD_SECRET!,
  storage: createFileStorage({ filePath: ".blindfold/workspace.json" }),
});
const sso = createSso({ auth });

const APP_ID = process.env.APP_ID ?? "app_default";

// ── Initiate SSO login ──────────────────────────────────────────────────────
// POST /auth/sso/start  { email?: string }
//   → 302 redirect to Entra ID authorization URL
app.post("/auth/sso/start", async (req, res) => {
  try {
    const result = await sso.login.start({
      protocol: "oidc",
      applicationId: APP_ID,
      email: req.body.email,          // optional: enables domain routing
      request: { headers: req.headers as Record<string, string> },
    });

    if (result.multipleProviders) {
      return res.status(409).json({ providers: result.multipleProviders });
    }

    res.redirect(result.redirectTo);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Handle the Entra callback ───────────────────────────────────────────────
// GET /auth/sso/oidc/callback?code=…&state=…
//   → sets session cookie + redirects to /dashboard
app.get("/auth/sso/oidc/callback", async (req, res) => {
  try {
    const result = await sso.login.complete({
      protocol: "oidc",
      payload: req.query as Record<string, unknown>,
      request: { headers: req.headers as Record<string, string> },
    });

    res.cookie("session", result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    res.redirect("/dashboard");
  } catch (err: unknown) {
    res.status(401).json({ error: (err as Error).message });
  }
});

// ── Protected route ─────────────────────────────────────────────────────────
app.get("/dashboard", async (req, res) => {
  const token = req.cookies?.session;
  if (!token) return res.redirect("/");

  try {
    const session = await auth.handlers.session.verify()({
      headers: { authorization: `Bearer ${token}` },
    });
    res.json({ message: "Welcome!", session });
  } catch {
    res.redirect("/");
  }
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
```

---

## Step 5 — Environment variables

Create a `.env` file (never commit it):

```dotenv
BLINDFOLD_WORKSPACE_ID=workspace_my_app
BLINDFOLD_SECRET=change-me-use-32-random-chars-min

# From Azure Portal → Entra ID → App registrations → your app → Overview
ENTRA_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
ENTRA_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ENTRA_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

APP_ID=app_default
```

---

## Step 6 — Test the flow end-to-end

```sh
# Load env and start the server
set -a && source .env && set +a
npx ts-node server.ts

# Open http://localhost:3000, enter your work email, click "Sign in with Microsoft"
# → redirected to Microsoft login page (login.microsoftonline.com)
# → after login: Entra redirects to http://localhost:3000/auth/sso/oidc/callback
# → session cookie set, redirected to /dashboard
# → GET /dashboard returns { session: { principalId, authStrength: "sso_oidc" } }
```

> **Tip:** If `blindfold sso doctor` was green in Step 2 and the callback still
> fails with `AADSTS50011` (reply URL mismatch), the registered redirect URI in
> Azure must exactly match — including scheme, host, port, and path. Also check
> that your Azure app's **Supported account types** matches who you are logging
> in as (single-tenant apps reject users from other directories).

---

## JIT provisioning

When an Entra user authenticates for the first time, Blindfold creates a
`principal` record automatically:

```ts
// The principal created on first SSO login looks like:
{
  id: "usr_...",
  email: "alice@yourcompany.com",
  displayName: "Alice Example",
  ssoLinked: true,
  roleIds: [...],  // from the binding's defaultRoleIds
}
```

The audit log records a `principal.created` event with `source: "sso_jit"`.
Subsequent logins reuse the same principal and record `session.created` events.

### Group-based role mapping

If you enabled the **groups claim** in Step 1, the ID token contains a `groups`
array of Entra group object IDs. Map them to Blindfold roles in your binding:

```ts
await sso.bindings.add({
  applicationId: "app_your_app_id",
  providerId: provider.id,
  domains: ["yourcompany.com"],
  claimMappings: [
    // Map Entra group object ID → Blindfold roleId
    { claim: "groups", value: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", roleId: "role_admin" },
    { claim: "groups", value: "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy", roleId: "role_viewer" },
  ],
});
```

> **Large token warning:** If a user belongs to more than ~200 groups, Entra
> emits a `_claim_names` + `_claim_sources` overage claim instead of the full
> array. Use Microsoft Graph to enumerate memberships server-side in that case.

---

## SAML 2.0 variant

Entra ID also supports SAML 2.0. In the Azure portal, under your app
registration → **Enterprise applications** side, choose **SAML** as the sign-on
method.

Replace `type: "oidc"` with `type: "saml"` and supply the SAML metadata:

```ts
const provider = await sso.providers.add({
  type: "saml",
  key: "entra-saml",
  name: "Microsoft (SAML)",
  mode: "live",
  // From Azure: Enterprise apps → your app → Set up single sign-on → SAML Certificates → App Federation Metadata Url
  metadataUrl: `https://login.microsoftonline.com/${tenantId}/federationmetadata/2007-06/federationmetadata.xml`,
  // OR supply inline:
  ssoUrl: "https://login.microsoftonline.com/{tenantId}/saml2",
  x509Certificate: "MIIC...",         // from Azure SAML certificate download
});
```

Handle the callback with the SAML-specific payload:

```ts
// POST /auth/sso/saml/callback  (Entra posts SAMLResponse + RelayState)
app.post("/auth/sso/saml/callback", express.urlencoded({ extended: true }), async (req, res) => {
  const result = await sso.login.complete({
    protocol: "saml",
    payload: { SAMLResponse: req.body.SAMLResponse, relayState: req.body.RelayState },
    request: { headers: req.headers as Record<string, string> },
  });
  // … same cookie + redirect logic
});
```

Run `blindfold sso doctor --url <federation-metadata-url>` for SAML-specific
checks (cert expiry, entityID, SSO binding type).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `AADSTS50011` (reply URL mismatch) | Redirect URI in Azure doesn't match exactly | Portal → App registrations → Authentication → check the URI |
| `AADSTS70011` (invalid scope) | Scope misconfiguration | Ensure `openid profile email` scopes are in the OIDC provider config |
| `AADSTS50020` (user account from external IdP) | Single-tenant app; user is from a different directory | Change account type to multitenant or use `common` endpoint |
| `state mismatch` | Cookie not returned on callback | Ensure cookies are enabled; check `sameSite` setting |
| `token verification failed` | Stale JWKS cache | Restart server; Blindfold caches JWKS for 1 h |
| `sso doctor` cert warning | Entra signing cert expiring soon | Microsoft rotates certs automatically, but verify rotation in portal |
| Groups claim missing | Groups claim not added to token | Portal → App registrations → Token configuration → Add groups claim |

---

## Next steps

- Add a second IdP (Okta, Google Workspace) — same API, different config
  (see `docs/sso/okta.md`)
- Enable SCIM provisioning: `@dmc--98/blindfold-scim` for group/user lifecycle
  sync (Entra's SCIM provisioning pushes to your endpoint)
- Lock down policies: add an ABAC rule that requires `authStrength: "sso_oidc"`
  for sensitive routes
- For larger Entra deployments, consider Conditional Access policies in Azure
  to enforce MFA at the IdP level before the token reaches Blindfold
- Review the `blindfold doctor` security scan before go-live
