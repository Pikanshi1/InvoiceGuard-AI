# Feature inventory and implementation status

## Foundation in this delivery
- Workspace-aware Prisma data model and memberships.
- Vendor, purchase request, quotation, PO, goods receipt, invoice, approval, payment, security policy, risk case and audit entities.
- Workspace-scoped vendor and invoice APIs.
- Deterministic invoice evaluation engine with tests.
- API health endpoint, validation, rate limiting and security headers.
- Modern responsive dashboard preview with navigation, search filtering, metrics, chart, action panel and theme toggle.
- First-run owner setup, email/password login, secure sessions and protected workspace dashboard.
- Database-backed procurement APIs for requests, quotations, purchase orders, receipts and budgets.
- Database-backed approval, risk-case and append-only audit event APIs.
- Live dashboard summary counts and backend integration configuration checks.
- Procurement, vendor, and workspace-member management UI backed by the API.
- Multipart invoice document uploads with SHA-256 hashes, immutable versions, and persistent storage.
- PDF text extraction via Poppler, scanned-PDF and PNG/JPEG OCR via Tesseract (up to five PDF pages), plus schema-validated structured invoice fields through configured Gemini credentials.
- Extracted-field comparison against the registered invoice/vendor, duplicate invoice-number checks, and persisted explainable validation warnings.
- Workspace-authorized invoice CSV export with date, vendor, status, and amount filters, audit logging, and spreadsheet-formula escaping.
- Workspace-scoped vendor and quotation document uploads with MIME/content validation, SHA-256 hashes, audit events, and authenticated downloads.
- Deterministic three-way match endpoint for purchase order, invoice amount, and accepted receipt evidence.
- Workspace invitations and role-aware member administration.
- Reporting summary, notifications, PostgreSQL global search, and deterministic policy simulation endpoints.
- Credential-gated PayPal order creation, Gemini AI explanations, and optional Elasticsearch search with PostgreSQL fallback.
- Red-team security-lab endpoint and dashboard with deterministic policy scenarios.
- Workspace policy management for OWNER/ADMIN users, with persisted approval-limit and purchase-order tolerance thresholds. Enabled thresholds combine using the lowest configured values; missing or legacy fields keep the original defaults.
- Vendor payment-destination updates reset verification, trigger a blocking invoice policy result until independently verified by an OWNER/ADMIN, and are recorded atomically in the audit chain.
- Persisted PayPal payment records with idempotency keys, capture handling, and verified webhook processing.
- Payment dashboard actions for OWNER/ADMIN/FINANCE users to create orders for approved invoices, open a validated PayPal approval URL, safely retry reservations, and capture payments.
- Local text extraction and Gemini image-based invoice extraction; PDF extraction reports an explicit unsupported state.
- Complete account lifecycle: logout, Gmail-backed verification/reset, single-use expiring tokens, profile changes with re-verification, and authenticated password changes that invalidate sessions.
- Animated dark SaaS presentation across homepage and account flows with responsive transitions and reduced-motion support.

## Remaining provider-dependent work
1. Configure Gmail OAuth2 credentials for transactional email and verify delivery against the deployed domain.
2. The local Poppler/Tesseract OCR pipeline is included in the production backend image. Structured extraction still requires configured Gemini credentials; OCR alone does not create or approve invoice records.
3. Configure optional Elasticsearch indexing and ingestion for persisted records; the current search index is best-effort and PostgreSQL remains the source of truth.
4. Configure any external provider adapters required by the final sponsor/integration scope.
5. Configure Neon, Render environment variables, persistent storage, and verify the complete deployed user journey.
