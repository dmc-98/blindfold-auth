# What is Blindfold Auth?

Blindfold Auth is a local-first authentication and authorization library for Node.js teams who do not want a hosted control plane managing their users and policies.

## The core premise

Most auth services work like this: your app calls out to a remote vendor, the vendor decides whether the request is allowed, and you trust that decision. Your user data lives on someone else's database, your audit logs are locked behind a vendor dashboard, and your policies are configured in a UI you do not control.

Blindfold flips this:

- the runtime embeds in your application process
- your own database stores users, sessions, roles, and policies
- the audit log never leaves your infrastructure
- the Studio UI runs locally against your own workspace

There is no cloud to phone home to. Your users, sessions, and policies stay where you put them.

## What Blindfold is

- **An embedded runtime** — `createAuth()` returns a fully initialized auth system. No separate auth server to deploy.
- **A workspace model** — one workspace serves multiple applications. Shared principal directory, per-app roles and policies.
- **An authorization engine** — table-driven RBAC and ABAC policies with field-level allow, deny, mask, and readonly outcomes.
- **An SSO gateway** — OIDC and SAML 2.0 federation with Okta, Entra ID, Google Workspace, and any standards-compliant IdP.
- **A CLI + local Studio** — `blindfold doctor`, `blindfold sso doctor`, and a browser-based policy debugger for operators.
- **A package ecosystem** — 16 scoped npm packages, all Apache 2.0, all with `--access public` provenance-signed releases.

## What Blindfold is not

- **Not a hosted service.** There is no blindfold.io to sign up for. You run it.
- **Not a frontend auth library.** This is a server-side Node.js runtime. Client helpers exist but the policy engine lives on your server.
- **Not an opinionated framework.** Blindfold works with Express, Fastify, Hono, Lambda, or any Node.js HTTP layer. Storage is pluggable.

## How it compares

| | Blindfold Auth | Auth0 / Clerk | Better Auth |
|---|---|---|---|
| Where data lives | Your infra | Vendor's cloud | Your infra |
| Policy engine | RBAC+ABAC, field-level | RBAC, limited ABAC | RBAC |
| SSO | OIDC + SAML built-in | Add-on (paid) | Plugin-based |
| Audit log | Hash-chained, local | Hosted, paid tier | Basic |
| Pricing | Apache 2.0, free forever | Freemium → paid | MIT, free |
| Explainability | Per-rule trace + dry-run | No | No |

## Who it is for

- Teams building multi-tenant SaaS who need ABAC policies without vendor lock-in.
- Organizations with data-residency requirements that prevent sending auth events to a third party.
- Open-source projects that want a security-auditable auth layer with no paywalled features.
- Teams graduating from Better Auth or a simple JWT setup who need enterprise features without a hosted service.

## Architecture in one paragraph

Your host app embeds `@dmc--98/blindfold-auth`. On startup, the runtime initializes against your storage adapter (Postgres, DynamoDB, or custom). Incoming HTTP requests are handled by `auth.handlers.*` route helpers or by calling `auth.can()` and `auth.protect()` directly. Sessions are JWTs signed with your secret; the runtime verifies them, loads memberships and policies from storage, and evaluates RBAC+ABAC in a single synchronous call. Studio runs as a local sidecar on demand.

```
Browser → Host App → auth.handlers.* → Storage (your Postgres)
                           ↑
                     auth.can() / auth.protect()
```

## Next steps

- [Get started in 10 minutes](/guide/getting-started)
- [Understand the core model](/guide/concepts)
- [See the package list](/guide/configuration#packages)
