# Blindfold Auth — Codebase State

_Snapshot as of May 30, 2026. This document describes what is actually in the repository today, so engineers, evaluators, and the roadmap can build on a shared, accurate picture._

## What this is

Blindfold Auth is a **local-first authentication and authorization system** for JavaScript/TypeScript teams that do not want a hosted auth vendor or a remote control plane. Applications embed the runtime as a package; users, sessions, policies, and audit logs live in the team's own infrastructure (memory, files, or Postgres). A CLI bootstraps a workspace and launches a local web Studio for operators.

The workspace is a private npm monorepo (`blindfold-auth-workspace`, version `0.1.0`, ESM, npm workspaces) containing five published-shape packages plus three runnable examples.

## Repository layout

```
packages/
  auth/                    @blindfold/auth                 core runtime (~4.2k LOC of src)
  auth-cli/                @blindfold/auth-cli             CLI + bin/blindfold-auth.ts
  auth-studio/             @blindfold/auth-studio          local operator web app (~940 LOC)
  auth-storage-postgres/   @blindfold/auth-storage-postgres  Postgres jsonb adapter (~156 LOC)
  auth-adapter-serverless/ @blindfold/auth-adapter-serverless  API Gateway/Lambda adapter (~70 LOC)
examples/
  local-workspace/         embedded in-memory/file demo
  postgres-workspace/      recommended Node + Postgres reference (Docker + smoke check)
  lambda-dynamodb/         serverless reference layout + local invoke smoke
docs/                      MASTER_GUIDE, ARCHITECTURE, GO_LIVE, contracts/, security & perf docs
benchmarks/                auth.perf.ts performance harness
e2e/                       Playwright end-to-end suite
.github/                   templates, FUNDING, dependabot, CI workflows
```

All packages are at `0.1.0`. The repository is pre-1.0 and explicitly versions its public contracts under `docs/contracts/`.

## Core runtime — `@blindfold/auth`

The runtime is one substantial module (`src/auth.js`, ~2,500 lines) plus focused helpers: `policy.js`, `storage.js`, `utils.js`, `passkeys.js`, `oidc.js`, `saml.js`, `federation.js`, `totp.js`, `env.js`, `constants.js`.

### Public entry points

```js
import {
  createAuth,
  createMemoryStorage,
  createFileStorage,
  maskValue,
  TABLES,
  evaluateCondition,
  evaluatePolicies,
  generateTotpSecret,
  getTotpCode,
  verifyTotpCode,
  generateRecoveryCodes,
} from "@blindfold/auth";
```

### `createAuth()`

```js
const auth = createAuth({
  workspaceId,   // optional, defaults to "workspace_local"
  secret,        // REQUIRED — signing secret; missing secret is a hard error
  storage,       // optional, defaults to in-memory adapter
  session,       // optional session-default overrides
  security,      // optional security-default overrides
  authMethods,   // optional auth-method overrides
});
```

The constructor ensures required storage tables exist and returns runtime, session, handler, and admin surfaces.

### Returned surfaces

- `auth.can(...)` — RBAC + ABAC decision engine. Resolves principal, application, action, resource, field, tenant, and resource attributes. Returns `{ allowed, effect, matchedRuleIds, obligations, reason }`.
- `auth.protect(...)` — wraps a route/handler, reads the bearer token, verifies the session, and optionally authorizes before calling the inner handler.
- `auth.session.create / verify / refresh / revoke` — access tokens are signed by Blindfold; refresh tokens are opaque and stored hashed; refresh rotates the session; revoked/rotated sessions stop validating.
- `auth.handlers.login / refresh / logout / requestMagicLink / consumeMagicLink` — convenience HTTP-style handlers for embedded apps and adapters.
- `auth.admin.*` — the supported write/management path used by Studio and the CLI: `bootstrapWorkspace`, `getWorkspace`, `exportSnapshot`, `debugDecision`, plus `applications`, `principals`, `roles`, `memberships`, `policies`, `directGrants`, `sessions`, `audit`. Direct table editing is intentionally **not** part of the public contract.

### Authorization model

Table-driven RBAC and ABAC. Policies evaluate to field-level effects — `allow`, `deny`, `mask`, and `readonly` — with `maskValue()` exported for applying masking. Conditions and policy sets are independently testable via `evaluateCondition` / `evaluatePolicies`.

## Implemented capabilities (verified in source)

**Authentication**
- Password login
- Magic link issuance + redemption
- Passkeys / WebAuthn registration and authentication (`passkeys.js`)
- TOTP and recovery-code MFA (`totp.js`)

**Enterprise identity / federation** (`federation.js`, `oidc.js`, `saml.js`)
- Shared identity providers with per-application OIDC/SAML bindings
- Domain-routed enterprise sign-in with deterministic JIT account linking
- Live OIDC authorization-code verification
- Live SAML signed-response validation + SAML metadata generation
- Claim mapping (subject / email / displayName, configurable paths)

**Sessions & security**
- Signed access tokens, opaque hashed refresh tokens, refresh rotation
- Session revocation and cross-app session isolation
- Rate limiting and brute-force protection
- Audit events
- Baseline hardening for magic-link response safety, app-access enforcement, and forged-logout protection

**Storage**
- In-memory adapter (default; indexed hot-path lookups + exact-filter caches)
- File storage adapter
- Postgres adapter: one table per auth domain, document payload in `jsonb`, plus schema SQL and indexes for common query surfaces

**Operations**
- CLI commands: `migrate`, `studio`, `bootstrap`, `seed-demo`, `seed-launch-demo`
- Local Studio web app: app/user/role/policy management and a basic policy debugger, talking to the runtime only through validated admin APIs
- Serverless adapter: normalizes API Gateway / Lambda v1+v2 events into the runtime's request shape and routes by `METHOD path`

## Deployment lanes

| Lane | Status | Notes |
|------|--------|-------|
| Embedded Node + Postgres | **Recommended / primary** | First priority for docs, perf, and hardening. Runnable reference with Docker Compose + smoke check. |
| Docker Compose (Node + Postgres) | Supported | Prod-like local validation; explicit migrations/bootstrap. |
| Lambda + DynamoDB | Reference/example | Proves serverless compatibility via the adapter; local `invoke.ts` smoke. |

Every lane is expected to prove the same nine-step smoke sequence: bootstrap → app create → principal create → role/permission assign → login → protected allow → protected deny → refresh/revoke → audit event.

## Testing & quality

- **Unit:** `npm test` — Node's built-in test runner across `packages/*/test`.
- **E2E:** `npm run playwright:install && npm run test:e2e` — Playwright covers Studio and runtime flows (password, magic link, TOTP, refresh, revoke, allow/deny/mask), wired into a dedicated GitHub Actions workflow.
- **Performance:** `npm run perf:bench -- --assert` — repeatable harness with documented budgets in `docs/PERFORMANCE.md`.
- **Reference smokes:** `npm run smoke:postgres-example`, `npm run smoke:lambda-example`.

## Documentation set

`docs/MASTER_GUIDE.md` is the canonical entry point. Supporting docs: `ARCHITECTURE.md`, `GO_LIVE.md`, `PERFORMANCE.md`, `THREAT_MODEL.md`, `SECURITY_AUDIT.md`, `LAUNCH_ASSETS.md`, `RELEASE_NOTES_RC1.md`, and the versioned contracts in `docs/contracts/` (API, CLI, STORAGE, CONFIG, DEPLOYMENT_MATRIX). Open-source governance files (LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, SECURITY, SUPPORT, CHANGELOG, issue/PR templates, dependabot, CI) are in place.

## Known gaps / explicit non-goals (today)

The API contract currently does **not** guarantee, and the project has not yet shipped:

- Stable public WebAuthn/passkey ceremony APIs, SAML/OIDC provider APIs as versioned contract surfaces (implemented internally, not yet contract-frozen)
- SCIM and richer lifecycle/identity provisioning
- Compliance-oriented export flows
- External (third-party) security review and provider-specific federation interoperability hardening
- Larger-scale Postgres/runtime performance profiling
- A first-party SDK that makes integration "a few lines" across many products (the integration surface today is the package API + adapters, not a one-line client)
- Native mobile SDKs / mobile-specific session and token flows
- An MCP server interface

These gaps are exactly what the launch roadmap targets.

## One-paragraph summary

Blindfold Auth is a working, pre-1.0, local-first auth runtime with a genuinely broad feature set already in code — password, magic link, passkeys, TOTP/MFA, RBAC+ABAC with field-level effects, OIDC/SAML enterprise federation with JIT linking, sessions with rotation, rate limiting, and audit — exposed through a single `createAuth()` API, a CLI, a local Studio, and memory/file/Postgres/serverless storage paths, all backed by unit, E2E, and performance test layers. The work remaining to reach the stated end goal is less about core auth primitives and more about **packaging and reach**: a one-line drop-in client/SDK, an MCP/CLI distribution surface, mobile support, dynamic/adaptive security, and the enterprise lifecycle (SCIM) and external-audit credibility needed for production adoption across many products.
