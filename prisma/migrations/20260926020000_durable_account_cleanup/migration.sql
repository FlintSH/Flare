-- No foreign key to User/File: deletion work must outlive their cascades.
CREATE TABLE "StorageDeletion" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "target" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StorageDeletion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StorageDeletion_status_availableAt_idx" ON "StorageDeletion"("status", "availableAt");
CREATE INDEX "StorageDeletion_leaseUntil_idx" ON "StorageDeletion"("leaseUntil");
CREATE INDEX "StorageDeletion_ownerId_idx" ON "StorageDeletion"("ownerId");
