# Okta OIDC — SSO Recipe

**Target time: < 30 minutes** from a fresh Okta dev account to a working
enterprise login with JIT user provisioning.

---

## Prerequisites

- Okta Developer account (free at [developer.okta.com](https://developer.okta.com))
- Node.js ≥ 18
- Blindfold Auth installed: `npm install @dmc--98/blindfold-auth @dmc--98/blindfold-sso`
- A running Blindfold auth instance (see `examples/postgres-workspace` or
  `examples/local-workspace` for a quick local setup)

---

## Step 1 — Create an Okta OIDC app (5 min)

1. Sign into your Okta admin console: `https://dev-{yourId}-admin.okta.com`
2. **Applications → Applications → Create App Integration**
3. Choose **OIDC - OpenID Connect** → **Web Application** → Next
4. Fill in:
   - **App integration name**: `My App (Blindfold Dev)`
   - **Sign-in redirect URIs**: `http://localhost:3000/auth/sso/oidc/callback`
   - **Sign-out redirect URIs**: `http://localhost:3000`
   - **Assignments**: *(leave as "Allow everyone in your organisation" for dev)*
5. Click **Save**
6. Copy the **Client ID** and **Client secret** from the app's General tab.
7. Note your **Okta domain**: `https://dev-{yourId}.okta.com`

Your OIDC discovery URL is:
```
https://dev-{yourId}.okta.com/.well-known/openid-configuration
```

---

## Step 2 — Validate the IdP metadata (2 min)

Before wiring anything, run `blindfold sso doctor` to catch common
misconfigurations (expired certs, missing PKCE, http endpoints):

```sh
npx blindfold sso doctor \
  --url https://dev-{yourId}.okta.com/.well-known/openid-configuration
```

Expected output when healthy:

```
✓ issuer                   https://dev-{yourId}.okta.com
✓ authorization_endpoint   https://dev-{yourId}.okta.com/oauth2/v1/authorize (https)
✓ token_endpoint           https://dev-{yourId}.okta.com/oauth2/v1/token (https)
✓ jwks_uri                 https://dev-{yourId}.okta.com/oauth2/v1/keys (https)
✓ id_token signing alg     RS256 (alg:none not present)
✓ PKCE S256 supported
✓ Signing cert             expires 2027-04-01 (362 days)

HEALTHY — no critical findings
```

Fix any `CRITICAL` findings before proceeding. `WARNING` findings are safe to
defer for dev but must be addressed before production.

---

## Step 3 — Configure the Blindfold provider (3 min)

Run this once — in a migration script, a seed, or the Blindfold Studio
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

// Create the provider (idempotent — re-running is safe)
const provider = await sso.providers.add({
  type: "oidc",
  key: "okta",                        // stable slug used in URLs
  name: "Okta",
  mode: "live",
  discoveryUrl: "https://dev-{yourId}.okta.com/.well-known/openid-configuration",
  clientId: process.env.OKTA_CLIENT_ID!,
  clientSecret: process.env.OKTA_CLIENT_SECRET!,
});

// Bind the provider to your application, with optional domain routing
await sso.bindings.add({
  applicationId: "app_your_app_id",  // your Blindfold application id
  providerId: provider.id,
  domains: ["yourcompany.okta.com"], // users with this domain are auto-routed
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
//   → 302 redirect to Okta authorization URL
app.post("/auth/sso/start", async (req, res) => {
  try {
    const result = await sso.login.start({
      protocol: "oidc",
      applicationId: APP_ID,
      email: req.body.email,          // optional: enables domain routing
      request: { headers: req.headers as Record<string, string> },
    });

    if (result.multipleProviders) {
      // Multiple providers match — ask the user to pick one
      return res.status(409).json({ providers: result.multipleProviders });
    }

    res.redirect(result.redirectTo);
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Handle the Okta callback ────────────────────────────────────────────────
// GET /auth/sso/oidc/callback?code=…&state=…
//   → sets session cookie + redirects to /dashboard
app.get("/auth/sso/oidc/callback", async (req, res) => {
  try {
    const result = await sso.login.complete({
      protocol: "oidc",
      payload: req.query as Record<string, unknown>,
      request: { headers: req.headers as Record<string, string> },
    });

    // Set your session cookie however your app normally does it.
    // `result.accessToken` is a signed JWT you can verify with @dmc--98/blindfold-auth.
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

app.get("/", (_req, res) => {
  res.send(`
    <h1>Blindfold + Okta OIDC demo</h1>
    <form method="POST" action="/auth/sso/start">
      <input name="email" placeholder="work email (optional)" />
      <button type="submit">Sign in with Okta</button>
    </form>
  `);
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
```

---

## Step 5 — Environment variables

Create a `.env` file (never commit it):

```dotenv
BLINDFOLD_WORKSPACE_ID=workspace_my_app
BLINDFOLD_SECRET=change-me-use-32-random-chars-min

OKTA_CLIENT_ID=0oaXXXXXXXXXXXXXX
OKTA_CLIENT_SECRET=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

APP_ID=app_default
```

---

## Step 6 — Test the flow end-to-end

```sh
# Load env and start the server
set -a && source .env && set +a
npx ts-node server.ts          # or: node --loader ts-node/esm server.ts

# Open http://localhost:3000, enter a work email, click "Sign in with Okta"
# → redirected to Okta login page
# → after login: Okta redirects to http://localhost:3000/auth/sso/oidc/callback
# → session cookie set, redirected to /dashboard
# → GET /dashboard returns { session: { principalId, authStrength: "sso_oidc" } }
```

> **Tip:** If `blindfold sso doctor` was green in Step 2 and the callback still
> fails, the most common causes are a mismatched redirect URI (Okta is strict —
> include the trailing slash only if you registered it) or a `state` mismatch
> (check that cookies are enabled; the state is stored in a short-lived cookie).

---

## JIT provisioning

When an Okta user authenticates for the first time, Blindfold creates a
`principal` record automatically:

```ts
// The principal created on first SSO login looks like:
{
  id: "usr_...",
  email: "alice@yourcompany.okta.com",
  displayName: "Alice Example",
  ssoLinked: true,
  roleIds: [...],  // from the binding's defaultRoleIds
}
```

The audit log records a `principal.created` event with `source: "sso_jit"`.
Subsequent logins reuse the same principal and record `session.created` events.

---

## SAML 2.0 variant

Replace `type: "oidc"` with `type: "saml"` and supply `ssoUrl` +
`x509Certificate` (from Okta's SAML metadata XML) instead of `discoveryUrl` +
`clientId`/`clientSecret`. The login start/complete API is identical —
only the payload shape changes:

```ts
// SAML callback payload
payload: { SAMLResponse: req.body.SAMLResponse, relayState: req.body.RelayState }
```

Run `blindfold sso doctor --url <okta-saml-metadata-url>` for SAML-specific
checks (signing cert, entityID, SSO binding type).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `SSO start failed (404)` | No binding for this `applicationId` | Run `sso.bindings.add(...)` |
| `state mismatch` | Cookie not returned on callback | Ensure cookies are enabled; check `sameSite` |
| Redirect URI mismatch (Okta error) | URL doesn't match what's registered in Okta | Check Okta app → Sign-in redirect URIs |
| `token verification failed` | Discovery URL cached stale JWKS | Restart server; Blindfold caches JWKS for 1 h |
| `sso doctor` cert warning | Okta signing cert expiring soon | Rotate in Okta admin → Security → API → Keys |

---

## Next steps

- Add a second IdP (Entra ID, Google Workspace) — same API, different config
- Enable SCIM provisioning: `@dmc--98/blindfold-scim` for group/role sync
- Lock down policies: add an ABAC rule that requires `authStrength: "sso_oidc"`
  for sensitive routes
- Review the `blindfold doctor` security scan before go-live
