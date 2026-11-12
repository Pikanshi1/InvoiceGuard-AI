-- Add nullable workflow attribution fields. Existing invoice rows are preserved.
ALTER TABLE "Invoice"
ADD COLUMN "createdById" TEXT,
ADD COLUMN "evaluatedAt" TIMESTAMP(3);

-- Recover creator/evaluation timestamps where the existing audit history has evidence.
UPDATE "Invoice" AS invoice
SET "createdById" = (
  SELECT event."actorId"
  FROM "AuditEvent" AS event
  WHERE event."workspaceId" = invoice."workspaceId"
    AND event."entityType" = 'Invoice'
    AND event."entityId" = invoice."id"
    AND event."action" = 'CREATED'
    AND event."actorId" IS NOT NULL
  ORDER BY event."createdAt" ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM "AuditEvent" AS event
  WHERE event."workspaceId" = invoice."workspaceId"
    AND event."entityType" = 'Invoice'
    AND event."entityId" = invoice."id"
    AND event."action" = 'CREATED'
    AND event."actorId" IS NOT NULL
);

UPDATE "Invoice" AS invoice
SET "evaluatedAt" = (
  SELECT event."createdAt"
  FROM "AuditEvent" AS event
  WHERE event."workspaceId" = invoice."workspaceId"
    AND event."entityType" = 'Invoice'
    AND event."entityId" = invoice."id"
    AND event."action" = 'EVALUATED'
  ORDER BY event."createdAt" DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM "AuditEvent" AS event
  WHERE event."workspaceId" = invoice."workspaceId"
    AND event."entityType" = 'Invoice'
    AND event."entityId" = invoice."id"
    AND event."action" = 'EVALUATED'
);

CREATE INDEX "Invoice_createdById_idx" ON "Invoice"("createdById");
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
