-- Historical storage locations cannot be inferred from the currently selected
-- backend: operators may have changed it after the original upload.
ALTER TABLE "File" ADD COLUMN "storageTarget" JSONB;
ALTER TABLE "User" ADD COLUMN "avatarStoragePath" TEXT;
ALTER TABLE "User" ADD COLUMN "avatarStorageTarget" JSONB;
ALTER TABLE "StorageDeletion" ADD COLUMN "writePending" BOOLEAN NOT NULL DEFAULT false;

-- Older queued jobs pinned deletion-time configuration, not upload provenance.
-- Preserve that diagnostic hint without treating it as authority to erase bytes.
UPDATE "StorageDeletion"
SET target = jsonb_build_object('previousProvider', provider, 'previousTarget', target),
    provider = 'unknown', status = 'pending', "leaseId" = NULL, "leaseUntil" = NULL,
    "availableAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP,
    "lastError" = 'Storage provenance is unknown; verify the original object location before assigning a cleanup target.';
