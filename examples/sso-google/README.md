# Google Workspace OIDC SSO example

Working example for the [Google Workspace SSO recipe](../../docs/sso/google.md).
Target: fresh Google Cloud OAuth client → working enterprise login in **< 30 minutes**.

## Run it

```sh
# 1. Create an OAuth client in Google Cloud Console (docs/sso/google.md Step 1)
#    Redirect URI: http://localhost:3000/auth/sso/oidc/callback

# 2. Configure environment
cp .env.example .env   # then fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_WORKSPACE_DOMAIN

# 3. Validate Google's IdP metadata
npx blindfold sso doctor --url "https://accounts.google.com/.well-known/openid-configuration"

# 4. Register provider + binding (once, idempotent)
npm run setup

# 5. Start
npm start
```

Open <http://localhost:3000>, enter your work email, and sign in with Google.

## Files

- `setup.ts` — one-time provider + binding registration (domain-routed)
- `server.ts` — Express app: login start, OIDC callback, protected dashboard, logout
- `../../docs/sso/google.md` — full recipe: consent screen setup, `hd` domain
  restriction, group-mapping options, SAML variant, troubleshooting

## Env vars

| Var | Where to get it |
|-----|-----------------|
| `BLINDFOLD_WORKSPACE_ID` | your Blindfold workspace |
| `BLINDFOLD_SECRET` | ≥ 32 random chars |
| `GOOGLE_CLIENT_ID` | Cloud Console → Credentials → OAuth client |
| `GOOGLE_CLIENT_SECRET` | same page (starts with `GOCSPX-`) |
| `GOOGLE_WORKSPACE_DOMAIN` | your Workspace primary domain, e.g. `acme.co` |
| `APP_ID` | optional, defaults to `app_default` |
