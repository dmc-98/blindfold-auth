# blindfold doctor

The `doctor` command runs a static security scan of your Blindfold configuration environment. It checks for common misconfigurations and hardening gaps, and exits with code 1 if any critical findings are present.

## Usage

```bash
npx blindfold-auth doctor [options]
```

### Options

| Flag | Description |
|---|---|
| `--security-only` | Run only security checks (skip connectivity and version checks) |
| `--config <path>` | Path to your `blindfold.config.js` (optional — scans environment vars if omitted) |
| `--json` | Output findings as JSON |

## Findings and severities

| Severity | Meaning |
|---|---|
| `critical` | Must fix before production. Exit code 1. |
| `warning` | Should fix. Not blocking but indicates a risk. |
| `info` | Advisory. No action required. |

## Checks performed

### Secret quality

- **Missing secret** (critical) — `BLINDFOLD_SECRET` is not set
- **Placeholder secret** (critical) — secret matches common placeholder patterns (`changeme`, `secret`, `dev-only`, etc.)
- **Short secret** (critical) — secret is fewer than 32 characters
- **Low entropy** (critical) — secret entropy is below the threshold for a 32-char string (detects repeated characters, all-lowercase dictionary words, etc.)

### Database

- **Missing DATABASE_URL in production** (critical) — `NODE_ENV=production` with no database configured
- **Non-TLS database connection** (critical) — connection string does not include `?sslmode=require` or equivalent
- **Default credentials** (critical) — username or password matches common defaults (`postgres/postgres`, `admin/admin`, etc.)

### Studio exposure

- **Studio exposed in production** (warning) — `BLINDFOLD_STUDIO_EXPOSE=true` with `NODE_ENV=production`
- **Studio on non-loopback address** (warning) — Studio port bound to `0.0.0.0` rather than `127.0.0.1`

### Workspace hygiene

- **Generic workspace ID** (warning) — `workspaceId` is the default `workspace_local` in a non-dev environment
- **Missing workspace ID** (info) — not set; will default to `workspace_local`

## Example output (healthy)

```
blindfold doctor v0.1.1

✅ Secret: entropy OK (512 bits equivalent)
✅ Database: TLS enabled, non-default credentials
✅ Studio: not exposed on public interface
✅ Workspace: ID set

HEALTHY — 0 critical, 0 warnings, 0 info
```

## Example output (critical findings)

```
blindfold doctor v0.1.1

❌ Secret: low entropy — secret resembles a dictionary word (found: "mysecret")
❌ Database: TLS not enforced — connection string missing sslmode=require
⚠  Studio: exposed on 0.0.0.0 in production — consider binding to 127.0.0.1
ℹ  Workspace: using default workspace ID 'workspace_local'

FAILED — 2 critical, 1 warning, 1 info
Exit code: 1
```

## Running in CI

Add `blindfold doctor` as a deployment gate:

```yaml
# .github/workflows/deploy.yml
- name: Security check
  run: npx blindfold-auth doctor --security-only
  env:
    BLINDFOLD_SECRET: ${{ secrets.BLINDFOLD_SECRET }}
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    NODE_ENV: production
```

The step fails the deployment if any critical finding is present.

## Programmatic use

```ts
import { runDoctor } from '@dmc--98/blindfold-mcp/doctor'

const findings = await runDoctor({
  secret: process.env.BLINDFOLD_SECRET,
  databaseUrl: process.env.DATABASE_URL,
  studioExpose: process.env.BLINDFOLD_STUDIO_EXPOSE === 'true',
  env: process.env.NODE_ENV ?? 'development',
})

const criticals = findings.filter(f => f.severity === 'critical')
if (criticals.length > 0) {
  throw new Error(`Blindfold config has ${criticals.length} critical finding(s)`)
}
```
