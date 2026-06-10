# Lambda + DynamoDB Reference Example

This example shows the serverless shape of Blindfold Auth:

- the same embedded runtime is used
- API Gateway requests are wrapped by the serverless adapter
- storage is backed by a DynamoDB-like document interface

The included store uses an in-memory client so the example stays runnable without AWS credentials. To wire it to real DynamoDB, replace the fake client in `handler.js` with a thin wrapper around the AWS SDK's document client that exposes:

- `get({ tableName, key })`
- `put({ tableName, item })`
- `delete({ tableName, key })`
- `scan({ tableName })`

The example routes are:

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /billing`

## Local smoke

From the repository root:

```sh
npm install
npm run smoke:lambda-example
```

This will:

- import the example handler
- log in with the seeded demo principal
- call the protected billing route
- assert the expected protected response

## Adapting this to AWS

- replace the in-memory Dynamo client with a real AWS SDK document client wrapper
- inject a real workspace secret through Lambda environment variables
- keep `Node + Postgres` as the primary production lane unless you intentionally want the reference serverless shape
- front the handler with API Gateway HTTP API and verify login, refresh, logout, and one protected route before expanding scope
