# Acme Support Console — Blindfold Auth, end-to-end

A complete, runnable full-stack app that proves Blindfold Auth in a real product:
**password login + sessions, RBAC, and ABAC field-level masking** — all enforced
server-side by `@blindfold/client` / `@blindfold/auth`.

## Run it

```sh
npm run demo:start
# → open the printed URL (default http://127.0.0.1:4130)
```

Sign in as either seeded user (password: `password123`):

- `alice@acme.co` — **admin**: sees full SSNs, can delete customers.
- `bob@acme.co` — **support**: SSNs are masked, delete is denied.

## What it demonstrates

| Capability | How it shows up |
|------------|-----------------|
| Authentication | Password login issues a session; the SPA calls the API with a bearer token. |
| Sessions | `auth.session.verify` gates every `/api/*` route; no token → 401. |
| RBAC | Only `admin` has `customer:delete`. Support's delete returns **403** (server-enforced). |
| ABAC, field-level | A policy masks `customer.ssn` for `support`. The raw SSN never leaves the server. |
| Decision transparency | The UI shows the live `effect` (`allow` vs `mask`) from `auth.can()`. |

## How masking is real (not cosmetic)

The server evaluates `auth.can({ action: "read", resource: "customer", field: "ssn" })`
for the logged-in principal. If the decision's effect is `mask`, the field is run
through the engine's own `maskValue()` **before serialization** — so a support user's
HTTP response contains `50******34`, never `501-22-1234`.

## Test it

```sh
npm run demo:test
```

The end-to-end suite logs in as each role over HTTP and asserts that admins receive
raw SSNs and can delete, while support receives masked SSNs and is denied delete.

## Files

- `app.js` — application logic (seeds users/roles/policy; login, customers, delete) built on the SDK.
- `server.js` — zero-dependency `node:http` server serving the API + SPA.
- `public/index.html` — the single-page UI.
- `test/e2e.test.js` — HTTP end-to-end tests.
