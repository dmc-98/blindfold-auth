# Phase 0 Checklist

This checklist turns the roadmap's Phase 0 into concrete implementation work for the current repository.

Phase 0 is complete when the public surface is stable enough that the next feature phases can build on it without accidental breaking changes.

## Objective

Lock the contracts for:

- runtime APIs
- CLI behavior
- storage adapters
- configuration and env vars
- supported deployment lanes
- migration expectations

## Deliverables

### 1. Runtime contract freeze

Document and keep stable:

- `createAuth()` constructor options
- returned runtime surface:
  - `auth.protect()`
  - `auth.can()`
  - `auth.session.*`
  - `auth.handlers.*`
  - `auth.admin.*`
- supported auth storage requirements
- token and session behavior guarantees

Implementation tasks:

- document required and optional `createAuth()` inputs
- document stable admin namespaces and current method set
- document which methods are stable, provisional, or planned
- add tests for contract-level behavior where gaps exist

Done when:

- runtime behavior is documented and test-backed for the currently exported surface

### 2. CLI contract freeze

Document and keep stable:

- `blindfold-auth studio`
- `blindfold-auth bootstrap`
- `blindfold-auth seed-demo`
- `blindfold-auth help`
- reserved `blindfold-auth migrate` command contract

Implementation tasks:

- add a real help surface that does not require a config file
- standardize flag names and defaults
- define command behavior, success output, and failure output
- define reserved commands that are intentionally not implemented yet

Done when:

- users can discover the CLI shape from the CLI itself and the docs

### 3. Storage adapter contract

Document and keep stable:

- `ensureTables()`
- `list(table, filter)`
- `get(table, id)`
- `put(table, record)`
- `delete(table, id)`

Implementation tasks:

- document adapter method signatures and expected semantics
- document timestamp expectations and record identity rules
- document required table names and behavior for missing records
- clarify that PostgreSQL is the primary supported backend

Done when:

- a third-party adapter can be implemented from docs without reading internal runtime code

### 4. Configuration and env-var contract

Document and keep stable:

- `workspaceId`
- `secret`
- storage wiring
- recommended env vars for production
- Studio host and port env vars

Implementation tasks:

- define the recommended env names for embedded Node + Postgres
- define how config should be loaded in app code
- document the current example config shape
- reserve names for future migration and Studio behavior

Done when:

- a deployer knows which env vars are first-class and which ones are example-only

### 5. Deployment matrix freeze

Document and keep stable:

- recommended path: embedded Node + Postgres
- supported path: Docker Compose around Node + Postgres
- reference path: Lambda + DynamoDB

Implementation tasks:

- document maturity level for each lane
- define smoke-test expectations shared by all lanes
- state clearly which lane drives performance and security priorities

Done when:

- the project no longer sends mixed signals about which deployment mode comes first

### 6. Migration contract

Document and keep stable:

- current migration gap
- target `blindfold-auth migrate` CLI surface
- ownership of Postgres schema creation and upgrade path

Implementation tasks:

- define what `migrate` will do in v1
- define how schema SQL from the Postgres adapter participates in migrations
- define bootstrap versus migrate responsibilities

Done when:

- future migration work can proceed without redesigning the CLI or adapter responsibilities

### 7. Validation and enforcement

Implementation tasks:

- add CLI tests for help and reserved command behavior
- update the root docs to point to the Phase 0 contract files
- make the current command help match the docs exactly

Done when:

- the current repo visibly reflects that Phase 0 has started

## Exit criteria

Phase 0 is complete when:

1. the runtime contract is documented
2. the CLI contract is documented and discoverable
3. the storage contract is documented
4. the env-var contract is documented and reflected in code
5. the deployment matrix is explicit
6. migration responsibilities are defined
7. the docs and the current CLI behavior agree
