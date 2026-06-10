# CLI Contract

This document defines the current and reserved command contract for `blindfold-auth`.

## Current commands

### `blindfold-auth help`

Shows command help and exits successfully.

This command must not require a config file.

### `blindfold-auth studio`

Starts Blindfold Studio locally.

Supported flags:

- `--config`: auth config module path, default `./blindfold.config.js`
- `--host`: host to bind, default `127.0.0.1`
- `--port`: port to bind, default `4110`

### `blindfold-auth bootstrap`

Bootstraps the workspace through the configured auth instance.

Supported flags:

- `--config`: auth config module path, default `./blindfold.config.js`
- `--workspace-name`: workspace display name, default `Blindfold Workspace`

### `blindfold-auth seed-demo`

Seeds a demo application, principal, role, membership, and sample policy.

Supported flags:

- `--config`: auth config module path, default `./blindfold.config.js`

## Reserved command

### `blindfold-auth migrate`

This command is reserved as part of the Phase 0 contract.

Purpose:

- apply or reconcile Blindfold schema changes for the configured backend

Current repository status:

- the command exists
- if the config module exports `migrate({ auth, dryRun })`, the CLI uses that contract
- otherwise the CLI falls back to `auth.storage.ensureTables()` when available

Supported flags:

- `--config`: auth config module path, default `./blindfold.config.js`
- `--dry-run`: request a migration plan instead of applying migrations, only supported when the config module exports `migrate({ auth, dryRun })`

## Command principles

- help should work without loading app config
- commands that need runtime access should load `--config`
- output should be short and human-readable
- failures should explain what is missing or unsupported
