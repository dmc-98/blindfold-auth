# Blindfold Auth Master Guide

This is the single source of truth for understanding, running, and eventually deploying Blindfold Auth.

If you only read one document in the repository, read this one first.

## What Blindfold Auth is

Blindfold Auth is a local-first authentication and authorization workspace for JavaScript and TypeScript teams that do not want a hosted control plane.

The current repository is built around:

- an embedded runtime
- a local Studio started by the CLI
- a shared auth workspace model
- table-driven RBAC and ABAC
- passkey-first authentication
- shared enterprise provider records with per-app bindings
- a PostgreSQL storage adapter
- a serverless adapter and Lambda/DynamoDB reference example

## Current status

Available now in the repository:

- `@dmc--98/blindfold-auth` runtime
- `@dmc--98/blindfold-auth-cli`
- `@dmc--98/blindfold-auth-studio`
- `@dmc--98/blindfold-auth-storage-postgres`
- `@dmc--98/blindfold-auth-adapter-serverless`
- `examples/local-workspace`
- `examples/postgres-workspace`
- `examples/lambda-dynamodb`

Implemented now:

- workspace bootstrap
- application config
- principals, roles, memberships, and policies
- password auth
- magic links
- WebAuthn/passkeys with app-scoped credentials
- TOTP MFA
- shared OIDC and SAML provider configuration
- per-application provider bindings, domain routing, and deterministic JIT linking
- live OIDC authorization-code verification
- live SAML signed-response validation with `InResponseTo` checks
- SAML metadata generation and local federation callback flows for demos
- session rotation and revocation
- RBAC and ABAC evaluation
- field-level `allow`, `deny`, `mask`, and `readonly`
- audit events
- local Studio
- runnable Node + Postgres example with Docker-backed local database and smoke test
- Playwright E2E coverage for Studio and runtime auth flows
- baseline security hardening for magic-link responses, safe logout/revocation, app-access enforcement, and cross-app session isolation
- baseline performance audit work with benchmark harness, local storage hot-path indexing, and Postgres lookup indexes
- baseline OSS governance docs, issue templates, funding config, and GitHub automation

Still to harden after this tranche:

- provider-specific external OIDC/SAML interoperability hardening
- SCIM and JIT lifecycle expansion
- production-grade cloud deploy assets
- external security review and deeper Postgres/runtime performance profiling

## Reference docs

Use these together when working with the project:

1. `docs/ARCHITECTURE.md`
2. `docs/contracts/API_CONTRACT.md`
3. `docs/contracts/CLI_CONTRACT.md`
4. `docs/contracts/STORAGE_CONTRACT.md`
5. `docs/contracts/CONFIG_CONTRACT.md`
6. `docs/contracts/DEPLOYMENT_MATRIX.md`
7. `docs/PERFORMANCE.md`

## Repository map

- `README.md`: short entry point and quick start
- `CONTRIBUTING.md`: contributor workflow and expectations
- `SECURITY.md`: vulnerability handling and private reporting
- `docs/ARCHITECTURE.md`: system overview and deployment model
- `docs/PERFORMANCE.md`: benchmark command, budgets, and current baseline
- `SUPPORT.md`: where to ask for help
- `CHANGELOG.md`: release notes and user-facing changes
- `docs/contracts/API_CONTRACT.md`: runtime contract
- `docs/contracts/CLI_CONTRACT.md`: CLI contract
- `docs/contracts/STORAGE_CONTRACT.md`: storage adapter contract
- `docs/contracts/CONFIG_CONTRACT.md`: env-var and config contract
- `docs/contracts/DEPLOYMENT_MATRIX.md`: deployment maturity matrix
- `packages/auth`: core runtime and policy engine
- `packages/auth-cli`: local bootstrap and Studio launcher
- `packages/auth-studio`: local Studio server and UI
- `packages/auth-storage-postgres`: Postgres schema and adapter
- `packages/auth-adapter-serverless`: API Gateway/Lambda adapter
- `examples/local-workspace`: easiest local demo path
- `examples/postgres-workspace`: recommended Node + Postgres example
- `examples/lambda-dynamodb`: serverless reference example
- `.github/ISSUE_TEMPLATE`: issue intake forms
- `.github/workflows`: CI, CodeQL, dependency review, and release automation
- `.github/workflows/e2e.yml`: browser E2E workflow

## Quick start

The fastest way to understand the project today is the local workspace example.

```sh
npm install
npm run seed:launch-demo
npm run studio:example
```

Then open `http://localhost:4110`.

This path uses a file-backed local store so the repo is easy to run without a database during early development.

For the public launch kit, also run:

```sh
npm run playwright:install
npm run launch:assets
```

This generates the current screenshots and GIFs in `docs/assets/launch/`.

### Local verification commands

Use these from the repository root:

```sh
npm test
npm run playwright:install
npm run test:e2e
npm run test:all
npm run perf:bench -- --assert
```

`npm run playwright:install` downloads the Chromium binary Playwright needs for the browser suite.

For the current hardening notes, read:

- `docs/ARCHITECTURE.md`
- `docs/PERFORMANCE.md`

## Recommended deployment path

The recommended production direction is:

1. embed Blindfold Auth inside a Node.js application
2. use PostgreSQL as the primary workspace store
3. run Studio locally for setup and operational management

This is the path the product should optimize for first.

### Recommended production architecture

- Application runtime embeds `@dmc--98/blindfold-auth`
- PostgreSQL stores the auth workspace tables
- Studio runs locally through the CLI and connects to the same workspace
- App routes use `auth.protect()` and `auth.can()`
- Postgres schema is managed through versioned migrations

### Current state of that path

The runtime, migration contract, Docker-backed Postgres example, and smoke test path now exist in the repository. The remaining work is release hardening, deeper production ops guidance, and security/performance closure.

## Deployment lanes

### Lane A: Embedded Node + Postgres

This is the main deployment lane.

Target flow:

1. install the runtime and Postgres adapter
2. configure `workspaceId`, `secret`, and database connectivity
3. apply migrations for the Blindfold tables
4. bootstrap the workspace
5. run Studio locally to create apps, principals, roles, and policies
6. integrate protected routes in the host application
7. run smoke tests before production rollout

Minimum env/config expected for this lane:

- `BLINDFOLD_WORKSPACE_ID`
- `BLINDFOLD_SECRET`
- `BLINDFOLD_DATABASE_URL`
- `BLINDFOLD_POSTGRES_SCHEMA`
- `BLINDFOLD_STUDIO_HOST`
- `BLINDFOLD_STUDIO_PORT`
- application-specific runtime config

Reference implementation:

- `examples/postgres-workspace/blindfold.config.ts`
- `examples/postgres-workspace/.env.example`
- `examples/postgres-workspace/docker-compose.yml`
- `examples/postgres-workspace/smoke.ts`

Recommended commands from the repository root:

```sh
npm install
cp ./examples/postgres-workspace/.env.example ./examples/postgres-workspace/.env
set -a && source ./examples/postgres-workspace/.env && set +a
npm run postgres:up
npm run migrate:postgres-example
npm run bootstrap:postgres-example
npm run smoke:postgres-example
npm run studio:postgres-example
```

### Lane B: Docker Compose

This is the easiest team-oriented local/prod-like lane and it currently exists to make the recommended Node + Postgres path faster to adopt.

Target flow:

1. start Postgres through Docker Compose
2. start the host app with Blindfold embedded
3. run the bootstrap command
4. launch Studio locally
5. execute smoke tests

Current support in the repository:

- `examples/postgres-workspace/docker-compose.yml`
- `npm run postgres:up`
- `npm run postgres:down`

### Lane C: Lambda + DynamoDB

This is a reference lane, not the primary product path.

Current repository support:

- API Gateway style adapter exists
- Lambda example exists
- DynamoDB-like reference store exists

This lane should be documented and deployable, but it should not shape the main architecture decisions.

## Migration and bootstrap strategy

The project should standardize one migration story for the Postgres tables and one bootstrap story for creating the first workspace.

Current bootstrap commands (the workspace is TypeScript — build once, then use the npm scripts, which target the compiled `dist/` output):

```sh
npm run build:ts
npm run bootstrap:example   # bootstrap a workspace via examples/local-workspace
npm run seed:example        # seed a demo app/principal/role/policy
npm run seed:launch-demo    # seed passkey/OIDC/SAML launch demo data
```

Equivalent direct invocation (after `npm run build:ts`) uses the compiled bin + compiled config:

```sh
node packages/auth-cli/dist/bin/blindfold-auth.js bootstrap --config ./examples/local-workspace/dist/blindfold.config.js --workspace-name "Blindfold Demo Workspace"
```

Current Postgres example commands (after `npm run build:ts`):

```sh
npm run migrate:postgres-example
npm run bootstrap:postgres-example
npm run smoke:postgres-example
npm run studio:postgres-example
```

Target production shape:

- `blindfold-auth migrate`
- `blindfold-auth bootstrap`
- `blindfold-auth seed-demo`
- `blindfold-auth seed-launch-demo`
- `blindfold-auth studio`

The recommended Postgres-backed config reference is:

- `examples/postgres-workspace/blindfold.config.ts`

## Open-source governance and release files

The repo now includes:

- `LICENSE`
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `SUPPORT.md`
- `CHANGELOG.md`
- `.github/ISSUE_TEMPLATE/*`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/FUNDING.yml`
- `.github/dependabot.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/dependency-review.yml`
- `.github/workflows/release.yml`

Before the first public launch, replace placeholder repository URLs in `.github/ISSUE_TEMPLATE/config.yml` and placeholder funding values in `.github/FUNDING.yml`.

## Explainable authorization toolkit

Three surfaces answer "why was this request allowed or denied?" — they share
one evaluator, so a trace can never disagree with the decision the app
enforced:

1. **`auth.explain(query)`** — same signature as `auth.can()`, returns the
   decision plus a `trace`: every rule's outcome (`applied`, `shadowed`,
   `skipped-scope` with the exact failing components named, or
   `skipped-condition`), the deciding rule id, default-deny flag, and the
   evaluation context.
2. **`runPolicySuite(t, cases)`** (from `@dmc--98/blindfold-testing`) — pin
   the authorization model in CI with a declarative table of
   allow/deny/partial-decision expectations; failures self-explain with the
   actual effect, reason, and obligations.
3. **`admin.policies.dryRun({ applicationId, addPolicies, removePolicyIds, cases })`**
   — what-if evaluation of proposed rule changes against live data with
   before/after decisions per case; nothing persists.

The Studio **Policy Debugger** card renders `explain()` traces as a
narrative: ALLOW/DENY banner, per-rule trace lines, and the deciding rule
highlighted.

## Deployment health: blindfold doctor

`blindfold doctor` runs two halves and fails (exit 1) on any critical issue:

1. the nine-step runtime smoke (bootstrap → login → allow/deny → refresh →
   audit), and
2. a **security configuration scan**: secret quality (missing, placeholder,
   short, low-entropy), database TLS and default credentials, production
   without a database lane, Studio bound beyond localhost, default workspace
   id in production. Every finding includes a concrete fix. Use
   `--security-only` in CI to lint a deployment env without the smoke.

## Smoke test checklist

Every deploy path should pass the same basic smoke checks:

1. workspace bootstrap succeeds
2. app creation succeeds
3. principal creation succeeds
4. role and permission assignment succeeds
5. password login succeeds
6. protected route allows a valid session
7. protected route denies an invalid or revoked session
8. policy masking works on a field-level rule
9. audit events are written

The current Node + Postgres example automates most of this through `npm run smoke:postgres-example`.

The Lambda reference lane now has a local smoke path through `npm run smoke:lambda-example`.

## Launch assets

The repo now includes a deterministic asset-generation path for public launch materials.

Commands:

```sh
npm run playwright:install
npm run launch:assets
```

Generated files:

- `docs/assets/launch/studio-overview.png`
- `docs/assets/launch/passkey-login.png`
- `docs/assets/launch/provider-bindings.png`
- `docs/assets/launch/policy-debugger.png`
- `docs/assets/launch/bootstrap-to-studio.gif`
- `docs/assets/launch/magic-link-to-passkey.gif`
- `docs/assets/launch/domain-routing-sso.gif`

## E2E test target

The Playwright suite now exercises:

1. Studio bootstrap flow
2. app creation flow
3. principal creation flow
4. role and membership flow
5. policy creation and explainability flow
6. password login flow
7. magic link flow
8. TOTP enrollment and login flow
9. session refresh and revoke flow
10. protected-route allow and deny behavior

Run it with:

```sh
npm run playwright:install
npm run test:e2e
```

## Release checklist

Before the first serious public release, confirm all of the following:

- community docs are present and reviewed
- issue templates and PR template are configured
- funding links are real, not placeholders
- CI passes on supported Node versions
- CodeQL and dependency review are enabled in GitHub
- release workflow is connected to your tag strategy
- `docs/MASTER_GUIDE.md` still reflects the real deploy path
- the Node + Postgres smoke path passes
- the Lambda reference smoke path passes if that lane is being documented publicly

## Troubleshooting

If the local example does not start:

1. run `npm install`
2. run `npm test`
3. run `npm run playwright:install` if the browser suite complains that Chromium is missing
4. rerun `npm run bootstrap:example`
5. rerun `npm run seed:example`
6. rerun `npm run studio:example`

If the Postgres example does not start:

1. confirm `docker compose ps` shows the `postgres` service healthy
2. confirm `BLINDFOLD_DATABASE_URL` points at `127.0.0.1:55433`
3. rerun `npm run migrate:postgres-example`
4. rerun `npm run bootstrap:postgres-example`
5. rerun `npm run smoke:postgres-example`

If the E2E suite fails before opening a browser:

1. run `npm run playwright:install`
2. confirm Playwright can download browsers in your environment
3. rerun `npm run test:e2e`

If the Studio opens but looks empty:

1. confirm the workspace was bootstrapped
2. confirm demo data was seeded or the Postgres smoke ran
3. inspect the local example storage file under `examples/local-workspace/.blindfold/`

## How to use this guide

Use this document in this order:

1. read `What Blindfold Auth is`
2. run the local quick start
3. review `docs/ARCHITECTURE.md`
4. choose the deployment lane you care about
5. use the smoke checklist after every meaningful change
