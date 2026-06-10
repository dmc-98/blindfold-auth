# Blindfold Auth Performance

This document captures the current performance baseline for the implemented Blindfold Auth foundation and explains how to rerun it.

## What was optimized in this phase

This pass focused on the hot paths we actually exercise on every request:

- faster in-memory and file-backed `get()` lookups through per-table ID indexes
- cached exact-match table filters for repeated auth lookups in local embedded storage
- fewer redundant lookups in `auth.protect()` by reusing the verified principal and application
- narrower magic-link challenge lookup by `applicationId`, `status`, and `tokenHash`
- Postgres migration indexes for common auth query surfaces

The Postgres lane now creates indexes for:

- application slug lookup
- principal email lookup
- membership principal/application lookup
- role-permission application/role lookup
- policy and direct-grant lookup scope
- auth challenge lookup
- per-table `created_at` ordering

## Benchmark command

Run the local performance baseline from the repository root:

```sh
npm run perf:bench
```

To assert the current budgets:

```sh
npm run perf:bench -- --assert
```

## Performance budgets

The current local benchmark budgets are:

| Scenario | Avg budget (ms) | P95 budget (ms) |
| --- | ---: | ---: |
| `passwordLogin` | 90 | 120 |
| `failedLoginRateLimitPath` | 2 | 4 |
| `sessionVerify` | 0.4 | 1.5 |
| `authorizationCheck` | 0.8 | 2.5 |
| `protectedRoute` | 0.9 | 3 |
| `refreshRotation` | 0.8 | 2.5 |

These budgets are intentionally practical rather than aggressive. They are meant to catch regressions in the local-first runtime without turning CI into a noisy benchmark lab.

## Current baseline

Measured on `2026-04-01` with:

- Node `v22.21.1`
- `npm run perf:bench -- --assert`
- local memory-backed workspace benchmark

Current results:

| Scenario | Iterations | Avg (ms) | P50 (ms) | P95 (ms) | Max (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| `passwordLogin` | 25 | 21.237 | 21.086 | 21.533 | 22.916 |
| `failedLoginRateLimitPath` | 50 | 0.062 | 0.051 | 0.113 | 0.206 |
| `sessionVerify` | 750 | 0.015 | 0.013 | 0.018 | 0.151 |
| `authorizationCheck` | 750 | 0.016 | 0.013 | 0.033 | 0.139 |
| `protectedRoute` | 500 | 0.026 | 0.023 | 0.037 | 0.178 |
| `refreshRotation` | 150 | 0.047 | 0.040 | 0.073 | 0.207 |

## Notes

- Password login is expected to be the slowest path because it includes password hashing work.
- The benchmark is memory-backed on purpose. It measures runtime overhead and lookup behavior independent of Docker or network noise.
- The recommended production lane is still Node + Postgres. The Postgres migration SQL now creates indexes for the same lookup patterns exercised in the benchmark.
- The benchmark is not currently used as a CI gate because shared runners make latency budgets noisy. It is intended as a repeatable engineering baseline.

## Next performance work

Useful follow-up work after this baseline:

- benchmark the Docker-backed Postgres lane directly
- profile larger policy sets and field-level rule counts
- benchmark Studio snapshot and audit views under larger workspaces
- evaluate whether a short-lived config cache is worth the consistency tradeoff
