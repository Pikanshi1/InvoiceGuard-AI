# Architecture

## Product boundaries
InvoiceGuard is a modular monolith. The web application calls a versioned Express API. PostgreSQL is the system of record; Elastic, notification providers and external workflow tools are derived integrations.

## Tenant isolation
Every tenant-owned record carries `workspaceId`. API queries must scope by the authenticated membership's workspace. Never trust a client-supplied workspace identifier without verifying membership. The current local development middleware uses explicit headers for local API exploration only and refuses production requests until a real session adapter is configured.

## Decision pipeline
1. Parse and validate uploaded or entered invoice data.
2. Treat document text as untrusted input.
3. Run deterministic duplicate, vendor, PO, receipt, amount and policy checks.
4. Optionally request AI extraction or explanation through a provider adapter.
5. Persist evidence and decision.
6. Route REVIEW decisions to an authorized human.
7. Only after human approval may the payment adapter create/capture a Sandbox transaction.

## Integrations
Each provider belongs behind an adapter. Credentials stay on the server. Integration health must be visible in the admin settings screen.
