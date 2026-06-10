# Blindfold Auth Roadmap

This roadmap is the execution order for turning the current repository into a release-ready local-first auth project.

## Current baseline

Already present in the repo:

- embedded auth runtime
- CLI
- local Studio
- Postgres adapter
- serverless adapter
- local and Lambda examples
- passing unit tests for the current slice
- Playwright E2E coverage for baseline Studio and runtime flows

## Phase 0: Contract freeze

Goal:

- lock the runtime, CLI, adapter, and env-var contracts so the rest of the work builds on a stable foundation

Deliverables:

- public API contract for `createAuth()` and runtime helpers
- storage adapter interface contract
- CLI command contract
- migration strategy for Postgres
- env-var naming and configuration contract

Exit criteria:

- the supported deployment matrix is explicit
- the public interfaces are documented and intentionally versioned

Reference docs:

- `docs/PHASE_0_CHECKLIST.md`
- `docs/contracts/API_CONTRACT.md`
- `docs/contracts/CLI_CONTRACT.md`
- `docs/contracts/STORAGE_CONTRACT.md`
- `docs/contracts/CONFIG_CONTRACT.md`
- `docs/contracts/DEPLOYMENT_MATRIX.md`

## Phase 1: Core auth completion

Goal:

- close the biggest runtime gaps so the core package is production-oriented

Deliverables:

- WebAuthn/passkey flow support
- stronger MFA lifecycle
- tenant-aware policy resolution improvements
- session/device inventory
- better revoke-all and emergency disable controls
- config validation and version history improvements

Exit criteria:

- one serious production app could embed the runtime without needing custom auth orchestration

## Phase 2: Studio productization

Goal:

- turn Studio into the real local control surface for operators

Deliverables:

- polished app/user/role/policy workflows
- policy explainability
- audit explorer
- config diffs and rollback-aware UX
- safer admin writes and better empty/error states

Exit criteria:

- a team can bootstrap and operate a workspace through CLI plus Studio without direct table editing

## Phase 3: Enterprise federation and lifecycle

Goal:

- add the enterprise features needed for workforce and B2B adoption

Deliverables:

- SAML SSO
- OIDC enterprise login
- delegated app admin
- SCIM
- JIT provisioning
- compliance-oriented export flows

Exit criteria:

- the project is credible for an enterprise pilot

## Phase 4: Deployment surfaces

Goal:

- make the supported deployment paths explicit and runnable

Deliverables:

- embedded Node + Postgres deployment path
- Docker Compose path
- Lambda + DynamoDB reference path
- migration/bootstrap commands
- health checks and smoke tests
- rollback guidance

Exit criteria:

- each lane has a repeatable install-to-running document and verification checklist

## Phase 5: Playwright E2E

Goal:

- protect the project with a full end-to-end user and operator test layer

Deliverables:

- Playwright suite for Studio flows
- protected route validation flows
- password, magic link, TOTP, refresh, revoke, allow, deny, and masking scenarios
- CI integration for headless E2E execution

Exit criteria:

- regressions in the main operator and auth flows are blocked before merge

Current status:

- baseline Playwright coverage is implemented with a dedicated GitHub Actions workflow
- future work in this phase should expand cross-browser depth and broader auth/federation scenarios

## Phase 6: Security audit and fixes

Goal:

- run a dedicated hardening cycle after the product shape is stable

Deliverables:

- updated threat model
- auth bypass review
- crypto/signing review
- dependency audit
- secret scanning
- CodeQL or equivalent static security analysis
- fixes for critical and high-risk findings

Exit criteria:

- critical and high-severity findings are closed or explicitly accepted with written rationale

Current status:

- baseline hardening is implemented for magic-link response safety, application access enforcement, forged logout protection, and cross-app session isolation
- internal documentation now exists in `docs/THREAT_MODEL.md` and `docs/SECURITY_AUDIT.md`
- future work in this phase should include external review and deeper federation-specific hardening

## Phase 7: Performance audit and fixes

Goal:

- make the recommended path fast enough and predictable enough for real adoption

Deliverables:

- hot-path profiling
- policy evaluation benchmarks
- session verification benchmarks
- rate-limit path benchmarks
- Postgres indexing and caching improvements where needed
- documented performance budgets

Exit criteria:

- the Node + Postgres path meets the documented budgets

Current status:

- a repeatable benchmark harness exists at `benchmarks/auth.perf.ts` (run via `npm run perf:bench`)
- the current baseline and budgets are documented in `docs/PERFORMANCE.md`
- local storage now uses indexed hot-path lookups and exact-filter caches
- the Postgres migration now creates indexes for common auth query surfaces

## Phase 8: Open-source release readiness

Goal:

- make the repo safe, legible, and friendly for public contributors and users

Deliverables:

- `LICENSE`
- `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `SUPPORT.md`
- `CHANGELOG.md`
- issue templates
- PR template
- funding config
- CI workflows
- release automation
- dependency update automation

Exit criteria:

- the repo is ready for a public release candidate and community onboarding

## Phase 9: Launch documentation and go-live assets

Goal:

- make the project easy to understand, evaluate, and deploy

Deliverables:

- `docs/MASTER_GUIDE.md` as the canonical entry point
- updated root README
- architecture overview
- deployment docs for all supported lanes
- smoke-test checklist
- troubleshooting guide
- release checklist

Exit criteria:

- a new user can go from repository landing page to local run and deployment understanding without guessing

Current status:

- `docs/MASTER_GUIDE.md` remains the canonical entry point
- `docs/ARCHITECTURE.md` now covers the package and deployment model
- `docs/GO_LIVE.md` now provides the release and deployment runbook
- the Lambda reference lane now has a local smoke script at `examples/lambda-dynamodb/invoke.ts` (run via `npm run smoke:lambda-example`)
