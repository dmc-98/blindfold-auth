# Blindfold Auth RC1 Release Notes

## Title

`Blindfold Auth v0.2.0-rc.1`

## GitHub release body

Blindfold Auth is a local-first auth workspace for JavaScript and TypeScript teams that do not want a hosted control plane.

This release candidate pushes the project into a much more convincing product shape:

- passkey-first login with WebAuthn
- shared enterprise identity providers with per-application OIDC and SAML bindings
- deterministic JIT linking and role assignment
- local Studio support for providers, bindings, passkeys, policies, and audit
- reproducible launch screenshots and GIFs generated from real Playwright flows

Everything still stays in the customer’s system. Blindfold ships as packages, a local Studio, adapters, and examples instead of a remote vendor dashboard.

## Why this exists

Teams should not need to hand over their auth control plane just to get sessions, MFA, passkeys, policy management, and enterprise federation.

Blindfold Auth exists to give JS/TS teams a package-first alternative:

- installable locally
- data owned by the team
- Studio runs locally
- table-driven RBAC and ABAC
- enterprise-ready auth building blocks without a hosted dependency

## Highlights

### Passkey-first local auth

- WebAuthn registration and authentication handlers
- app-scoped passkey credentials
- magic-link bootstrap into first passkey enrollment
- passkey revocation through admin APIs and Studio

### Enterprise federation control plane

- shared workspace-level identity provider records
- per-application provider bindings
- OIDC and SAML handler namespaces
- domain-based provider routing
- deterministic JIT principal linking and role assignment
- SAML metadata endpoint generation

### Local Studio and launch kit

- Studio support for shared providers, application bindings, passkeys, and policy debugging
- launch demo seeding through `seed-launch-demo`
- generated launch assets in `docs/assets/launch/`

## Install and run

```sh
npm install
npm run seed:launch-demo
npm run studio:example
```

Then open `http://localhost:4110`.

For screenshots and GIFs:

```sh
npm run playwright:install
npm run launch:assets
```

## Recommended docs to link in the release

- `README.md`
- `docs/MASTER_GUIDE.md`
- `docs/LAUNCH_ASSETS.md`
- `docs/GO_LIVE.md`
- `docs/SECURITY_AUDIT.md`
- `docs/PERFORMANCE.md`

## Known limits in this RC

- External provider-specific OIDC/SAML interoperability hardening is still the next layer of work.
- SCIM and richer lifecycle provisioning are not part of this RC.
- Lambda + DynamoDB remains a reference deployment path, not the primary product lane.

## Suggested changelog summary

- Added WebAuthn/passkey registration and authentication support.
- Added shared identity providers and per-application OIDC/SAML bindings.
- Added deterministic federation JIT provisioning and role assignment.
- Extended Studio with provider, binding, and passkey workflows.
- Added launch-demo seeding and generated launch assets.
