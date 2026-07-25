---
layout: home

hero:
  name: Blindfold Auth
  text: Auth that lives in your infrastructure.
  tagline: Your users, sessions, and policies never leave your servers. Apache 2.0, Postgres-first, embedded in your Node app.
  image:
    src: /hero-diagram.svg
    alt: Blindfold Auth architecture
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/dmc-98/blindfold-auth

features:
  - icon: 🏠
    title: No hosted control plane
    details: The runtime embeds in your application. Auth state lives in your own database — Postgres, DynamoDB, or any custom adapter. There is no cloud to phone home to.
  - icon: 🔐
    title: Passkeys-first, OWASP-hardened
    details: WebAuthn passkeys as a second factor, minimum 12-character passwords by default, optional HIBP breach-password checking, and hash-chained audit events that prove tamper-evidence.
  - icon: 📋
    title: Explainable authorization
    details: Table-driven RBAC and ABAC policies with per-rule trace output, a what-if dry-run API, and a declarative test runner — so you can audit exactly why any request was allowed or denied.
  - icon: 🏢
    title: Enterprise SSO built-in
    details: OIDC and SAML 2.0 federation with Okta and Entra ID recipes, JIT provisioning, domain routing, and a sso doctor preflight tool — in under 30 minutes.
  - icon: 🔩
    title: Multi-app workspace model
    details: One workspace, many applications. Shared principal directory, per-app roles and policies, and cross-app session isolation — without multiple auth services.
  - icon: 🧪
    title: Policy testing & Studio UI
    details: Test policies with runPolicySuite(), preview changes with dryRun(), and debug decisions live in the Studio policy debugger. Ship auth the same way you ship code.
---
