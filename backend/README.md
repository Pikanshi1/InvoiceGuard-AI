# InvoiceGuard AI Backend

Express, TypeScript, Prisma, and PostgreSQL API for InvoiceGuard AI.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run db:generate
npm run db:push # local development only; never use against production
npm run dev
```

Run tests with `npm test` and compile with `npm run build`.

For deployments with migration support, review the committed migration SQL first, confirm the target database, obtain operator approval, and then apply migrations with:

```powershell
npm run db:migrate:deploy
```

The initial migration is in `database/prisma/migrations/0001_initial_schema`. It creates the complete workspace, procurement, invoice, approval, payment, and audit schema without seed data.

The API also includes agreements, vendor document history, email verification tokens, Gmail OAuth2 transactional email, Gemini explanations and image extraction, local text extraction, and optional Elasticsearch indexing/search with PostgreSQL fallback. PDF extraction is explicitly unsupported without a local parser.

## Docker

```powershell
docker build -t invoiceguard-backend .
docker run --rm -p 4000:4000 --env-file .env invoiceguard-backend
```

Never run migrations against production without explicit approval. Keep `.env` private. It contains database, session, payment, search, and AI provider credentials.
