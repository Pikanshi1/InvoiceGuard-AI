# Testing checklist

## Local foundation
- Run `npm install` in `backend` and `frontend`.
- Copy the example environment files and configure PostgreSQL.
- Run `npm run db:generate` and `npm run db:migrate:deploy` from `backend`.
- Run `npm run test` and `npm run build` from `backend`.
- Run `npm run build` and `npx tsc --noEmit` from `frontend`.
- Open the web app and API health endpoint.
- Docker Compose startup should be verified on a machine with Docker Desktop.

## Security acceptance tests
- [ ] A user cannot read another workspace's invoices or vendors.
- [ ] A role without permission cannot create or approve financial records.
- [ ] Duplicate invoice numbers are rejected or flagged.
- [ ] Unverified vendor requires review.
- [ ] Missing PO requires review.
- [ ] Invoice over tolerance requires review/block according to policy.
- [ ] Document instructions cannot trigger payment or change policy.
- [ ] Payment capture cannot happen without human approval.
- [ ] Repeated payment requests with same idempotency key do not create duplicate captures.

## Procurement and governance acceptance tests

- [ ] A workspace member can create and list a purchase request.
- [ ] Quotations, purchase orders, receipts and budgets reject records from another workspace.
- [ ] Receipt quantities enforce ordered >= received >= accepted.
- [ ] Approval decisions require an authorized role and are recorded in the audit chain.
- [ ] Risk cases and audit events are workspace-scoped.
- [ ] Audit event hashes form an unbroken chain for each workspace.
- [ ] Missing PayPal, Elasticsearch or AI credentials produce explicit not-configured status rather than fake success.
- [ ] A member can create a purchase request and see it only in the active workspace.
- [ ] Vendor creation and member role changes require the appropriate workspace role.
- [ ] A payment-destination update resets vendor verification, blocks policy approval until verified by a different OWNER/ADMIN, and does not expose tax or bank details to regular members.
- [ ] Invoice documents reject unsupported types and files above the size limit.
- [ ] Uploading a document creates the next immutable invoice version and stores its content hash.
- [ ] Three-way matching returns REVIEW when a PO or accepted receipt is missing.
- [ ] Invitations expire, cannot be reused, and create only the invited workspace membership.
- [ ] Policy simulation returns BLOCK for duplicates and REVIEW for failed controls.
- [ ] Reports and search return only active-workspace records.
- [ ] PayPal, AI, and Elasticsearch endpoints return explicit configuration errors when `.env` values are absent.
- [ ] PayPal orders reject invoices that are not APPROVED.
- [ ] A reserved payment retry rechecks current invoice approval before contacting PayPal.
- [ ] PayPal approval links are returned only for workspace-scoped pending payments and must match the reserved amount and currency.
- [ ] The dashboard exposes order creation only for approved invoices and capture only for pending payments.
- [ ] Red-team scenarios remain deterministic and do not create business records.
- [ ] Reusing an `x-idempotency-key` returns the existing payment instead of creating another payment.
- [ ] A payment cannot be captured outside the active workspace.
- [ ] PayPal webhook events are rejected when signature verification fails.
- [ ] Document extraction returns an explicit configuration error when no provider is configured.
