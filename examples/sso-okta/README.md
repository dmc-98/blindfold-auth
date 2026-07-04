# Okta OIDC SSO — example app

Minimal Express server demonstrating Blindfold Auth's Okta OIDC integration.

**Full recipe with step-by-step instructions:** [`docs/sso/okta.md`](../../docs/sso/okta.md)

## Quick start

```sh
# 1. Install dependencies
npm install

# 2. Configure credentials
cp .env.example .env
# → fill in BLINDFOLD_WORKSPACE_ID, BLINDFOLD_SECRET, OKTA_* values

# 3. Register the Okta provider + binding (run once)
npm run setup

# 4. Start the server
npm start
# → http://localhost:3000
```

## What this demonstrates

- **`setup.ts`** — registers the Okta OIDC provider and creates an SSO binding with domain routing
- **`server.ts`** — Express server with:
  - `POST /auth/sso/start` — initiates the Okta authorization redirect
  - `GET /auth/sso/oidc/callback` — exchanges the code for a session token
  - `GET /dashboard` — protected route verified with Blindfold session tokens
  - `GET /logout` — clears the session cookie

## Key files

| File | Purpose |
|------|---------|
| `setup.ts` | One-time provider/binding registration |
| `server.ts` | Express SSO login flow |
| `.env.example` | Environment variable template |
| `../../docs/sso/okta.md` | Full walkthrough (30-min target) |

## SAML 2.0 variant

See the SAML section in [`docs/sso/okta.md`](../../docs/sso/okta.md#saml-20-variant) — only the payload shape changes; the route structure is identical.
