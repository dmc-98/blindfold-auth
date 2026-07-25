# Deployment

Blindfold Auth supports three deployment lanes. Choose the one that matches your infrastructure.

## Lane A: Embedded Node + Postgres (recommended)

This is the production-recommended path. The auth runtime embeds in your existing Node.js application process. Postgres stores all workspace state.

### Why this lane

- No extra service to deploy or scale
- Postgres has excellent operational tooling (point-in-time recovery, replicas, connection pooling via PgBouncer)
- The adapter includes indexed lookup patterns and migration tooling
- Studio runs locally — there is no operator dashboard to keep live

### Setup

1. Add the Postgres adapter:

```bash
npm install @dmc--98/blindfold-auth-storage-postgres
```

2. Initialize with a connection string:

```ts
import { createPostgresStorage } from '@dmc--98/blindfold-auth-storage-postgres'
import { createAuth } from '@dmc--98/blindfold-auth'

const storage = await createPostgresStorage({
  connectionString: process.env.DATABASE_URL!,
  // Optional: pool size, SSL, schema name
  poolSize: 10,
  ssl: { rejectUnauthorized: true },
})

const auth = await createAuth({ secret: process.env.BLINDFOLD_SECRET!, storage })
```

3. Run migrations:

```bash
npx blindfold-auth migrate --config ./blindfold.config.js
```

4. Bootstrap the workspace (first run only):

```bash
npx blindfold-auth bootstrap --config ./blindfold.config.js --workspace-name "My Product"
```

### Verify the deployment

```bash
npx blindfold-auth doctor
```

All checks should be green. Fix any critical findings before serving traffic.

## Lane B: Local file-backed (dev/prototyping)

Uses a JSON file store — no database required. Not for production (no concurrent write safety, no backup tooling).

```ts
import { createFileStorage } from '@dmc--98/blindfold-auth'

const auth = await createAuth({
  secret: process.env.BLINDFOLD_SECRET!,
  storage: createFileStorage({ path: './.blindfold-data' }),
})
```

## Lane C: Lambda + DynamoDB (serverless reference)

Use `@dmc--98/blindfold-adapter-serverless` to normalize API Gateway events before passing them to the runtime. A DynamoDB-compatible document store backs the workspace.

```ts
import { createServerlessAdapter } from '@dmc--98/blindfold-adapter-serverless'

export const handler = createServerlessAdapter(auth)
```

See `examples/lambda-dynamodb/` for a complete reference implementation.

## Docker Compose (local team dev)

For teams that want a shared dev workspace with a real Postgres instance:

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: blindfold
      POSTGRES_USER: blindfold
      POSTGRES_PASSWORD: blindfold_dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://blindfold:blindfold_dev@localhost:5432/blindfold \
  npx blindfold-auth migrate --config ./blindfold.config.js
```

## Production checklist

Run `blindfold doctor` and verify:

- [ ] `BLINDFOLD_SECRET` is at least 32 characters with high entropy
- [ ] Database uses TLS (`ssl: { rejectUnauthorized: true }`)
- [ ] No default credentials in config
- [ ] Studio is not exposed on a public port
- [ ] `passwordMinLength` is at least 12
- [ ] Refresh token rotation is on (default)
- [ ] Audit log tamper check: `admin.audit.verify()`
- [ ] Migrations are applied and workspace is bootstrapped
- [ ] Application IDs are stored in config, not hardcoded in route handlers

## Running Studio in production

Studio is a local operator tool — it is not designed to be served publicly. To debug a production workspace, create an SSH tunnel to the production server and run Studio locally:

```bash
ssh -L 4110:localhost:4110 your-server
npx blindfold-auth studio --config ./blindfold.config.js
```

Then open `http://localhost:4110` on your machine.
