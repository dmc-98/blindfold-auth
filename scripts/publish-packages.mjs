#!/usr/bin/env node
/**
 * Publishes all public workspace packages under packages/ to npm.
 *
 * Designed for CI (release.yml) but safe to run locally with npm auth.
 * - Publishes in dependency order (mirrors the build:packages order).
 * - Idempotent: skips any name@version already on the registry, so a
 *   failed run can be re-run without erroring on the packages that made it.
 * - Scoped packages are published with --access public.
 * - --provenance attaches npm provenance (requires GitHub Actions OIDC:
 *   `permissions: id-token: write` and a public repo). Set
 *   NPM_PUBLISH_PROVENANCE=false to disable (e.g. while the repo is private).
 *
 * Usage: node scripts/publish-packages.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const packagesDir = join(repoRoot, 'packages')
const dryRun = process.argv.includes('--dry-run')
const useProvenance = process.env.NPM_PUBLISH_PROVENANCE !== 'false'

// Dependency-ordered (mirrors build:packages); anything new lands at the end.
const preferredOrder = [
  'auth', 'auth-client', 'auth-testing',
  'auth-storage-sqlite', 'auth-storage-mongo', 'auth-storage-postgres',
  'auth-control', 'auth-risk', 'auth-studio', 'auth-adapter-serverless',
  'auth-sso', 'auth-mobile', 'auth-scim', 'auth-mcp', 'auth-playground', 'auth-cli',
]
const allDirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(packagesDir, d.name, 'package.json')))
  .map((d) => d.name)
const ordered = [...preferredOrder.filter((d) => allDirs.includes(d)), ...allDirs.filter((d) => !preferredOrder.includes(d))]

const isOnRegistry = (name, version) => {
  try {
    execFileSync('npm', ['view', `${name}@${version}`, 'version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

let published = 0
let skipped = 0
const failures = []

for (const dir of ordered) {
  const pkgPath = join(packagesDir, dir)
  const pkg = JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf8'))
  if (pkg.private) { console.log(`— ${pkg.name}: private, skipping`); continue }
  if (isOnRegistry(pkg.name, pkg.version)) {
    console.log(`✓ ${pkg.name}@${pkg.version} already on registry, skipping`)
    skipped += 1
    continue
  }
  const args = ['publish', '--access', 'public']
  if (useProvenance) args.push('--provenance')
  if (dryRun) args.push('--dry-run')
  try {
    console.log(`→ publishing ${pkg.name}@${pkg.version}${dryRun ? ' (dry-run)' : ''}`)
    execFileSync('npm', args, { cwd: pkgPath, stdio: 'inherit' })
    published += 1
  } catch (err) {
    failures.push(`${pkg.name}@${pkg.version}: ${err.message}`)
  }
}

console.log(`\nDone. published=${published} skipped=${skipped} failed=${failures.length}`)
if (failures.length > 0) {
  for (const f of failures) console.error(`✗ ${f}`)
  process.exit(1)
}
