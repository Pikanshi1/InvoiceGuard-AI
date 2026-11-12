Get-Item .\backend\node_modules\@prisma\client | Format-List FullName,LinkType,Target-- Reliability and idempotency safeguards for PayPal processing.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_workspaceId_providerRef_key" UNIQUE ("workspaceId", "providerRef");

CREATE TABLE "PayPalWebhookEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayPalWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayPalWebhookEvent_eventId_key" ON "PayPalWebhookEvent"("eventId");
CREATE INDEX "PayPalWebhookEvent_workspaceId_receivedAt_idx" ON "PayPalWebhookEvent"("workspaceId", "receivedAt");

ALTER TABLE "PayPalWebhookEvent"
ADD CONSTRAINT "PayPalWebhookEvent_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
