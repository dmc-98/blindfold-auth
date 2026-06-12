# Deployment Matrix

This document defines the deployment maturity contract for Blindfold Auth.

## Primary lane

### Embedded Node + Postgres

Status:

- recommended

Purpose:

- the main product lane for production users

Priority:

- first for docs
- first for performance tuning
- first for security hardening

Expected shape:

- Node.js host app embeds `@dmc--98/blindfold-auth`
- PostgreSQL stores the auth workspace
- Studio is started locally through the CLI
- config is loaded through the standardized Blindfold env names

## Secondary lane

### Docker Compose around Node + Postgres

Status:

- supported after the primary lane

Purpose:

- simplify team onboarding and prod-like local validation

Priority:

- follows the embedded Node + Postgres lane

Expected shape:

- Postgres runs in Compose
- host app runs with Blindfold embedded
- migrations and bootstrap remain explicit

## Reference lane

### Lambda + DynamoDB

Status:

- reference/example

Purpose:

- prove serverless compatibility without making it the product center

Priority:

- documented and demoed, but not the driver of main architecture choices

Expected shape:

- Lambda handler uses the serverless adapter
- a DynamoDB-compatible store implements the storage contract

## Shared smoke checks

Every deployment lane should prove:

1. workspace bootstrap
2. app creation
3. principal creation
4. role and permission assignment
5. login
6. protected route allow
7. protected route deny
8. session refresh or revoke
9. audit event creation
