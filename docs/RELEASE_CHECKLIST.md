# Release Guide — what's left to ship Blindfold Auth

Concrete, ordered checklist to take the repo from "feature-complete + green locally"
to "published 1.0 open-source release." Companion to `RELEASE.md` (which has the
version matrix and rationale); this file is the **do-this-in-order** runbook.

Legend: **[code]** = can be done in-repo (delegate to Claude or do yourself) ·
**[you]** = only you can do (accounts, money, hosting, sign-off).

---

## Where things stand (2026-06)

- ✅ 16 packages + 4 example workspaces, **all strict TypeScript**, clean build.
- ✅ **106 tests pass** (101 unit + 5 demo e2e). Initial git commit exists; tree clean.
- ✅ `package-lock.json` synced — `npm ci` works (verified via dry-run).
- ✅ CI/CD workflows exist (`ci`, `e2e`, `codeql`, `dependency-review`, `release`); `test:e2e` now self-builds.
- ✅ OSS governance files present (LICENSE, CoC, CONTRIBUTING, SECURITY, SUPPORT, CHANGELOG, templates).
- ⛔ **Not published.** Packages aren't publish-ready (see Phase 2). No git remote yet.
- ⛔ No external security audit (Roadmap Phase 6 / `RELEASE.md` blocker).

---

## Phase 1 — Get it onto GitHub and prove CI  (do first)

- [ ] **[you]** Create the GitHub repo (and the `blindfold-auth` org if that's the home).
- [ ] **[you]** Add the remote and push:
  ```sh
  git remote add origin git@github.com:<org>/blindfold-auth.git
  git push -u origin main
  ```
- [ ] **[you]** Confirm the 4 CI workflows go green on the push (Actions tab):
  `CI` (unit, Node 20 + 22), `E2E` (Playwright), `CodeQL`, `Dependency Review`.
- [ ] **[code]** Fix anything CI surfaces that passed locally (most likely: Playwright
  system deps — the `e2e` workflow already runs `npx playwright install --with-deps chromium`).
- [ ] **[code]** *(optional)* Add a dedicated `typecheck` CI step (`npm run typecheck`) for clearer failures than the bundled `npm test`.

---

## Phase 2 — Make packages publishable  (the real publish blocker)

Every one of the 16 `@blindfold/*` packages is currently **missing `files[]` and
`publishConfig`**. Scoped packages will not publish publicly without this.

- [ ] **[code]** Add to **every** publishable package's `package.json`:
  ```jsonc
  "files": ["dist", "README.md"],
  "publishConfig": { "access": "public" }
  ```
  (Don't ship `src/`, tests, or tsconfig. `dist` already contains `.js` + `.d.ts` + maps.)
- [ ] **[code]** Add a `prepublishOnly` build guard to each package: `"prepublishOnly": "npm run build"`.
- [ ] **[code]** Decide what NOT to publish: the 4 `examples/*` are `private: true`? They
  aren't currently — mark them `"private": true` so they never publish.
- [ ] **[code]** Per-package `README.md` (at least a short one) — npm shows it on the package page.
- [ ] **[code]** `npm pack --dry-run` each package; confirm the tarball is just `dist/` + README + package.json (no secrets, no `node_modules`, no tests).
- [ ] **[you]** Decide the **MCP transport** story: `@blindfold/mcp` keeps `@modelcontextprotocol/sdk` as an optional/peer dep. Either make it a real `peerDependency` at 1.0 or ship the stdio entry behind a documented extra install. (`RELEASE.md` blocker.)

---

## Phase 3 — Freeze versions & contracts

- [ ] **[you]** Confirm the `@blindfold` **npm scope/org** exists and you own it (`npm org ls blindfold` once logged in). If the name is taken, pick the final scope now — it touches every `package.json` and import.
- [ ] **[code]** Bump versions per `RELEASE.md`:
  - contract-frozen packages → `1.0.0` (engine, client, testing, cli, mcp, control, playground, risk, storage-sqlite/mongo/postgres, sso, mobile, scim)
  - Studio + serverless adapter → `0.9.0` (explicitly beta) if you don't want to 1.0-freeze their surface yet
  - Use `npm version 1.0.0 --workspaces --no-git-tag-version` then review.
- [ ] **[code]** Make sure cross-package `dependencies` pin the new versions (they currently say `0.1.0`). Bumping must update dependents too.
- [ ] **[code]** Public-API review for the 13 packages still at `0.1.0`: anything not part of the v1 surface → mark `@internal` or drop from `exports`. (The 3 RC packages already export `*_VERSION` constants as the model.)
- [ ] **[code]** Update `CHANGELOG.md` with the 1.0 entry.
- [ ] **[code]** Update `RELEASE.md`'s "current version" column to match.

---

## Phase 4 — Security & quality gate  (Roadmap Phase 6)

- [ ] **[you]** Commission/run the **external security audit** of `@blindfold/auth` (engine)
  + `@blindfold/client` + `@blindfold/risk` + `@blindfold/scim`. This is the hard
  pre-publish blocker in `RELEASE.md`. Budget + vendor is your call.
- [ ] **[you]** Triage findings; **close all critical/high or accept with written rationale**
  (Roadmap Phase 6 exit criterion).
- [ ] **[code]** `npm audit --omit=dev` clean (CI already runs this on Node 22).
- [ ] **[code]** Re-run the benchmark (`npm run perf:bench -- --assert`) and confirm budgets in `docs/PERFORMANCE.md` still hold post-TS.
- [ ] **[code]** *(nice-to-have, Roadmap Phase 5)* expand E2E beyond the baseline (cross-browser, federation flows).

---

## Phase 5 — Docs final pass  (Roadmap Phase 9)

- [ ] **[code]** Refresh `docs/CODEBASE_STATE.md` — it still describes 5 packages / "all 0.1.0"; reality is 16 packages, several RC, all TypeScript.
- [ ] **[code]** Verify every command in `docs/MASTER_GUIDE.md` and `README.md` runs after a clean `npm i && npm run build:ts` (paths were migrated to `dist/`; sanity-check end to end).
- [ ] **[code]** README "install" section should show the published package names + versions once chosen.
- [ ] **[you]** *(optional GTM, Roadmap Phase 11)* hosted docs site, hosted playground, launch posts/pricing — not a publish blocker.

---

## Phase 6 — Publish  (the actual release)

Do this only after Phases 2–4 are green.

- [ ] **[you]** `npm login` (or set `NPM_TOKEN` as a GitHub Actions secret if you wire publishing into `release.yml`).
- [ ] **[code]** Tag: create `release/1.0.0` branch, freeze, then `git tag v1.0.0`.
- [ ] **[code]** Build everything: `npm run build:ts`.
- [ ] **[code]** Dry-run publish each package: `npm publish --dry-run -w @blindfold/<pkg>`.
- [ ] **[you]** Publish in **dependency order** (engine → storage adapters → testing/client/risk/control → sso/mobile/scim/playground → cli/mcp last):
  ```sh
  npm publish -w @blindfold/auth --access public
  # …then the rest in order…
  ```
- [ ] **[you]** `git push --tags`; the `release.yml` workflow drafts a GitHub release on the `v*` tag.
- [ ] **[code]** Smoke-test the published packages in a throwaway app (`npm i @blindfold/client` → run the 3-line snippet) to confirm the tarball actually works.

---

## Quick triage: minimum path to a *usable* public release

If you want the fastest credible release and can defer the formal audit:

1. Phase 1 (push + green CI).
2. Phase 2 (`files`/`publishConfig`/`prepublishOnly` + `npm pack` check) — **the genuine blocker**.
3. Phase 3 version bump.
4. Publish a `1.0.0-rc` line (you already have 3 RC packages) and label the release a **release candidate** until the Phase 4 audit completes.

Phases 2, 3, 5, and the `[code]` items in 1/4/6 can be handed to Claude. Phases
1 (repo), 4 (audit), and the `npm publish`/login steps need you.
