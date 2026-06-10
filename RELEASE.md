# Release Plan — Blindfold Auth 1.0

This document is the **publish checklist** for taking Blindfold Auth from local
demonstrability to a public open-source release. The codebase is feature-complete
against the GOAL ("droppable into any product in a few lines — SDK + CLI + MCP,
with RBAC + ABAC, SSO, any SQL or NoSQL DB, dynamic security, mobile, easy
local testing, and an interactive playground"). What remains is non-code-in-sandbox
work — versioning, contracts, audit, publication.

**The owner of this file is the human maintainer.** Claude can prepare PRs but
will not run `npm publish` or accept the external audit on the user's behalf.

---

## Package inventory and target versions

| Package | Current | Target at 1.0 | Notes |
|---|---|---|---|
| `@blindfold/auth` | 0.1.0 | `1.0.0` | The engine. Public surface is `createAuth`, `auth.admin.*`, `auth.handlers.*`, `auth.session.*`, `auth.can`, storage adapters. |
| `@blindfold/client` | 0.1.0 | `1.0.0` | Drop-in SDK. Public surface: `blindfold()`, `client.auth`, `client.can`, `client.protect`, `generateSnippet`. |
| `@blindfold/testing` | 0.1.0 | `1.0.0` | `createTestAuth`, conformance kit. |
| `@blindfold/cli` (`auth-cli`) | 0.1.0 | `1.0.0` | `blindfold` binary. |
| `@blindfold/mcp` | 0.1.0 | `1.0.0` | Needs real `@modelcontextprotocol/sdk` transport wiring before 1.0. |
| `@blindfold/control` | 0.1.0 | `1.0.0` | Multi-project + sha256-hashed API keys. |
| `@blindfold/playground` | 0.1.0 | `1.0.0` | Sandbox UI + CLI. |
| `@blindfold/risk` | 0.1.0 | `1.0.0` | Dynamic security. |
| `@blindfold/sso` | **1.0.0-rc.1** | `1.0.0` | TS-native; v1 contract frozen. |
| `@blindfold/mobile` | **1.0.0-rc.1** | `1.0.0` | TS-native; PKCE + REST client. |
| `@blindfold/scim` | **1.0.0-rc.1** | `1.0.0` | TS-native; SCIM 2.0 + compliance export. |
| `@blindfold/auth-storage-sqlite` | 0.1.0 | `1.0.0` | Passes conformance kit. |
| `@blindfold/auth-storage-mongo` | 0.1.0 | `1.0.0` | Passes conformance kit. |
| `@blindfold/auth-storage-postgres` | 0.1.0 | `1.0.0` | Reference adapter. |
| `@blindfold/auth-studio` | 0.1.0 | `0.9.0` (beta) | Operator UI; not contract-frozen. |
| `@blindfold/auth-adapter-serverless` | 0.1.0 | `0.9.0` (beta) | Reference adapter. |

The three already at `1.0.0-rc.1` (`sso`, `mobile`, `scim`) have **explicitly
versioned public surfaces** in TypeScript and exported `*_VERSION` constants;
they're the model for the rest. The remaining `0.1.0` packages need a public-API
audit before the version bump — a JS surface check, not a rewrite.

## Pre-publish blockers

These MUST land before `npm publish`:

- [ ] **External security audit** of `@blindfold/auth` (engine) and `@blindfold/client` (SDK). The dynamic security surface (`@blindfold/risk`) and SCIM surface should also be in scope. Scope doc + paid engagement is on the maintainer.
- [ ] **README + repository LICENSE** are present and correct (the repo already ships these — verify Apache-2.0 vs MIT preference).
- [ ] **`npm pack --dry-run`** for each package: confirm only `dist/`, `src/` (JS pkgs), `README.md`, `package.json` are included; no test fixtures, secrets, lockfiles, or `node_modules`.
- [ ] **Public API surface review** for the 12 packages still at 0.1.0: anything not part of the v1 contract should be marked `@internal` or moved out of the package's exports.
- [ ] **TypeScript declarations published**. For TS-native packages (`sso`, `mobile`, `scim`) this is automatic via `tsc --declaration`. For the JS packages, hand-write minimal `.d.ts` or enable `tsc --declaration --allowJs --emitDeclarationOnly` per package.
- [ ] **CHANGELOG.md** updated for every package (or a single repo-level CHANGELOG.md — pick one).
- [ ] **MCP SDK transport wired**: `@blindfold/mcp` currently has the tool layer but the stdio entry is behind the optional `@modelcontextprotocol/sdk` import. Either make it a peerDependency at 1.0 or ship a CLI that depends on it directly.
- [ ] **Test gates**: `npm test` passes locally and in CI (currently **95+ tests passing**: 83 unit + 12 SCIM + 5 demo e2e — the build will rise as more TS-native tests land); `npm run test:e2e` passes; conformance kit run against every storage adapter.

## Publish sequence

Once blockers are cleared, this is the order. Each step is independently revertible.

1. **Tag and freeze.** Create a `release/1.0.0` branch from `main`. From here, only changelog + version bumps land on the branch.
2. **Bump versions.** Use `npm version 1.0.0 --workspaces` for the contract-frozen packages. The studio + serverless adapter ship as `0.9.0` (explicitly beta).
3. **Build everything.** `npm run build:ts` for the TS-native packages; verify each `dist/` is reproducible from `src/`.
4. **Dry-run.** `npm publish --dry-run --access public --workspace @blindfold/<each>`. Inspect tarballs.
5. **Publish in dependency order.** Engine first (`@blindfold/auth`), then storage adapters, then testing/client/risk/control, then sso/mobile/scim/playground, then cli/mcp last. Use `--access public` (these are scoped packages).
6. **Tag the git release.** `git tag v1.0.0 && git push --tags`. Create a GitHub release with the changelog.
7. **Announce.** Landing-page hero updated with "1.0 available"; HN/X/Reddit posts (positioning lives elsewhere — see `landing/` + GTM doc).

## Versioning policy (post-1.0)

- Every package version is independent. The repo is a monorepo, but consumers install packages independently.
- Each TS-native contract exports a `*_VERSION` constant (`SSO_VERSION`, `MOBILE_VERSION`, `SCIM_VERSION`) — consumers can pin major-version compatibility programmatically.
- Breaking changes to a v1 contract require a major bump and a 6-month deprecation overlap in the engine.

## Out of scope for this checklist

Hosted control plane, paid features, pricing, support SLAs, and "best open
source positioning" — those are non-code business decisions and don't gate the
npm publish.
