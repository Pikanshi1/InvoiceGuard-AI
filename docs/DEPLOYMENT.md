# Render and Neon deployment

This guide prepares the existing Docker services for deployment. It does not create services, change DNS, connect a production database, or run production migrations.

## Service layout

A starter Render Blueprint is included at the repository root as `render.yaml`. It defines two Docker web services from the `complete-phase-1-and-2` branch, uses explicit Docker build contexts, disables automatic deploys, and configures the API health check. Review the file and all plan/cost settings before syncing it in Render.

| Service | Dockerfile | Docker context | Port |
|---|---|---|---|
| API | `backend/Dockerfile` | `backend` | Render-provided `PORT` (defaults to 4000 locally) |
| Web | `frontend/Dockerfile` | `frontend` | 3000 |

The Blueprint deliberately leaves database and public-origin URLs as dashboard prompts. It does not create a Neon database or execute migrations. Render supports explicit `dockerfilePath`, `dockerContext`, service health checks, and persistent disks in Blueprints; see the [Blueprint reference](https://render.com/docs/blueprint-spec) and [Docker deployment guide](https://render.com/docs/docker).

The API Blueprint attaches a 10 GB persistent disk at `/app/storage` for invoice files. Confirm the compatible paid service plan and its price before syncing. Do not remove the disk for a production invoice workflow unless durable object storage has been implemented and tested.

## Neon database preparation

1. Create a Neon PostgreSQL project and database.
2. Store its connection string privately and add `?schema=public` if needed.
3. Review every SQL migration under `backend/database/prisma/migrations`.
4. Back up important data and positively identify the target Neon project, branch, and database.

**Production migrations require explicit operator approval.** The migration command applies to the database selected by `DATABASE_URL`; never run it until you have confirmed the target and approved the pending SQL. Use a reviewed one-off migration job/release command with a migration-capable Neon connection. Do not put migrations in ordinary API startup. Never use `prisma db push` against production.

## API service environment

Set these in the Render API service:

- `NODE_ENV=production`
- `PORT`: supplied by Render; do not hardcode it
- `WEB_ORIGIN=https://<your-frontend-domain>`: exact origin, no path
- `DATABASE_URL`: Neon PostgreSQL connection string
- `TRUST_PROXY_HOPS`: configure only after confirming the actual proxy chain and Render's current guidance
- `DOCUMENT_STORAGE_PATH=/app/storage/invoices`
- Gmail OAuth2: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_SENDER_EMAIL`
- AI: `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`
- PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL`, `PAYPAL_WEBHOOK_ID`
- Optional search: `ELASTIC_URL`, `ELASTIC_API_KEY`

Use PayPal production credentials only when ready for real payments. Provider credentials belong exclusively in the API service.

## Persistent invoice files

Invoice uploads are stored on the API filesystem. Render filesystems are ephemeral unless a persistent disk is attached. Attach a disk at `/app/storage` and verify write permissions, or implement and verify durable object storage before production use. Without durable storage, redeployments can lose uploaded documents.

## Web service environment

Set the build-time variable `NEXT_PUBLIC_API_URL=https://<your-api-domain>/api` before building/redeploying the web service. Next.js embeds this value in the browser bundle. It must be a public URL and must never contain credentials.

## Cross-origin sessions

- Set API `WEB_ORIGIN` to the exact public frontend origin.
- Keep credentialed CORS restricted to that origin; never use wildcard origins with cookies.
- Browser requests send credentials.
- Production HTTPS is required. The session cookie is HTTP-only, secure, and SameSite=Lax.
- Keep frontend and API under the same site where possible. If using unrelated registrable domains, reassess cookie SameSite behavior and CSRF protections before launch; do not weaken protections just to make cookies work.

## Health checks and startup

- API health: `/api/health` (checks PostgreSQL connectivity).
- API listens on `0.0.0.0` and honors Render's `PORT`.
- Web listens on port 3000.
- No production migration is run automatically at startup.

## Pre-launch checklist

- [ ] Review `render.yaml`, confirm service names, region, plans, Dockerfile paths, and build contexts before syncing.
- [ ] Confirm Neon project, branch, database, and connection string.
- [ ] Review pending migration SQL, take a backup, and obtain explicit approval before production migration.
- [ ] Configure API secrets in Render's environment settings.
- [ ] Attach durable storage for uploaded documents.
- [ ] Set the frontend build-time API URL and rebuild.
- [ ] Verify HTTPS, CORS, cookie behavior, database health, email delivery, AI access, and PayPal mode independently.
- [ ] Run critical workflows and tenant-isolation tests in a non-production environment.

A successful image build does not verify external providers, email delivery, PayPal webhooks, durable file storage, or a Neon migration.


## Invoice document extraction runtime

The backend production Docker image installs Poppler utilities (`pdftotext`, `pdftoppm`) and Tesseract OCR with English language data. Digital PDFs are read with `pdftotext`; scanned PDFs are rendered at 200 DPI and OCR is limited to the first five pages. PNG/JPEG uploads use Tesseract OCR. Set `OCR_LANGUAGES` to an installed Tesseract language code when needed. Structured invoice-field extraction requires the configured Gemini-compatible API variables (`AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`). If the local OCR binaries or Gemini credentials are unavailable, the API returns an explicit error rather than fabricating extracted fields. OCR text and structured results are retained with the invoice document's extraction metadata.
