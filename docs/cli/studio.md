# Studio UI

Blindfold Studio is a browser-based operator interface for managing your workspace. It runs locally against your own database — there is no cloud dashboard.

## Starting Studio

```bash
npx blindfold-auth studio --config ./blindfold.config.js
```

By default, Studio binds to `http://localhost:4110`. Open this in your browser.

### Options

```bash
npx blindfold-auth studio \
  --config ./blindfold.config.js \
  --port 4220 \
  --workspace-id my-workspace
```

| Option | Default | Description |
|---|---|---|
| `--config` | — | Path to your blindfold config file |
| `--port` | 4110 | Port to bind Studio on |
| `--workspace-id` | from config | Override workspace ID |

## What's in Studio

### Dashboard

Overview of workspace health: active sessions count, recent audit events, principal count, application list.

### Principals

List, search, and manage users. From this panel you can:
- View a principal's memberships and roles
- Enable/disable passkey MFA
- Force session revocation
- View audit trail for a specific principal

### Applications

Configure per-application settings: roles, policies, session config, SSO provider bindings.

### Policy Debugger

The policy debugger is the most powerful Studio feature — it lets you:

**Explain a decision:**
Fill in the request fields (principal, application, action, resource, optional attributes) and click **Evaluate**. Studio shows:
- The final decision (ALLOW / DENY / MASK / READONLY) with a color-coded banner
- The deciding rule name and its description
- Per-rule outcomes in a collapsible list — each rule shows whether it applied, was shadowed, or was skipped (with exact scope mismatches or failing conditions)
- The raw JSON trace in a `<details>` panel

This surfaces the full `auth.explain()` output in the browser.

**What-if (dry run):**
The **What-if** tab lets you paste a proposed policy rule (JSON), add test cases, and see before/after decisions — before touching any live policy. Under the hood this calls `admin.policies.dryRun()`.

Workflow:
1. Paste proposed policy JSON
2. Add test cases (fill in principal/action/resource/attributes)
3. Click **Evaluate What-if**
4. Review which cases change and whether the change is intended
5. Click **Apply** to create the policy (or close to discard)

### SSO Providers

View and manage OIDC/SAML providers and their application bindings. Links to the `sso doctor` analysis for each provider's metadata URL.

### Audit Log

Browse, filter, and export audit events. Filter by event type, date range, principal, or application. The chain integrity status is shown in the header.

## Security considerations

Studio is a local operator tool. It is **not designed for public exposure**.

- Never bind Studio to `0.0.0.0` in production
- Never run Studio behind a public load balancer
- For remote access to a production workspace, SSH-tunnel to the server and open Studio locally (see [Deployment](/guide/deployment))
- `blindfold doctor` flags Studio exposure as a warning if it detects `BLINDFOLD_STUDIO_EXPOSE=true` in a production environment

## Using Studio without the CLI

Studio can also be embedded in your own admin server as a middleware:

```ts
import { createStudio } from '@dmc--98/blindfold-auth-studio'

const studio = createStudio({ auth })

// Attach to your Express app (protect with admin auth middleware)
app.use('/studio', requireAdminAuth, studio.router())
```

This is suitable for internal tooling setups where you want Studio inside an existing admin panel.
