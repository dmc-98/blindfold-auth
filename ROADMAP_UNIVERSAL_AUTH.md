# Blindfold Auth — Universal Drop-In Launch Roadmap

_Updated May 30, 2026. Scoped to a specific end goal; complements (does not replace) the build-out plan in `ROADMAP.md`. Codebase facts are grounded in `docs/CODEBASE_STATE.md` and the source._

## End goal

> One auth system I can drop into **all my products in a few lines of code** — distributed as an **MCP server and/or CLI** — with a **full auth feature set including RBAC and ABAC**, **dynamic/adaptive security**, **SSO**, **any database (SQL or NoSQL)**, **mobile compatibility**, **dead-simple local testing**, and an **interactive playground**.

Target developer experience:

```js
// Any product, any backend, any database — a few lines.
import { blindfold } from "@blindfold/client";

const auth = blindfold({
  project: "my-app",
  secret: process.env.BLINDFOLD_SECRET,
  storage: "postgres",          // or "mongo", "dynamo", "sqlite", "redis", "memory"
});

app.use(auth.protect());                          // authn
app.get("/admin", auth.protect({ can: "admin:read" }), handler); // authz (RBAC/ABAC)
```

…reachable the same way from a CLI (`blindfold add auth`), from an MCP server (an agent wires auth for you), from mobile SDKs, and explorable in a hosted/local playground.

## Honest baseline (what already exists)

The auth engine is largely built. Verified in source: password, magic link, passkeys/WebAuthn, TOTP+recovery MFA, **RBAC + ABAC with field-level effects**, OIDC/SAML federation with domain routing and JIT linking, signed sessions + refresh rotation, rate limiting, audit — all behind `createAuth()`, with a CLI, local Studio, memory/file/Postgres/serverless storage, and unit + Playwright + perf tests.

Two facts that de-risk this roadmap substantially:

1. **Storage is already backend-agnostic by contract.** Every adapter implements just five methods — `ensureTables`, `list(table, filter)`, `get(table, id)`, `put(table, record)`, `delete(table, id)` — and the contract explicitly says an adapter "may create schemas, tables, collections, or documents." A NoSQL adapter already exists in the `lambda-dynamodb` example. So "any SQL or NoSQL DB" is **shipping more conforming adapters**, not redesigning the engine.
2. **The schema is pre-wired for what's missing.** `TABLES` already declares `risk_events` (dynamic security), `webauthn_credentials`, `federated_identities`, `policy_rules`/`role_permissions`/`direct_grants`/`policy_versions` (RBAC+ABAC), and `auth_challenges`. The data model anticipated these features.

The real gap is **packaging, reach, and developer experience** — not core primitives.

---

## Now / Next / Later (orientation)

- **Now (0–6 wks):** thin client SDK (few lines), RBAC/ABAC ergonomics, freeze SSO contract, easy local-test mode.
- **Next (6–18 wks):** universal storage (SQL+NoSQL adapters), MCP + CLI distribution, dynamic security, playground.
- **Later (18+ wks):** mobile, SCIM + enterprise lifecycle, external audit, marketing/GTM launch, 1.0.

---

## Milestone map

| # | Milestone | End-goal feature it unlocks | Depends on |
|---|-----------|------------------------------|------------|
| M1 | Drop-in client SDK + framework adapters | "a few lines of code" | — |
| M2 | RBAC + ABAC productization | "RBAC and ABAC" | M1 |
| M3 | SSO contract freeze (OIDC/SAML) | "SSO" | M1 |
| M4 | Universal storage (SQL + NoSQL) | "any database" | M1 |
| M5 | Easy local testing / test mode | "local testing should be easy" | M1 |
| M6 | MCP server + CLI distribution | "MCP or CLI for all products" | M1, M4 |
| M7 | Dynamic / adaptive security | "dynamic security" | M2, session/device inventory |
| M8 | Interactive playground | "playground" | M1, M5 |
| M9 | Mobile compatibility | "mobile compatible" | M1, M6 |
| M10 | Enterprise lifecycle (SCIM) + external audit | "full auth system," prod trust | M3, M7 |
| M11 | Marketing site + GTM kickoff | launch & adoption | M1, M8 |
| M12 | 1.0 release (contract freeze + publish) | the goal, shipped | all |

Each milestone below is written to stand alone: **Goal · Scope · Codebase grounding · Exit criteria.**

---

## M1 — Drop-in client SDK (the keystone)

**Goal.** Reduce integration from "wire up `createAuth()` + an adapter + handlers" to a few lines, behind one factory.

**Scope.**
- `@blindfold/client`: a `blindfold({ project, secret, storage, ... })` factory that picks storage, runs `ensureTables`, and returns mountable middleware (`protect()`) and prebuilt route handlers (login, refresh, logout, magic link).
- Framework adapters: Express, Fastify, Hono, Next.js (route handlers + middleware) — each reducing a protected route to ≤5 lines.
- `storage` accepts a string alias (`"postgres"`, `"memory"`, `"file"`, …) resolved to an adapter, or a custom adapter object.
- `blindfold init` command to scaffold config + secret.

**Codebase grounding.** Wraps the existing `createAuth()`, `createMemoryStorage`/`createFileStorage`, `createPostgresStorage`, `auth.protect()`, and `auth.handlers.*`. No engine changes — pure ergonomics layer.

**Exit criteria.** A brand-new Node app adds password + session auth in ≤5 lines plus one config file, verified end-to-end in CI, with no direct `createAuth()` boilerplate.

---

## M2 — RBAC + ABAC productization

**Goal.** Make the already-implemented authorization engine first-class, easy to author, and easy to call from the SDK.

**Scope.**
- **SDK surface:** `auth.protect({ can: "resource:action" })`, `auth.can({ principal, action, resource, field, tenant })`, and a typed decision result `{ allowed, effect, matchedRuleIds, obligations, reason }`.
- **RBAC:** roles, role→permission mappings, memberships, and direct grants — exposed through SDK + admin API helpers, not raw tables.
- **ABAC:** attribute conditions on `policy_rules`, tenant-aware resolution, and **field-level effects** `allow` / `deny` / `mask` / `readonly` (with `maskValue()` applied automatically on responses).
- **Obligations:** surface `maskedFields` / `readonlyFields` so apps can enforce field masking from the decision output.
- **Authoring UX:** policy templates ("admin", "member", "read-only", "tenant-isolated"), a policy linter, and the Studio policy debugger upgraded to "explain this decision" (which rule matched and why).
- **Versioning:** use `policy_versions` for diff + rollback.

**Codebase grounding.** `policy.js` already implements RBAC + ABAC, hard-deny / explicit-deny precedence, field effects, and returns `obligations: { maskedFields, readonlyFields }`. `evaluateCondition` / `evaluatePolicies` are exported and independently testable. Tables `roles`, `role_permissions`, `policy_rules`, `direct_grants`, `policy_versions`, `memberships` all exist. This milestone is **exposure + authoring UX**, not new evaluation logic.

**Exit criteria.** A developer can define roles and an ABAC rule with field masking via SDK/Studio, protect a route with one option, and get a human-readable explanation of any allow/deny decision.

---

## M3 — SSO contract freeze (OIDC/SAML)

**Goal.** Promote enterprise SSO from "implemented but internal" to a stable, documented, few-lines-to-configure feature.

**Scope.**
- Freeze public APIs for identity providers + per-application bindings (currently listed as non-goals in `docs/contracts/API_CONTRACT.md`).
- One-config provider setup: domain-routed sign-in, claim mapping (subject/email/displayName), JIT linking, per-app OIDC/SAML bindings.
- Connection guides for Okta, Entra ID, Google Workspace, Ping.
- SAML metadata generation endpoint + OIDC discovery wired into the SDK.

**Codebase grounding.** `federation.js`, `oidc.js`, `saml.js` already do live OIDC auth-code verification, live SAML signed-response validation, metadata generation, domain routing, deterministic JIT linking, and claim mapping. Tables `identity_providers`, `application_identity_providers`, `federated_identities` exist. Work is **contract-freezing + config ergonomics + docs**.

**Exit criteria.** Adding an enterprise OIDC or SAML connection to a product is a documented, versioned, few-lines config; a sample app logs in via a real IdP in E2E.

---

## M4 — Universal storage (SQL + NoSQL)

**Goal.** Deliver on "any database" by shipping a family of adapters that conform to the 5-method storage contract.

**Scope.**
- **SQL:** Postgres (exists), MySQL/MariaDB, SQLite (great for local + edge), plus a generic `knex`/SQL-builder adapter for long-tail SQL engines.
- **NoSQL:** MongoDB (document-native — maps cleanly to the table-as-collection model), DynamoDB (promote the example into a real package), Redis (sessions/rate-limit hot paths or full store), Cloudflare D1/KV for edge.
- **Adapter conformance kit:** a shared test suite any adapter runs to prove `ensureTables/list/get/put/delete` semantics and the nine-step smoke sequence.
- **Indexing/migration story per backend** (SQL migrations; NoSQL index hints), documented in `docs/contracts/STORAGE_CONTRACT.md`.
- **Hybrid storage:** allow different tables on different backends (e.g., sessions in Redis, everything else in Postgres).

**Codebase grounding.** The contract is exactly five methods over "schemas, tables, collections, or documents"; `createMemoryStorage`/`createFileStorage` and the Postgres adapter (`buildPostgresSchemaSql`, `getPostgresMigrationPlan`, `runPostgresMigrations`, `createPostgresStorage`) are reference implementations, and `lambda-dynamodb` proves a NoSQL backend works. New adapters are **additive packages** behind a proven interface.

**Exit criteria.** At least one new SQL adapter (SQLite or MySQL) and one new NoSQL adapter (MongoDB) pass the shared conformance suite and the nine-step smoke sequence, selectable by `storage:` alias in the SDK.

---

## M5 — Easy local testing after integration

**Goal.** After dropping in auth, testing locally should be trivial — no IdP, no DB, no key management to start.

**Scope.**
- **Test mode:** `blindfold({ mode: "test" })` → in-memory storage, deterministic secret, fast-forwardable clock for TTL/refresh tests, and a "test IdP" that simulates OIDC/SAML callbacks (the repo already has local demo callback flows for SAML — generalize them).
- **Fixtures + factories:** `seed()` helpers to create workspaces, apps, users, roles, and policies in one call; reuse/extend the existing `seed-demo` / `seed-launch-demo` CLI paths.
- **Test utilities package** (`@blindfold/testing`): mint a valid session/token for a fake user, assert allow/deny without standing up HTTP, snapshot audit events.
- **Ephemeral DB helpers:** SQLite-file or in-memory backend for unit tests; Docker-Compose Postgres for integration (the postgres example already provides this).
- **One-command smoke:** `blindfold doctor` verifies an integration end-to-end (bootstrap → login → protected allow/deny → refresh → audit).

**Codebase grounding.** In-memory adapter with `reset()`, file storage, the nine-step smoke sequence, `seed-demo`/`seed-launch-demo`, local SAML demo callbacks, and Playwright E2E already exist. This milestone packages them into a first-class testing story.

**Exit criteria.** A developer can write a passing auth test (login + RBAC allow/deny + masked field) with no external services, in under 20 lines, using `@blindfold/testing`.

---

## M6 — MCP server + CLI distribution

**Goal.** Let an agent/IDE or a CLI wire Blindfold into any product — the "use it across all my products" multiplier.

**Scope.**
- `@blindfold/mcp`: MCP tools for create project, configure providers/SSO, define roles/policies, generate the client snippet for the detected framework, issue/rotate keys, and inspect sessions/audit.
- CLI extensions on the existing binary: `blindfold add auth`, `blindfold providers add`, `blindfold roles`, `blindfold keys`, `blindfold doctor`.
- **Multi-project key model:** per-project secrets/API keys so many products share one control plane safely (decide here, document in M1).
- MCP and CLI both call the same admin API the runtime already exposes.

**Codebase grounding.** The CLI already has `migrate/studio/bootstrap/seed-demo/seed-launch-demo`; the admin surface (`auth.admin.*`) is the supported write path. MCP/CLI are **new front ends over an existing API**.

**Exit criteria.** Auth can be added to a fresh product end-to-end via MCP or CLI without hand-editing code, and two projects run from one workspace with isolated keys.

---

## M7 — Dynamic / adaptive security

**Goal.** Move beyond static rate limits to risk-aware, step-up authentication.

**Scope.**
- **Signals:** device/session inventory, new-device detection, impossible-travel, login velocity, and IP reputation — written to `risk_events`.
- **Risk scoring:** a pluggable scorer turning signals into a score/level.
- **Step-up MFA:** when risk is elevated, require TOTP/passkey re-verification — delivered as a policy **obligation** so the decision engine drives it.
- **Operator controls:** risk rules and thresholds configurable; risk events visible in Studio.

**Codebase grounding.** `risk_events` table already exists; rate limiting + brute-force protection + audit provide raw signals; `can()` already returns `obligations`, the natural channel for step-up. Session/device inventory aligns with a Phase 1 item in `ROADMAP.md` — sequence them together.

**Exit criteria.** A configured risk rule (e.g., new device + sensitive action) triggers step-up MFA via an obligation, with the event recorded and visible to operators.

---

## M8 — Interactive playground

**Goal.** Let anyone try the full auth lifecycle in minutes, in-browser, before installing anything.

**Scope.**
- **Hosted + local playground** (`blindfold playground`): a sandbox workspace where you create users/roles/policies and exercise password, magic link, passkey, TOTP, SSO (simulated IdP), session refresh/revoke, and live RBAC/ABAC allow/deny with field masking.
- **Policy explorer:** edit a rule, hit "evaluate," see the decision + matched rules + obligations live (reuse the policy debugger).
- **Copy-paste snippets:** every action shows the equivalent `@blindfold/client` code and the matching cURL.
- **Storage switcher:** demonstrate the same flows over memory/SQLite to show backend-agnosticism.
- Built on the existing Studio + runtime; resettable, seeded via `seed-launch-demo`.

**Codebase grounding.** Studio (`auth-studio`, ~940 LOC) already provides app/user/role/policy management and a policy debugger over validated admin APIs; `seed-launch-demo` and local demo callbacks exist. The playground is a guided, resettable Studio mode plus snippet generation.

**Exit criteria.** A visitor completes login → role assignment → ABAC masked-field decision → session revoke in the playground without installing anything, and copies working code for their stack.

---

## M9 — Mobile compatibility

**Goal.** First-class mobile auth on the same project as web/server.

**Scope.**
- Mobile-tuned token flows: longer-lived rotating refresh tokens, secure-storage guidance (Keychain/Keystore), and PKCE for native OIDC.
- Passkey/biometric handoff on iOS/Android.
- Thin client SDKs (React Native first; Swift/Kotlin or a documented REST contract that mobile apps consume directly).
- Deep-link handling for magic links and SSO redirects.

**Codebase grounding.** Passkeys/WebAuthn, magic links, OIDC, and refresh rotation already exist server-side; this is a **client contract + mobile SDK** effort plus a secure-storage review.

**Exit criteria.** A mobile app and a web app authenticate against one Blindfold project, including passkey login and token refresh, with a documented secure-storage pattern.

---

## M10 — Enterprise lifecycle (SCIM) + external security audit

**Goal.** Reach credible "full auth system" status for B2B/workforce adoption.

**Scope.**
- SCIM provisioning/deprovisioning and delegated app admin.
- Compliance-oriented export flows (users, audit).
- Third-party security review: threat model refresh, auth-bypass + crypto/signing review, dependency + secret scanning, static analysis; close critical/high findings.
- Provider-specific federation interoperability hardening (Okta/Entra/Google/Ping).

**Codebase grounding.** Internal `THREAT_MODEL.md` + `SECURITY_AUDIT.md` and baseline hardening exist; `ROADMAP.md` already lists SCIM and external review as later phases. This is the "make it enterprise-trustworthy" milestone.

**Exit criteria.** An enterprise pilot runs SSO + SCIM; the external audit's critical/high findings are closed or explicitly accepted in writing.

---

## M11 — Marketing site + go-to-market kickoff

**Goal.** Give the project a front door that converts: explain it, prove it, and get developers to first success fast.

**Scope.**

_Landing page (the centerpiece)_
- Hero: "Full-featured auth for any app, any database — in a few lines. Your data, your infrastructure." with the 3-line snippet front and center.
- Feature sections: password/magic link/passkeys/MFA · **RBAC + ABAC with field-level masking** · SSO (OIDC/SAML) · **any SQL or NoSQL database** · dynamic security · mobile · local-first / self-hosted.
- Embedded/linked **playground** (M8) as the primary CTA — "try it now, no signup."
- Comparison table vs Auth0, Clerk, Supabase Auth, Keycloak — leading with data-ownership, no per-MAU pricing, and DB-agnosticism.
- Live code tabs (Express/Next/Fastify) and a copy-paste quickstart.
- Demo GIFs/screenshots from the existing Playwright launch-assets harness (`npm run launch:assets`).
- Logos/social proof placeholder, FAQ, and a clear "self-host vs managed" explainer.

_Docs site_
- Versioned docs from `docs/` (MASTER_GUIDE as entry point), framework quickstarts, storage-adapter guides, RBAC/ABAC cookbook, SSO connection guides, migration guides.

_Launch kit_
- README polish + asset embeds (partly done), Product Hunt / Hacker News / r/webdev / r/selfhosted posts, a launch blog post ("why local-first auth"), a 90-second demo video, and an example-apps gallery.
- Positioning + pricing/licensing decision (OSS core + optional managed/enterprise), and a community channel (Discord/Discussions).
- Analytics + conversion funnel (landing → playground → install → first protected route).

**Codebase grounding.** `docs/LAUNCH_ASSETS.md`, `RELEASE_NOTES_RC1.md`, the Playwright asset harness, and the full OSS governance set already exist — the raw materials for a launch are in the repo.

**Exit criteria.** A public landing page + docs site are live, the playground is the primary CTA, and the launch funnel is instrumented end-to-end.

---

## M12 — 1.0 release

**Goal.** Lock contracts and ship the "drop-in auth for any product" release.

**Scope.** Freeze and version all public contracts (client SDK, runtime, MCP, CLI, storage, SSO, RBAC/ABAC); publish all packages; tag 1.0; coordinate the M11 launch.

**Exit criteria.** Packages are public at 1.0 with frozen contracts, and a new user goes from landing page → playground → installed → protected route without guesswork.

---

## Sequencing logic & dependencies

- **M1 is the keystone.** MCP (M6), playground (M8), mobile (M9), and the landing page (M11) are all different front ends over the same thin client + admin API. Building them before M1 means re-implementing wiring repeatedly.
- **M2 (RBAC/ABAC) and M3 (SSO) run parallel to M1** — both are mostly exposure/contract-freeze over working code.
- **M4 (storage) should precede M6 (MCP/CLI)** so "pick your database" is real when distribution lands, and precede M11 so the landing page's DB-agnostic claim is demonstrable.
- **M5 (test mode) pairs with M1** — ship them together so the first integration is also the first easy test.
- **M7 (dynamic security) needs session/device inventory** (a Phase 1 item in `ROADMAP.md`); align them so risk scoring has device data.
- **M8 (playground) feeds M11 (GTM)** — it's the landing page's main CTA, so it must exist before launch.
- **M10's external audit should follow M7**, so adaptive security is in audit scope.

## Top risks

- **Scope creep on the engine.** The blocker is packaging, not primitives — hold the line on wrapping over rebuilding.
- **Multi-project key/secret model.** "All my products from one system" shifts trust from single-app to control-plane; decide it in M6 and document it in M1, or retrofitting is expensive.
- **Storage conformance drift.** Without the shared adapter test kit (M4), each new DB risks subtle behavior differences — build the conformance suite before the third adapter.
- **"Dynamic security" is open-ended.** Ship a concrete v1 (new-device + impossible-travel + velocity + step-up) rather than chasing unbounded ML.
- **Mobile token storage** is a security surface, not a port — budget secure-storage + refresh-rotation review.

## First two weeks (concrete)

1. Scaffold `@blindfold/client` wrapping `createAuth()`; Express adapter → protected route in ≤5 lines.
2. Add `storage:` alias resolution (`memory`/`file`/`postgres`) and a `blindfold init` scaffold command.
3. Ship `@blindfold/testing` v0 (`mode: "test"`, mint-session helper, allow/deny assertions) and convert one example app's tests to it.
4. Open a contract PR promoting OIDC/SAML provider APIs and the RBAC/ABAC SDK surface to public + versioned.
5. Stand up the storage adapter conformance suite and run it against memory + Postgres as the baseline.
6. CI gate: quickstart compiles and passes the nine-step smoke sequence on every PR.
