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

/**
 * Guard against publishing a tarball without its build output (the v0.1.0
 * incident: no `files` field meant npm fell back to .gitignore, which
 * excludes dist/). Asserts that the package entry point and every bin
 * script are actually inside the pack file list.
 */
const assertTarballComplete = (pkg, pkgPath) => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: pkgPath, stdio: 'pipe' }).toString()
  const files = new Set(JSON.parse(out)[0].files.map((f) => f.path.replace(/^\.\//, '')))
  const required = []
  if (pkg.main) required.push(pkg.main.replace(/^\.\//, ''))
  if (typeof pkg.bin === 'string') required.push(pkg.bin.replace(/^\.\//, ''))
  else if (pkg.bin) required.push(...Object.values(pkg.bin).map((b) => b.replace(/^\.\//, '')))
  const missing = required.filter((f) => !files.has(f))
  if (missing.length > 0) {
    throw new Error(`tarball for ${pkg.name} is missing required files: ${missing.join(', ')} — did the build run? Is the "files" field correct?`)
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
    assertTarballComplete(pkg, pkgPath)
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
