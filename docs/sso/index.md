# SSO Recipes

Blindfold Auth ships OIDC and SAML 2.0 federation out of the box via
`@dmc--98/blindfold-sso`. Each recipe below is timed: a developer following
the steps from scratch should have a working enterprise login in under 30 minutes.

## Available recipes

| IdP | Protocol | Guide | Example |
|-----|----------|-------|---------|
| Okta | OIDC | [okta.md](./okta.md) | `examples/sso-okta/` |

> Entra ID (Azure AD) and Google Workspace recipes are on the roadmap.

## How federation works

```
Browser ──POST /auth/sso/oidc/start──► Blindfold
                                           │ buildAuthorizationUrl()
                                           ▼
                                        Okta (IdP)
                                           │ code + state
                                           ▼
Browser ──GET /auth/sso/oidc/callback──► Blindfold
                                           │ exchangeCode + verifyIdToken
                                           ▼
                                        session + accessToken → Browser
```

## Shared concepts

**Provider** — the IdP configuration (issuer, client ID, client secret for OIDC;
entityID and signing cert for SAML). Providers are workspace-scoped.

**Binding** — links a provider to a specific application, optionally with domain
routing (`acme.co` → Okta) and a default role list for JIT-provisioned users.

**JIT provisioning** — when a new user signs in via SSO, Blindfold creates a
principal record automatically and stamps `ssoLinked: true` on the audit event.

## `blindfold sso doctor`

Run this against any IdP metadata URL before wiring the provider into your app:

```sh
# OIDC
blindfold sso doctor --url https://dev-xxxxx.okta.com/.well-known/openid-configuration

# SAML (metadata XML URL)
blindfold sso doctor --url https://dev-xxxxx.okta.com/app/xxxxx/sso/saml/metadata
```

Checks performed: HTTPS endpoints, signing cert expiry, `alg:none` risk, PKCE S256
availability, required fields. Exits 1 on any critical finding.
