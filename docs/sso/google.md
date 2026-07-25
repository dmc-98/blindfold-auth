# Google Workspace OIDC — SSO Recipe

**Target time: < 30 minutes** from a fresh Google Cloud OAuth client to a working
enterprise login with JIT user provisioning.

> **Scope note:** This recipe covers **Google Workspace** (formerly G Suite)
> sign-in via OpenID Connect. It also works for consumer Google accounts —
> the domain-restriction step (`hd` claim check) is what limits sign-in to your
> organisation.

---

## Prerequisites

- A Google Cloud project (any project — it does not need to run your workloads)
  and permission to create OAuth credentials
- If you want organisation-only sign-in: a Google Workspace domain and admin
  access to verify it
- Node.js ≥ 18
- Blindfold Auth installed: `npm install @dmc--98/blindfold-auth @dmc--98/blindfold-sso`
- A running Blindfold auth instance (see `examples/postgres-workspace` or
  `examples/local-workspace` for a quick local setup)

---

## Step 1 — Create an OAuth client in Google Cloud (8 min)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and open
   **APIs & Services → OAuth consent screen**.
2. Configure the consent screen (one-time per project):
   - **User type**: choose one:
     - *Internal* — only users in your Google Workspace organisation (recommended
       for enterprise SSO; skips Google's app verification entirely)
     - *External* — any Google account (requires verification for production use)
   - **App name**: `My App (Blindfold Dev)` · add support + developer emails
   - Scopes: `openid`, `email`, `profile` — no sensitive scopes needed
3. Open **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - **Application type**: Web application
   - **Name**: `blindfold-sso-dev`
   - **Authorized redirect URIs**: `http://localhost:3000/auth/sso/oidc/callback`
4. Click **Create** and copy the **Client ID** and **Client secret**.

Google publishes a single OIDC discovery document for all tenants:

```
https://accounts.google.com/.well-known/openid-configuration
```

There is no per-tenant discovery URL — organisation restriction happens via the
`hd` (hosted domain) claim, covered in Step 3.

---

## Step 2 — Validate the IdP metadata (2 min)

Before wiring anything, run `blindfold sso doctor` to catch common
misconfigurations:

```sh
npx blindfold sso doctor \
  --url "https://accounts.google.com/.well-known/openid-configuration"
```

Expected healthy output:

```
✓ issuer                   https://accounts.google.com
✓ authorization_endpoint   https://accounts.google.com/o/oauth2/v2/auth (https)
✓ token_endpoint           https://oauth2.googleapis.com/token (https)
✓ jwks_uri                 https://www.googleapis.com/oauth2/v3/certs (https)
✓ id_token signing alg     RS256 (alg:none not present)
✓ PKCE S256 supported

HEALTHY — no critical findings
```

Fix any `CRITICAL` findings before proceeding.

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

// Create the provider (idempotent — re-running is safe)
const provider = await sso.providers.add({
  type: "oidc",
  key: "google",                      // stable slug used in URLs
  name: "Google",
  mode: "live",
  discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
});

// Bind the provider to your application, with domain routing
await sso.bindings.add({
  applicationId: "app_your_app_id",  // your Blindfold application id
  providerId: provider.id,
  // Users whose email domain matches are auto-routed to Google.
  // Update to your company's real Workspace domain, e.g. ["acme.co"].
  domains: ["yourcompany.com"],
});

console.log("Provider registered:", provider.id);
```

> **Domain restriction (`hd` claim):** setting `domains` on the binding routes
> users *to* Google, and Blindfold verifies on callback that the authenticated
> email matches a bound domain — a consumer `@gmail.com` account cannot complete
> JIT provisioning into a binding scoped to `acme.co`. Belt-and-braces: set the
> consent screen to *Internal* (Step 1) so Google enforces it on their side too.

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
//   → 302 redirect to Google's authorization URL
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

// ── Handle the Google callback ──────────────────────────────────────────────
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

# From Google Cloud Console → APIs & Services → Credentials → your OAuth client
GOOGLE_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx

# Your Google Workspace primary domain (used for binding domain routing)
GOOGLE_WORKSPACE_DOMAIN=yourcompany.com

APP_ID=app_default
```

---

## Step 6 — Test the flow end-to-end

```sh
# Load env and start the server
set -a && source .env && set +a
npx ts-node server.ts

# Open http://localhost:3000, enter your work email, click "Sign in with Google"
# → redirected to accounts.google.com
# → after login: Google redirects to http://localhost:3000/auth/sso/oidc/callback
# → session cookie set, redirected to /dashboard
# → GET /dashboard returns { session: { principalId, authStrength: "sso_oidc" } }
```

> **Tip:** If the callback fails with `redirect_uri_mismatch`, the redirect URI
> registered in the Google Cloud Console must match exactly — including scheme,
> host, port, and path. Google treats `localhost` and `127.0.0.1` as different
> hosts.

---

## JIT provisioning

When a Workspace user authenticates for the first time, Blindfold creates a
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

Unlike Okta and Entra, **Google does not put group membership in the ID token**.
Two options:

1. **SAML variant with group attributes** — Google Workspace SAML apps can map
   group membership into assertion attributes (Admin console → your SAML app →
   Attribute mapping → Group membership). Use the SAML recipe below and map the
   attribute with `claimMappings`.
2. **Directory API lookup** — call the
   [Admin SDK Directory API](https://developers.google.com/admin-sdk/directory)
   server-side after JIT provisioning and assign Blindfold roles via
   `auth.admin.principals` in your own sync job. This needs a service account
   with domain-wide delegation — keep that credential out of your web tier.

For simple deployments, assigning `defaultRoleIds` on the binding and managing
elevated roles in Blindfold Studio is usually enough.

---

## SAML 2.0 variant

Google Workspace also supports SAML custom apps
(**Admin console → Apps → Web and mobile apps → Add custom SAML app**).

Replace `type: "oidc"` with `type: "saml"` and supply the SAML metadata:

```ts
const provider = await sso.providers.add({
  type: "saml",
  key: "google-saml",
  name: "Google (SAML)",
  mode: "live",
  // From Admin console: your SAML app → Download metadata → IdP metadata URL/XML
  ssoUrl: "https://accounts.google.com/o/saml2/idp?idpid=XXXXXXXXX",
  x509Certificate: "MIIC...",         // from the Google IdP metadata download
});
```

Handle the callback with the SAML-specific payload:

```ts
// POST /auth/sso/saml/callback  (Google posts SAMLResponse + RelayState)
app.post("/auth/sso/saml/callback", express.urlencoded({ extended: true }), async (req, res) => {
  const result = await sso.login.complete({
    protocol: "saml",
    payload: { SAMLResponse: req.body.SAMLResponse, relayState: req.body.RelayState },
    request: { headers: req.headers as Record<string, string> },
  });
  // … same cookie + redirect logic
});
```

Run `blindfold sso doctor --url <idp-metadata-url>` for SAML-specific checks
(cert expiry, entityID, SSO binding type).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `redirect_uri_mismatch` | Redirect URI in Google Cloud doesn't match exactly | Console → Credentials → your OAuth client → check the URI (localhost ≠ 127.0.0.1) |
| `access_blocked: org_internal` | Consent screen is *Internal*; user is outside your Workspace org | Expected for enterprise SSO — or switch to *External* if you want any Google account |
| `admin_policy_enforced` | Workspace admin restricted third-party app access | Admin console → Security → API controls → allow your OAuth client ID |
| `invalid_client` | Client secret wrong or regenerated | Re-copy the secret from the Console; restart with the new env |
| `state mismatch` | Cookie not returned on callback | Ensure cookies are enabled; check `sameSite` setting |
| `token verification failed` | Stale JWKS cache | Restart server; Blindfold caches JWKS for 1 h |
| Consumer `@gmail.com` signs in unexpectedly | Consent screen is *External* and no domain binding | Scope the binding `domains` to your Workspace domain; prefer *Internal* user type |
| Groups missing from token | Google OIDC never includes groups | Use the SAML variant with group attribute mapping, or the Directory API (see above) |

---

## Next steps

- Add a second IdP (Okta, Entra ID) — same API, different config
  (see `docs/sso/okta.md`, `docs/sso/entra.md`)
- Enable SCIM provisioning: `@dmc--98/blindfold-scim` for group/user lifecycle
  sync (Google Workspace can push SCIM to your endpoint via auto-provisioning)
- Lock down policies: add an ABAC rule that requires `authStrength: "sso_oidc"`
  for sensitive routes
- Enforce 2-Step Verification in the Google Admin console so MFA happens at the
  IdP before the token ever reaches Blindfold
- Review the `blindfold doctor` security scan before go-live
