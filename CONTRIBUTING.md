# Contributing

Thanks for helping improve Blindfold Auth.

## Before you start

Read these first:

- `docs/MASTER_GUIDE.md`
- `docs/ARCHITECTURE.md`

`docs/MASTER_GUIDE.md` is the single source of truth for understanding the project and the supported deployment lanes.

## Local setup

```sh
npm install
npm test
npm run playwright:install
npm run test:e2e
```

Useful local workflows:

```sh
npm run bootstrap:example
npm run seed:example
npm run studio:example
```

Recommended Node + Postgres lane:

```sh
cp ./examples/postgres-workspace/.env.example ./examples/postgres-workspace/.env
set -a && source ./examples/postgres-workspace/.env && set +a
npm run postgres:up
npm run migrate:postgres-example
npm run bootstrap:postgres-example
npm run smoke:postgres-example
npm run postgres:down
```

Full local verification:

```sh
npm run test:all
```

## Contribution guidelines

- Prefer focused pull requests over large mixed changes.
- Keep public runtime, CLI, and adapter contracts intentional.
- Update docs when behavior, commands, or deployment steps change.
- Add or update tests for code changes whenever practical.
- Do not commit secrets, real credentials, or production tokens.
- For security-sensitive bugs, follow `SECURITY.md` instead of opening a public exploit issue.

## Pull request checklist

Before opening a PR:

- run `npm test`
- run `npm run test:e2e` for changes that affect Studio, browser flows, auth handlers, or protected routes
- run the relevant local example or smoke path for your change
- update `README.md` or `docs/MASTER_GUIDE.md` if the user-facing behavior changed
- explain why the change exists, not just what changed

## Style and review

- Keep changes readable and incremental.
- Preserve local-first and customer-owned-data principles.
- Prefer explicit, typed, documented behavior over hidden magic.
- Treat backwards compatibility for public APIs as a deliberate decision.

## Release notes

User-facing changes should be added to `CHANGELOG.md` under `Unreleased`.
