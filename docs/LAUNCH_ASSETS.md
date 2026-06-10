# Launch Assets

This document is the single source of truth for the public launch screenshots, GIFs, and the exact commands used to regenerate them.

## Generate everything

From the repository root:

```sh
npm install
npm run playwright:install
npm run launch:assets
```

The generator uses the same seeded Playwright harness that backs the browser E2E suite, so the assets track real product behavior instead of a one-off mockup.

Output locations:

- `docs/assets/launch/`
- `output/playwright/launch/launch-manifest.json`

## Asset inventory

### `docs/assets/launch/studio-overview.png`

- Source: seeded Studio workspace
- Purpose: README hero/supporting visual
- Shows: local Studio, shared workspace metrics, applications, principals, providers, and policies

### `docs/assets/launch/passkey-login.png`

- Source: runtime playground passkey card
- Purpose: passkey-first login visual
- Shows: explicit “Sign in with passkey” UX in the local-first runtime

### `docs/assets/launch/provider-bindings.png`

- Source: Studio application provider bindings card
- Purpose: enterprise auth control-plane visual
- Shows: shared IdPs, per-app bindings, routing domains, and JIT default role mapping

### `docs/assets/launch/policy-debugger.png`

- Source: Studio policy debugger card after evaluation
- Purpose: RBAC/ABAC explainability visual
- Shows: field-level `mask` decision and the evaluated response payload

### `docs/assets/launch/bootstrap-to-studio.gif`

- Source: fresh Studio workspace bootstrap flow
- Purpose: “local-first and installable in minutes” motion clip
- Shows: empty Studio to bootstrapped workspace

### `docs/assets/launch/magic-link-to-passkey.gif`

- Source: runtime playground
- Purpose: passkey bootstrap story
- Shows: request magic link, consume it, enroll a passkey, then sign in with passkey

### `docs/assets/launch/domain-routing-sso.gif`

- Source: runtime playground
- Purpose: enterprise federation story
- Shows: email-domain routing into OIDC sign-in and local session issuance

## Recommended placements

### README

- Put `studio-overview.png` near the top as the main visual.
- Follow it with `magic-link-to-passkey.gif` to show the passkey bootstrap flow.
- Mention `provider-bindings.png` and `policy-debugger.png` in the section that explains enterprise control and policy depth.

### Launch post / GitHub release

- Lead with `studio-overview.png`.
- Use `bootstrap-to-studio.gif` to emphasize fast local setup.
- Use `domain-routing-sso.gif` for the enterprise credibility moment.

### Docs

- Link `policy-debugger.png` from architecture, policy, and ABAC docs.
- Link `provider-bindings.png` from federation docs and the master guide.

## Capture notes

- Browser: Playwright Chromium
- WebAuthn: virtual authenticator attached through CDP
- Data: in-memory seeded harness; no hosted dependency
- Styling: captured from the real Studio and runtime playground UIs

## Refresh rules

- Regenerate assets whenever the Studio layout, runtime playground, passkey flow, or provider-binding UX changes materially.
- Re-run assets before any public release candidate.
- Keep the README screenshots and GIFs in sync with `docs/RELEASE_NOTES_RC1.md`.
