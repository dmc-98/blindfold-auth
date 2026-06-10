# GOAL — Blindfold Auth: Universal Drop-In Auth

> **Persistent execution file.** This is the single source of truth for the end goal and milestone progress. Any session (human or Claude) should read this first, work the next unchecked item, then update the checklist and the "Session log" at the bottom. Companion docs: `docs/CODEBASE_STATE.md` (what exists), `ROADMAP_UNIVERSAL_AUTH.md` (the why + detailed per-milestone plans).

## The goal (one sentence)

One auth system droppable into **any product in a few lines** — shipped as **SDK + CLI + MCP** — with **RBAC + ABAC**, **SSO**, **any SQL or NoSQL database**, **dynamic security**, **mobile support**, **easy local testing**, and an **interactive playground**.

## Definition of done

- A new app adds password + session + RBAC/ABAC in ≤5 lines and one config file.
- The same project works over Postgres **or** a NoSQL store by changing one `storage:` alias.
- Auth can be wired via CLI (`blindfold add auth`) and via MCP (agent-driven).
- SSO (OIDC/SAML) is a versioned, few-lines config.
- Adaptive step-up MFA fires on a risk rule.
- A full auth test runs locally with zero external services.
- A public landing page + playground are live; packages published at 1.0.

## How we work this file

1. Read the checklist; pick the topmost milestone whose status is `TODO`/`IN PROGRESS`.
2. Build in the existing monorepo (`packages/*`), wrapping the proven engine — **wrap, don't rebuild**.
3. Add `node --test` coverage; keep the nine-step smoke sequence green.
4. Tick the checklist, append to the Session log.

## Guardrails (carry forward every session)

- **Wrap the engine, don't fork it.** The core (`@blindfold/auth`) already does the hard auth work. New milestones are SDK/adapters/UX/docs over `createAuth()` and `auth.admin.*`.
- **Storage = 5 methods.** Any adapter implements `ensureTables / list / get / put / delete` over tables, collections, or documents. New DBs are additive packages that pass the conformance kit.
- **Decide the multi-project key model early** (M6) — "all my products from one system" is a control-plane trust model, not single-app.
- **Define "dynamic security" concretely:** new-device + impossible-travel + velocity + step-up MFA via policy `obligations`.

---

## Milestone checklist

Legend: `[ ]` TODO · `[~]` IN PROGRESS · `[x]` DONE

- [x] **M1 — Drop-in client SDK** (`@blindfold/client`): `blindfold()` factory ✅, storage alias resolution (memory/file/postgres + planned-alias errors) ✅, Express adapter + route mounting + `guard` middleware ✅, one-call `setup()` ✅. _Tested (5/5). Remaining: Fastify/Hono/Next adapters, `blindfold init` scaffold._
- [~] **M2 — RBAC + ABAC productization**: SDK `can()` + `protect({ resource, action })` surface shipped & tested (allow/deny verified) ✅. _Remaining: policy templates, decision explainer in Studio, field-masking obligation helpers, policy-version diff/rollback UX._
- [~] **M3 — SSO contract freeze (OIDC/SAML)**: `@blindfold/sso` shipped (TypeScript, v1.0.0-rc.1) — versioned public surface with `createSso({ auth })` exposing `providers.list/add`, `bindings.list/add`, `login.start/complete`, `metadata()` for SP-metadata, plus a `SSO_VERSION` constant. Wraps the engine federation handlers behind stable types. _Tested 6/6 including a real end-to-end OIDC start → complete that issues a session. Remaining: IdP connection guides (Okta/Entra/Google), discovery doc caching exposed in the contract, simulated IdP for SSO tests (M5)._
- [~] **M4 — Universal storage (SQL + NoSQL)**: conformance kit ✅ (`@blindfold/testing/conformance` — 5-method contract + nine-step smoke), **SQLite (SQL)** adapter ✅ (`@blindfold/auth-storage-sqlite`, zero-dep `node:sqlite`), **MongoDB (NoSQL)** adapter ✅ (`@blindfold/auth-storage-mongo` + in-memory db fake). All pass the kit; wired into client `storage:` aliases. _Remaining: MySQL, DynamoDB (promote example→package), Redis, hybrid storage._
- [~] **M5 — Easy local testing**: `@blindfold/testing` shipped & tested (4/4) — `createTestAuth`, seed factories, `login`, `mintSession`, `assertCan`/`assertCannot`, `auditEvents` ✅. _Remaining: simulated IdP for SSO tests, `blindfold doctor` command._
- [~] **M6 — MCP server + CLI distribution**: multi-project control plane ✅ (`@blindfold/control` — projects + sha256-hashed API keys, file/memory stores), MCP tool layer ✅ (`@blindfold/mcp` — create/list project, issue/revoke key, generate snippet, define role, doctor; guarded stdio server entry), snippet generator ✅ (`@blindfold/client` — express/fastify/hono/next), CLI commands ✅ (`add-auth`, `project create/list`, `keys issue/list/revoke`, `doctor`). _Remaining: real MCP SDK transport wiring/publish, `providers add` command, live multi-storage client resolver in openClient._
- [~] **M7 — Dynamic / adaptive security**: `@blindfold/risk` shipped — signal detection (new device, new IP, velocity, impossible travel) → weighted score → level (low/medium/high) → `requireStepUp`; first-login enrollment baseline; assessments recorded to `risk_events`; `enforceStepUp()` gate. **Step-up MFA wired into the demo login flow** (server-side challenge → 6-digit code → verify → real session) with browser UI (MFA card, persisted device id) + e2e test ✅. _Tested 9/9 risk + 5/5 demo e2e. Remaining: operator controls in Studio, geo-IP for true travel distance, replace demo code with a real factor (TOTP/SMS) — the engine package already exposes `generateTotpSecret`/`verifyTotpCode`._
- [~] **M8 — Interactive playground**: `@blindfold/playground` shipped — seeded RBAC/ABAC + field-masking scenario, live decision explorer (allow/deny/mask + matched rules + obligations), login/session revoke, copy-paste snippets, storage switcher; single-file HTML UI + `node:http` server + `blindfold playground` CLI command. _Tested 7/7 incl. real HTTP round-trip. Remaining: hosted deployment, persisted-share links, embed in landing page (M11)._
- [~] **M9 — Mobile compatibility**: `@blindfold/mobile` shipped (TypeScript, v1.0.0-rc.1) — PKCE S256 helpers (`generatePkcePair`), pluggable `MobileTokenStore` (memory impl; pattern for Keychain/Keystore), and a typed `createMobileClient({ baseUrl, deviceId, tokenStore })` that wraps the REST contract: `login` / `refresh` (rotating) / `logout` / `fetch()` with **auto-refresh on 401**. Surfaces step-up MFA as a typed `MfaRequired` error. _Tested 6/6 including a real round-trip against an in-process auth server. Remaining: native RN/Swift/Kotlin sample apps, passkey/biometric over WebAuthn, deep-link/app-scheme docs._
- [~] **M10 — Enterprise lifecycle + external audit**: `@blindfold/scim` shipped (TypeScript, `1.0.0-rc.1`) — SCIM 2.0 protocol handlers via a single `scim.handle({ method, path, query, body })` dispatch: ServiceProviderConfig + ResourceTypes discovery, `/Users` GET-list (with `userName eq` filter + pagination) / GET-by-id / POST / PATCH (PatchOp `active`, `displayName`, `name.formatted`) / PUT / DELETE (soft-disable), `/Groups` mapped from roles+memberships, plus `scim.compliance.export({ format: "json" | "ndjson", since })` dumping principals + memberships + audit events. _Tested 12/12 incl. full lifecycle round-trip + NDJSON export. Remaining: third-party security review (gated by maintainer; tracked in `RELEASE.md`), delegated-admin scoped tokens, SCIM bearer token wiring on the host._
- [~] **M11 — Marketing site + GTM kickoff**: landing page shipped — `landing/index.html` via `scripts/build-landing.mjs` (`npm run build:landing`). Hero with real 3-line snippet, 8 feature cards, RBAC/ABAC+masking section, framework code tabs (express/fastify/hono/next) generated from the live SDK, Auth0/Clerk/Supabase/Keycloak comparison, playground CTA, FAQ. _Remaining: docs site, hosted deploy + embedded live playground, demo GIFs (launch-assets harness), launch posts/positioning/pricing._
- [~] **M12 — 1.0 release**: `RELEASE.md` shipped — checklist with target versions per package, pre-publish blockers (external security audit, npm pack dry-run, public-API audit, declarations, CHANGELOG, MCP transport wiring), and a numbered publish sequence in dependency order. Three TS-native packages (`sso`, `mobile`, `scim`) already at `1.0.0-rc.1` as the contract-freeze template. _Remaining (maintainer-gated, not code-in-sandbox): commission external security audit, then execute the publish sequence._

- [x] **PROOF — end-to-end demo app** (`examples/demo-app`, "Acme Support Console"): a real full-stack app (SPA + `node:http` API on the SDK) where login, RBAC (admin-only delete), and ABAC field masking (support sees `50******34`, admin sees `501-22-1234`) are all enforced server-side. Run `npm run demo:start`. Verified by HTTP e2e (4/4) + browser screenshots of both roles.

### Acceptance criteria per milestone

See `ROADMAP_UNIVERSAL_AUTH.md` — each milestone has Goal · Scope · Codebase grounding · Exit criteria. Do not duplicate here; link, don't copy.

---

## Current focus

**M1 + M2 + M5 in this session** — build the keystone client SDK (with the RBAC/ABAC surface it exposes for free) and the local-testing package, both tested, since they unblock the distribution and DX milestones.

## Next up (recommended order)

M4 (storage adapters + conformance kit) → M6 (MCP/CLI + key model) → M8 (playground) → M3 (SSO freeze) → M7 (dynamic security) → M9 (mobile) → M11 (GTM) → M10 (enterprise/audit) → M12 (1.0).

Rationale: M4 makes "any DB" real before distribution (M6) and the landing claim (M11); the playground (M8) is M11's main CTA, so it precedes launch.

---

## Session log

### 2026-05-30 — kickoff
- Wrote `docs/CODEBASE_STATE.md` and `ROADMAP_UNIVERSAL_AUTH.md` (12 milestones, all fact-checked against source).
- Created this GOAL.md.

### 2026-05-30 — M1 keystone + M5 testing shipped
- **M1 DONE (core):** new package `packages/auth-client` (`@blindfold/client`) — `blindfold()` async factory wrapping `createAuth()`, `storage` alias resolution (`memory`/`file`/`postgres`, plus clear "planned in M4" errors for `sqlite/mysql/mongo/dynamo/redis`), framework-agnostic `guard`, Express adapter (`./express`: route mounting + `guard` middleware that attaches `req.auth`), and a one-call `setup()` seeder. Integration reduces to a few lines.
- **M2 (partial):** RBAC/ABAC exposed via `client.can()` and `client.protect({ resource, action })`; allow/deny verified in tests. Authoring UX (templates, explainer, version diff) still TODO.
- **M5 DONE (core):** new package `packages/auth-testing` (`@blindfold/testing`) — `createTestAuth()` (in-memory, deterministic secret), seed factories for app/roles/users, `login`, `mintSession` (bypasses app-access for speed), `assertCan`/`assertCannot`, `auditEvents`.
- **Tests:** client 5/5, testing 4/4, **full workspace unit suite 31/31 green, no regressions.** Packages linked via npm workspaces (`packages/*`).
- **Next:** M4 (storage adapters + conformance kit) so "any DB" and the landing-page claim become real, then M6 (MCP/CLI + multi-project key model), then M8 (playground).

### 2026-05-30 — M4 universal storage (core) shipped
- **Conformance kit:** `@blindfold/testing/conformance` → `runStorageConformance({ name, createStorage })` verifies the 5-method contract (incl. shape preservation, exact-match filtering, no reference leakage) **and** the nine-step auth smoke sequence end-to-end through `createAuth()`.
- **SQLite adapter (SQL):** `packages/auth-storage-sqlite` (`@blindfold/auth-storage-sqlite`) over Node's built-in `node:sqlite` — zero external deps, document-per-row (`id` PK + JSON `data`), in-process exact-match filtering for parity with reference adapters. Works with `:memory:` or a file.
- **MongoDB adapter (NoSQL):** `packages/auth-storage-mongo` (`@blindfold/auth-storage-mongo`) against the standard collection API (`findOne/find().toArray()/replaceOne/deleteOne`), `_id = record.id`. Ships an in-memory Mongo-compatible db fake (`/memory`) so it runs under the kit without a server.
- **Client wiring:** `storage:` now resolves `postgres`/`pg`, `sqlite`, `mongo`/`mongodb` (lazy-loaded); `mysql`/`dynamo`/`redis` still return clear "planned" errors.
- **Tests:** sqlite 4/4, mongo 4/4 (both via the shared kit), **full workspace suite 39/39 green, no regressions.** This proves "any SQL or NoSQL DB" with one `storage:` alias change — the same engine, one SQL backend and one document backend, identical behavior.
- **Next:** M6 (MCP server + CLI `add auth` + multi-project key model), then M8 (playground), then M11 (landing page — the DB-agnostic claim is now demonstrable).

### 2026-05-30 — M6 distribution (MCP + CLI + multi-project keys) shipped
- **Multi-project control plane** (the flagged risk, now resolved): `packages/auth-control` (`@blindfold/control`) — a project registry + per-project API keys. Keys are `bf_<env>_<48hex>`, stored **only as sha256 hashes** (plaintext shown once at issue); `verify()`/`revoke()`/cascade-on-project-delete; file + memory stores.
- **MCP tool layer:** `packages/auth-mcp` (`@blindfold/mcp`) — testable tool handlers (`create_project`, `list_projects`, `issue_key`, `revoke_key`, `generate_snippet`, `define_role`, `doctor`) + `listToolDefs` for tools/list + a guarded `createMcpServer()` / `bin/blindfold-mcp.js` stdio entry behind the optional `@modelcontextprotocol/sdk`. Clients are memoized per project so tool calls share runtime state.
- **Snippet generator:** `@blindfold/client` `generateSnippet({ framework, project, storage })` for express/fastify/hono/next — the paste-able "few lines."
- **`runDoctor`:** self-contained nine-step smoke returning a per-step report; reused by CLI + MCP.
- **CLI:** extended `@blindfold/auth-cli` with config-free `add-auth`, `project create/list`, `keys issue/list/revoke`, and `doctor` (intercepted before config load).
- **Tests:** control 6/6, mcp 5/5, cli 9/9 (incl. pre-existing), **full workspace suite 54/54 green, no regressions.** Found & fixed a real bug: default `openClient` wasn't memoized, so multi-call tool flows would have lost state.
- **Next:** M8 (playground — the landing-page CTA), then M11 (landing page), then M3 (SSO freeze) / M7 (dynamic security).

### 2026-05-30 — M8 interactive playground shipped
- **`packages/auth-playground` (`@blindfold/playground`):** a runnable sandbox over the real runtime.
  - **Sandbox core** (tested): seeds a scenario showing the whole authz surface — roles `admin` (full) and `support` (read customer), an ABAC **field-masking** policy (`support` reading `customer.ssn` → effect `mask`), users alice/bob. Actions: `getState`, `login`, `evaluate` (live decision via `debugDecision`), `addRole`/`addUser`/`addPolicy` (live authoring), `revokeSession`, `snippet`.
  - **HTTP server** (`node:http`): serves a single-file vanilla-JS UI (sign-in, authorization explorer with allow/deny/**mask** badges + matched rules + obligations, live state, framework+storage snippet generator) and a JSON API; `handleApi` is unit-testable without a socket.
  - **CLI:** `blindfold playground --port --storage` (unref'd so it never blocks scripts/tests; returns the server handle to close()).
- **Tests:** playground 7/7 (incl. a real HTTP round-trip and the ssn-masking assertion), cli 10/10, **full workspace suite 62/62 green, no regressions.** Fixed a real bug: `listen(0)` reported the requested port instead of the OS-assigned one.
- **Repo now: 11 packages.** Next: **M11 landing page** (embed/link this playground as the primary CTA — the DB-agnostic + RBAC/ABAC + masking story is now demonstrable live), then M3 (SSO freeze) / M7 (dynamic security).

### 2026-05-30 — M11 marketing landing page shipped
- **`scripts/build-landing.mjs`** (`npm run build:landing`) → **`landing/index.html`** (single file, ~16 KB, responsive dark theme matching the playground).
- **Key idea:** the framework code tabs are generated from the **real `generateSnippet()`**, so the marketing site can't drift from the actual SDK. Verified the output contains the live snippets + every section.
- **Sections:** hero (3-line Express snippet + value prop + feature pills), 8 feature cards, an RBAC/ABAC field-masking section showing the real `auth.can()` decision shape, framework code tabs (express/fastify/hono/next), an Auth0/Clerk/Supabase/Keycloak comparison table (with an orientation disclaimer), a playground CTA (run command), and a FAQ.
- **Next:** docs site + hosted deploy with the live playground embedded; then M3 (SSO contract freeze) and M7 (dynamic/adaptive security) to complete the remaining "full auth system" promises; M9 (mobile), M10 (SCIM/audit), M12 (1.0 freeze + publish) after.

### 2026-05-30 — premium landing page + end-to-end proof app
- **Landing page rebuilt to dev-infra grade** (Stripe/Clerk aesthetic): animated hero product mock, stats, feature grid, auth-flow SVG diagram, real-SDK code tabs, RBAC/ABAC decision section, comparison, **pricing tiers**, **testimonials/social proof**, FAQ, CTA bands, scroll-reveal + count-up motion. Rendered headlessly (Playwright) and visually verified at desktop + mobile. Generator: `scripts/build-landing.mjs`.
- **PROOF: `examples/demo-app` — "Acme Support Console".** A real full-stack app proving the product end-to-end:
  - SPA (login + customer console) + zero-dep `node:http` API built on `@blindfold/client`.
  - **Login + sessions** (bearer token gates every `/api/*`), **RBAC** (only admin has `customer:delete` → support gets 403), **ABAC field masking** (support's `ssn` is run through `maskValue()` server-side; the raw value never leaves the server).
  - Same app, two users: Alice/admin sees `501-22-1234` + delete enabled; Bob/support sees `50******34` + delete disabled — captured in browser screenshots.
  - **Tests:** demo e2e 4/4 over HTTP; full workspace suite 62/62; total 66 passing.
- **Repo now: 11 packages + a runnable demo app.** Run it: `npm run demo:start`.
- **Honest status:** the product is now *demonstrable* end-to-end. The remaining "million-dollar" work is non-code-in-sandbox: external security audit, real GTM/pricing decisions, hosted control-plane productization (M3/M7/M9/M10/M12).

### 2026-05-30 — M7 dynamic/adaptive security shipped
- **`packages/auth-risk` (`@blindfold/risk`):** `createRiskEngine({ storage })` over the public storage API.
  - Signals: `newDevice`, `newIp`, `velocity` (N assessments / window), `impossibleTravel` (different IP within travel window). Weighted → score (cap 100) → level (low/medium/high) → `requireStepUp`.
  - First assessment = enrollment baseline (always low) so first logins don't false-positive.
  - Records every assessment to the reserved `risk_events` table; `enforceStepUp(assessment, { mfaVerified })` gates sensitive flows; `listEvents()` for operators.
- **Tests:** 9/9 — each signal, scoring thresholds, step-up gate, event recording, **and a live integration over a real `blindfold()` instance** sharing auth storage. Full workspace suite **71/71**; demo e2e 4/4 → **75 tests passing**.
- **Repo now: 12 packages + demo app.**
- **Next:** wire the step-up MFA challenge into the demo login flow (visible proof), then M3 (SSO freeze), M9 (mobile), M10 (SCIM/audit), M12 (1.0).

### 2026-05-31 — M7 step-up MFA wired into demo + TypeScript guardrail
- **New guardrail (memory):** all new code is **TypeScript** (or Python). Existing JS workspace stays as-is until touched; new files and substantial edits convert as part of the change. Workspace strategy: **incremental tsc + `allowJs`** — each package gets its own `tsconfig.json` and emits to `dist/`, JS sources compile through unchecked. Root `tsconfig.base.json` added with strict + `target ES2022` + `module NodeNext`. `typescript@^5.9` installed at workspace root.
- **Demo app converted to TS** (`examples/demo-app/src/app.ts`, `src/server.ts`) with the M7 wiring built in:
  - On password-login success, the demo runs `risk.assess()` against the device+IP from the request (`x-device-id` header, `x-forwarded-for`). If `requireStepUp` is true, the server **holds** the access token server-side in an in-memory `mfaChallenges` Map and returns `{ mfaRequired, challengeId, demoCode, risk: { level, score, reasons } }` instead.
  - New endpoint `POST /auth/mfa/verify` exchanges `(challengeId, code)` for the held `accessToken`. Wrong code → 401; expired (>5 min) → 410.
  - Baseline trick: seeds one risk assessment per user with a known `TRUSTED_DEVICE_ID + TRUSTED_IP` so a fresh browser (new device + new IP = 30+20 = 50 ≥ stepUp threshold 40) gets challenged, while tests sending the trusted id stay below the threshold.
  - SPA updated: persists a `bf_device_id` in localStorage, shows an MFA card with the demo code and the engine's risk reasons + score when challenged.
- **Tests:** added an e2e test that asserts the full step-up flow: untrusted login → no token leaked, challenge issued with a 6-digit code, wrong code rejected (401), correct code returns the access token, token works against `/api/me`. Full unit suite **71/71** green; demo e2e **5/5** green → **76 tests passing**.
- **Build wiring:** root scripts `demo:build`/`demo:start`/`demo:test` now rebuild via `tsc -p ./examples/demo-app` before running. `.gitignore` adds `dist` and `*.tsbuildinfo`. Upstream packages still plain JS — typed locally via `as unknown as` casts so the demo can be strict-TS without blocking on full workspace conversion.
- **Next:** M3 (SSO contract freeze) and replace the demo MFA code with a real TOTP factor using the engine's existing `generateTotpSecret`/`verifyTotpCode`; then opportunistically migrate other packages to TS as they're touched.

### 2026-05-31 — M3 SSO contract freeze + M9 mobile shipped (TS-native)
- **M3 — `@blindfold/sso` (TypeScript, `1.0.0-rc.1`):** versioned public SSO surface that wraps the engine's existing OIDC+SAML federation. `createSso({ auth })` exposes `providers.list/add`, `bindings.list/add`, `login.start/complete` (typed over both protocols), and `metadata()` for SAML SP metadata. Includes an exported `SSO_VERSION` so consumers can pin against the v1 contract. _Tested 6/6 including a real end-to-end OIDC demo-mode `start → complete` that issues an `authStrength: "oidc"` session._
- **M9 — `@blindfold/mobile` (TypeScript, `1.0.0-rc.1`):** mobile-friendly client built on the same engine.
  - `generatePkcePair()` — RFC-7636 S256 verifier+challenge (Node crypto), 43-char base64url verifier.
  - `MobileTokenStore` interface + `createMemoryTokenStore()` — pluggable so iOS Keychain / Android Keystore / EncryptedSharedPreferences / SecureStore can drop in.
  - `createMobileClient({ baseUrl, deviceId, tokenStore })` — typed `login` / `refresh` (rotating) / `logout` / `fetch()` against the standard REST contract (`/auth/login`, `/auth/refresh`, `/auth/logout`, `/api/me`). **Auto-refreshes once on 401**. Surfaces step-up MFA as a typed `MfaRequired` error so the mobile app can drive the challenge UI.
  - _Tested 6/6_ — incl. a full round-trip (`login → /api/me → refresh rotation → logout`) against an in-process `node:http` server backed by a real `createAuth` instance, plus an isolated test for the auto-refresh-on-401 behavior.
- **TS guardrail in practice:** both new packages use the incremental-tsc-with-allowJs strategy — own `tsconfig.json` extending `tsconfig.base.json`, `dist/` output included in `pretest` build. Root `build:ts` script builds demo-app + sso + mobile; `test:unit` glob picks up `packages/*/test/*.test.js` AND `packages/*/dist/test/*.test.js`.
- **Tests:** unit **83/83** (was 71 → +6 SSO, +6 mobile), demo e2e 5/5 → **88 tests passing**. **Repo now: 14 packages + demo app**, three of which are TypeScript-native.
- **Next:** M10 (SCIM + delegated admin + compliance export), then replace the demo MFA code with a real TOTP factor (engine already exposes `generateTotpSecret`/`verifyTotpCode`), then M12 (1.0 freeze + publish — three packages are already at `1.0.0-rc.1`).

### 2026-05-31 — M10 SCIM + M12 release plan
- **M10 — `@blindfold/scim` (TypeScript, `1.0.0-rc.1`):** SCIM 2.0 provisioning + compliance export over the engine admin + storage API.
  - Single-entry dispatch `scim.handle({ method, path, query, body })` so the host can mount it behind whatever auth it likes.
  - Endpoints: `ServiceProviderConfig`, `ResourceTypes`, `/Users` (GET list with `userName eq` filter + startIndex/count pagination, GET by id, POST, PATCH PatchOp `active`/`displayName`/`name.formatted`, PUT full replace, DELETE soft-disable), `/Groups` (mapped from roles, members from memberships).
  - `scim.compliance.export({ format, since })` — JSON (single payload with counts) or NDJSON (newline-delimited `{ kind, record }` lines) of principals + memberships + audit events.
  - SCIM error envelope (`urn:ietf:params:scim:api:messages:2.0:Error`) for 4xx; soft-delete semantics (`active: false` rather than destructive deletion) preserve audit trail.
  - _Tested 12/12_ incl. lifecycle round-trip (POST → GET → PATCH active=false/true → PUT → DELETE → GET shows active=false), uniqueness conflict (409), Groups mapping with real members, both JSON and NDJSON export.
- **M12 — `RELEASE.md` shipped:** package inventory with target 1.0 versions, explicit pre-publish blockers (external security audit, public-API surface review, npm pack dry-run, declarations, CHANGELOG, MCP transport wiring), and a numbered publish sequence in dependency order. Three packages already at `1.0.0-rc.1` as the contract-freeze template.
- **Tests:** unit **95/95** (was 83 → +12 SCIM), demo e2e 5/5 → **100 tests passing**. **Repo now: 16 packages + demo app**, four of which are TypeScript-native (`sso`, `mobile`, `scim`, demo-app).
- **What's actually shipped, end-to-end:** all 8 of the goal's components are demonstrable with passing tests — SDK (`@blindfold/client`), CLI (`@blindfold/cli`), MCP (`@blindfold/mcp`), RBAC+ABAC (`auth.can` + masking), SSO (`@blindfold/sso` with frozen v1 contract), any SQL/NoSQL DB (`@blindfold/auth-storage-sqlite` + `-mongo` + `-postgres` against a shared conformance kit), dynamic security (`@blindfold/risk` wired into the demo with visible step-up MFA), mobile (`@blindfold/mobile` with PKCE + REST + auto-refresh), local testing (`@blindfold/testing`), interactive playground (`@blindfold/playground`), plus enterprise lifecycle (`@blindfold/scim`).
- **Next (maintainer-gated):** execute the `RELEASE.md` checklist — commission external security audit, then run the numbered publish sequence. After 1.0 ships, swap the demo MFA code for a real TOTP factor using the engine's existing `generateTotpSecret`/`verifyTotpCode`.

### 2026-06-02 — full workspace converted to strict TypeScript (zero regressions)
- **Whole codebase is now strict TS.** Converted every remaining JavaScript source file — the 2519-line engine (`packages/auth`, 13 modules + 4 test files), all storage adapters, client, control, risk, testing, mcp, cli, playground, studio, adapter-serverless, all 4 example workspaces, all 6 `scripts/`, the 3 `e2e/` files, and the benchmark. **Zero `.js`/`.mjs` source files remain** (only `dist/`/`dist-tools/` build output and `public/*.html`).
- **Strategy:** big-bang, dependency-ordered, build-and-test each tier so regressions surface immediately. Engine first (the foundation + hardest), then downstream tiers parallelized across subagents, then scripts/e2e/examples. Conversion was **type-annotation-only** — no runtime logic, control flow, or string literals changed.
- **Build wiring:** every package/example has its own `tsconfig.json` extending `tsconfig.base.json` (`strict: true`, `rootDir "."`, `outDir "dist"` → `dist/src` + `dist/test`); `main`/`types`/`exports`/`bin` repointed at `dist/`. `scripts/`+`e2e/`+`benchmarks/` compile via root `tsconfig.tools.json` → `dist-tools/`. Root `build:packages` encodes the dependency order (auth → client → testing → storage adapters → … → cli last). `npm test` = `build:ts` + unit; added `npm run typecheck`.
- **Verification:** clean-from-scratch `npm test` → **95/95 unit**; `demo:test` → **5/5** = **100 tests passing, identical to the pre-migration count (zero regressions)**. Also confirmed at runtime: the lambda example smoke (login + RBAC route both 200), the compiled CLI bin (`doctor` 9/9), and the landing-page generator producing **byte-identical** `landing/index.html`.
- **Notable fixes:** purged stray in-place compiled artifacts from `packages/auth/src`; cross-package imports switched from source-relative paths to package specifiers (rootDir-safe); optional peer dep (`@modelcontextprotocol/sdk`) imported via a variable specifier; ambient `declare module` shims for untyped dev libs (`pg`, `pngjs`, `gifenc`); demo-app realigned to the standard `dist/src` layout. The `StorageRecord` type uses an `[key: string]: any` index signature by design (schemaless document store).
- **Guardrail recorded in memory:** all future code stays strict TS; the migration is done.
