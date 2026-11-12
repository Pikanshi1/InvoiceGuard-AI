# InvoiceGuard AI Frontend

Next.js frontend for InvoiceGuard AI.

## Run locally

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Set `NEXT_PUBLIC_API_URL` to the backend API URL. Build with `npm run build`.

## Docker

```powershell
docker build -t invoiceguard-frontend .
docker run --rm -p 3000:3000 --env-file .env invoiceguard-frontend
```

The frontend environment must contain public browser-safe values only. Never put database credentials, session secrets, payment keys, or AI provider keys in this folder.
