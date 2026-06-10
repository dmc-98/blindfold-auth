# Blindfold Auth Go-Live Checklist

This checklist is the practical launch and deployment runbook for the current repository.

If you want one doc to review before you publish the repo or deploy the recommended runtime, read this after `docs/MASTER_GUIDE.md`.

## 1. Pick the deployment lane

- `Local workspace demo`
  Best for onboarding, screenshots, and contributor setup.
- `Embedded Node + Postgres`
  Recommended production lane.
- `Lambda + DynamoDB reference`
  Reference-only serverless lane for examples and adapter validation.

## 2. Preflight before any deploy

- confirm `npm test` passes
- confirm `npm run test:e2e` passes
- confirm `npm run perf:bench -- --assert` passes
- confirm `npm audit --omit=dev` is clean
- replace placeholder values in:
  - `.github/FUNDING.yml`
  - `.github/ISSUE_TEMPLATE/config.yml`
- review `docs/SECURITY_AUDIT.md`
- review `docs/PERFORMANCE.md`

## 3. Recommended deploy: Node + Postgres

From the repository root:

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

Before calling this production-ready in your own environment:

- move the example config into your app repo
- set a real `BLINDFOLD_SECRET`
- point `BLINDFOLD_DATABASE_URL` at your own Postgres instance
- run the same migrate/bootstrap order against the real environment
- keep Studio access limited to trusted operators

## 4. Reference deploy: Lambda + DynamoDB

Local reference smoke:

```sh
npm run smoke:lambda-example
```

When adapting the example to AWS:

- replace the in-memory Dynamo client with a real AWS SDK document client wrapper
- create one table per Blindfold table prefix or an equivalent mapping strategy
- inject a real workspace secret through Lambda environment variables
- front the handler with API Gateway HTTP API
- verify login, refresh, logout, and one protected route before expanding scope

## 5. Smoke checks after deploy

Every serious deploy should confirm:

1. workspace bootstrap works
2. app creation works
3. principal creation works
4. membership and permission assignment work
5. password login works
6. session refresh works
7. logout or revocation invalidates access
8. a protected route allows valid access
9. a protected route denies invalid access
10. a field-level mask policy behaves correctly
11. audit events are written

## 6. Public repo launch checklist

- README is current and concise
- `docs/MASTER_GUIDE.md` is still the canonical install/deploy path
- architecture docs are linked and readable
- examples are runnable
- CI, CodeQL, dependency review, and E2E workflows are enabled on GitHub
- funding and issue-template links point to real destinations
- the release workflow matches your tag strategy
- the repo has at least one polished screenshot or demo path before launch

## 7. First release candidate checklist

- cut a changelog entry in `CHANGELOG.md`
- tag the release from a green default branch
- sanity-check npm/package metadata if packages will be published
- verify docs links from the README
- rerun the Postgres smoke path from a clean clone

## 8. Post-launch watch list

- watch issues for setup friction
- watch auth and session bugs with highest priority
- keep the master guide updated before adding more features
- do not let the reference serverless lane drift from the adapter APIs
- schedule the next work around WebAuthn, federation, and deeper external review
