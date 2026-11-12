# Security model

- Enforce workspace membership and role permissions on every tenant-scoped route.
- Use secure, HttpOnly, SameSite=Lax cookies for session authentication. Workspace headers select only among memberships loaded from the authenticated database session.
- Store password hashes using a modern password hashing configuration.
- Keep payment and AI API secrets server-side.
- Validate all request bodies and impose upload size/type limits.
- Treat invoice files, extracted text and vendor-provided documents as untrusted data.
- Never allow document content to invoke tools, change policies or authorize payments.
- Require independent human authorization before PayPal capture.
- Use idempotency keys for payment creation/capture.
- Audit policy edits, vendor payment destination changes, approvals and payment events.
- Add immutable/WORM storage or external anchoring before claiming tamper-proof audit logs. The schema's hash fields are only a foundation.

- Email verification is required before tenant-scoped API access.
- Password reset and email-verification tokens are stored as SHA-256 hashes, expire, and are single-use.
- Workspace invitation acceptance is deliberately mounted outside workspace-membership middleware, then checks the authenticated user's email against the invitation before atomically creating membership.
- Uploaded document contents are checked against supported file signatures rather than trusting MIME type alone.
- PayPal webhook signatures are verified and event IDs are de-duplicated before payment state changes.
- PayPal payment currency must match the invoice currency.
