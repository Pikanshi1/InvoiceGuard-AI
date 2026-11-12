-- Add email verification state and supporting workflow document/agreement tables.
ALTER TABLE "User"
ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VendorDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuotationDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotationDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Agreement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "vendorId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key"
ON "EmailVerificationToken"("tokenHash");

CREATE INDEX "EmailVerificationToken_userId_expiresAt_idx"
ON "EmailVerificationToken"("userId", "expiresAt");

CREATE INDEX "VendorDocument_workspaceId_vendorId_createdAt_idx"
ON "VendorDocument"("workspaceId", "vendorId", "createdAt");

CREATE INDEX "QuotationDocument_workspaceId_quotationId_createdAt_idx"
ON "QuotationDocument"("workspaceId", "quotationId", "createdAt");

CREATE INDEX "Agreement_workspaceId_status_expiresAt_idx"
ON "Agreement"("workspaceId", "status", "expiresAt");

ALTER TABLE "EmailVerificationToken"
ADD CONSTRAINT "EmailVerificationToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorDocument"
ADD CONSTRAINT "VendorDocument_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VendorDocument"
ADD CONSTRAINT "VendorDocument_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuotationDocument"
ADD CONSTRAINT "QuotationDocument_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuotationDocument"
ADD CONSTRAINT "QuotationDocument_quotationId_fkey"
FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Agreement"
ADD CONSTRAINT "Agreement_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Agreement"
ADD CONSTRAINT "Agreement_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
