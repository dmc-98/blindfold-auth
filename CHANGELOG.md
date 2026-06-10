# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project aims to follow Semantic Versioning once it reaches a stable public release process.

## Unreleased

### Added

- runnable embedded `Node + Postgres` deployment example with Docker Compose, env template, and smoke test
- baseline OSS governance files: `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, and issue/PR templates
- GitHub automation for CI, CodeQL, dependency review, release tagging, and Dependabot updates

### Changed

- `README.md` and `docs/MASTER_GUIDE.md` now document the public launch and deployment checklist more explicitly

### Fixed

- CLI `migrate` no longer eagerly constructs the auth runtime before a named migrate hook runs
