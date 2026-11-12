# InvoiceGuard AI

InvoiceGuard AI is an intelligent procurement and payment security platform.

**Core principle:** AI recommends. Deterministic code decides. Humans authorize payment.

## Architecture

InvoiceGuard is a modular monolith in an npm-workspaces monorepo:

```text
Browser
  |
  v
Next.js frontend (frontend:3000)
  |
  v
Express + TypeScript backend (backend:4000)
  |
  v
PostgreSQL (Prisma, backend/database:5432)
```

- `frontend` contains the Next.js public homepage and workspace application.
- `backend` exposes the Express REST API, authentication, workflow controls, and deterministic invoice policy checks.
- `backend/database` owns the Prisma schema and database commands.
- PostgreSQL is the system of record. Elasticsearch is optional: PostgreSQL fallback search remains available when Elasticsearch is unavailable.
- External providers belong behind server-side adapters. Their credentials and payment operations never run in the browser.
- Tenant-owned records carry `workspaceId`; API access is workspace-scoped. The optional `x-workspace-id` header selects among the authenticated user's memberships and is always validated server-side.
- First-run setup is available at `/setup`; subsequent access uses `/login` and secure HTTP-only sessions.
- Account security includes logout, single-use forgot-password links, password reset, session invalidation after password changes, and profile editing for name, email, and hosted avatar URL.

The decision pipeline validates invoice data, runs deterministic duplicate/vendor/purchase-order/amount/policy checks, optionally obtains AI extraction or explanation, persists evidence, and routes review decisions to an authorized human. AI output never authorizes or captures payment.

## Requirements

- Docker Desktop with Docker Compose v2 on Windows
- Git

Node.js 22+ and npm 10+ are only needed when running commands directly on the host. Docker is the supported path for local PostgreSQL and application development.

## Environment configuration

Copy the example files before starting the stack:

```powershell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

For Docker, set a long, random, URL-safe `POSTGRES_PASSWORD` in the root `.env` (letters, digits, underscores and hyphens avoid breaking the composed database URL). Set `NEXT_PUBLIC_API_URL` to the browser-reachable HTTPS API URL before building for production; it is included in the frontend bundle and must never contain credentials. Set `WEB_ORIGIN` to the frontend HTTPS origin in `backend/.env`, and configure `TRUST_PROXY_HOPS` only for the actual proxy chain. Configure Gmail OAuth2 before using transactional email and configure Gemini before using AI features. The application uses random database-backed session tokens and does not require an additional session secret. Do not commit `.env`; it is ignored by Git and is never copied into an image. The compose network uses the PostgreSQL service name internally, while host-side tools can use the `DATABASE_URL` value in `.env`.

## Docker development

For a database that already has the committed schema, start the stack:

```text
docker compose up --build
```

The API waits for PostgreSQL to become healthy but does not apply migrations automatically. For a fresh database or schema change, start PostgreSQL, review the pending migration, then run `docker compose run --rm api npm run db:migrate:deploy` as a separate operator action before starting the complete stack. Compose ports bind to localhost; put a TLS reverse proxy in front of the web and API services when serving production traffic. Gmail OAuth2 is required for transactional email; Gemini is configured server-side and is never exposed to the browser. Elasticsearch is optional and PostgreSQL search remains available when it is unset or unavailable. Open the web app at http://localhost:3000 and the API health check at http://localhost:4000/api/health.

Stop containers:

```text
docker compose down
```

Stop containers and remove volumes. **This deletes the local PostgreSQL data:**

```text
docker compose down -v
```

Useful commands:

```text
docker compose logs -f api
docker compose logs -f web
docker compose logs -f postgres
docker compose build api
docker compose build web
docker compose up -d postgres
docker compose run --rm api npm run db:generate
docker compose run --rm api npm run db:push # local development only; never use against production
```

The Dockerfiles use multi-stage builds with non-root production containers. To build production images instead of the development targets:

```text
docker build --target production -f backend/Dockerfile -t invoiceguard-api ./backend
docker build --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api --target production -f frontend/Dockerfile -t invoiceguard-web ./frontend
```

Committed Prisma migrations are included. For a fresh database, review the migration history and explicitly run `npm run db:migrate:deploy` after PostgreSQL is available. Do not use `prisma db push` against production databases. `prisma migrate deploy` is the deployment path, and is deliberately not part of API startup.

## Direct host development

If PostgreSQL is already available locally, configure `DATABASE_URL` and run:

```text
npm install
npm run db:generate
npm run db:push # local development only; never use against production
npm run dev
```

The web app runs on port 3000 and the API on port 4000.

After first-run setup, authenticated API routes include `/api/procurement/*`, `/api/governance/*`, `/api/dashboard/summary`, and `/api/integrations/status`. These endpoints only return records stored in the signed-in user's workspace.

Additional authenticated capabilities include workspace invitations and role changes, policy simulation, report summaries, notifications, PostgreSQL fallback search, invoice document upload/versioning, profile management, and provider-gated PayPal and Gemini AI adapters, with optional Elasticsearch and PostgreSQL fallback search. Provider endpoints return a clear configuration error until matching `.env` values are supplied; they never fabricate a successful external operation.

Transactional email uses Gmail API OAuth2 with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, and `GOOGLE_SENDER_EMAIL`. Verification, password-reset, and workspace-invitation emails are sent server-side. Reset and verification tokens are never returned by API responses; only token hashes are stored in PostgreSQL.

PayPal payment records use the required `x-idempotency-key` header, verify webhook signatures, and de-duplicate webhook event IDs. Approved invoices can create and capture orders only within the active workspace, and PayPal webhooks are accepted only after PayPal signature verification. Set `PAYPAL_WEBHOOK_ID` for webhook processing. Text files use local text extraction; PNG/JPEG invoice images can use the configured Gemini model. PDF extraction is explicitly unsupported without a local parser. No external document-extraction service is required.

## Deployment preparation

See [Render and Neon deployment](docs/DEPLOYMENT.md) for Docker service configuration, environment variables, persistent invoice storage, and an explicitly gated production migration procedure. Production migrations require operator review and approval.

## Tests and scripts

```text
npm run test
npm run build
npm run db:generate
npm run db:push
npm run db:studio
```

`npm run test` runs the API unit tests. Run it on the host after `npm install`, or through the API container with `docker compose run --rm api npm run test`.

## Troubleshooting

- **Docker Desktop is not running:** start Docker Desktop and confirm Linux containers are enabled, then rerun `docker compose up --build`.
- **Port 3000 or 4000 is busy:** change `WEB_PORT` or `API_PORT` in `.env`; the service ports inside the compose network remain 3000 and 4000.
- **PostgreSQL connection errors:** wait for `docker compose ps` to show PostgreSQL as healthy. If credentials changed after the first run, stop the stack and recreate the data volume with `docker compose down -v`, then start again.
- **Schema errors after changing Prisma:** rerun `docker compose run --rm api npm run db:push`; use `docker compose logs api` for the complete error.
- **Stale application dependencies:** rebuild the affected service with `docker compose build --no-cache api` or `docker compose build --no-cache web`.
- **Health check failures:** inspect `docker compose logs -f api` and verify `http://localhost:4000/api/health` after PostgreSQL is healthy.

## Security notes

- Never commit `.env` or provider credentials.
- Payment credentials remain server-side.
- Invoice content is untrusted data and cannot issue tool instructions.
- All financial decisions pass deterministic policy checks and human approval.
- This project is a development/demo baseline, not a certified accounting or fraud-prevention product.
