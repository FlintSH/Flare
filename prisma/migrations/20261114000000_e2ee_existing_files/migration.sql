-- Encryption of the files an account had before end-to-end encryption
-- (docs/e2ee-spec.md, section 14.2). Additive: no existing file changes
-- until its owner chooses, and an account that never signs in keeps its
-- plain files (section 14.3).

-- The answer of the account to "which existing files does the server
-- encrypt": none, private or all. Null until the account answered.
ALTER TABLE "User"
  ADD COLUMN "existingFilesChoice" TEXT,
  ADD COLUMN "existingFilesChoiceAt" TIMESTAMP(3);

ALTER TABLE "User"
  ADD CONSTRAINT "User_existingFilesChoice_check" CHECK (
    "existingFilesChoice" IS NULL
    OR "existingFilesChoice" IN ('none', 'private', 'all')
  );

-- A file that had a server-side password when the server encrypted it. The
-- server has only a hash of that password and cannot make a password stanza,
-- so the file is private until its owner stores a password stanza or sets
-- its visibility. The column holds the visibility that the file had.
ALTER TABLE "File" ADD COLUMN "passwordPendingFrom" "FileVisibility";

ALTER TABLE "File"
  ADD CONSTRAINT "File_passwordPendingFrom_check" CHECK (
    "passwordPendingFrom" IS NULL
    OR ("encrypted" = true AND "visibility" = 'PRIVATE' AND "passwordStanza" IS NULL)
  );

-- One plain file that the server encrypts for its owner. The row is also the
-- journal of the ciphertext object that the running attempt writes, so it
-- has no foreign keys: it must survive the deletion of the file or of the
-- account, until a worker removed that object. No column holds a file name.
CREATE TABLE "FileEncryptionJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "onlyIfPrivate" BOOLEAN NOT NULL DEFAULT false,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseId" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "ciphertextPath" TEXT,
  "ciphertextTarget" JSONB,
  "errorCode" TEXT,
  "result" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "FileEncryptionJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FileEncryptionJob_status_check" CHECK (
    "status" IN ('pending', 'processing', 'failed', 'done')
  ),
  -- Only a running attempt holds a lease, and only a job that is not
  -- finished can name an object that still needs a decision.
  CONSTRAINT "FileEncryptionJob_lease_check" CHECK (
    ("status" = 'processing') = ("leaseId" IS NOT NULL AND "leaseUntil" IS NOT NULL)
  ),
  CONSTRAINT "FileEncryptionJob_object_check" CHECK (
    "ciphertextPath" IS NULL OR "status" = 'processing'
  )
);

CREATE UNIQUE INDEX "FileEncryptionJob_fileId_key" ON "FileEncryptionJob"("fileId");
CREATE INDEX "FileEncryptionJob_status_availableAt_idx" ON "FileEncryptionJob"("status", "availableAt");
CREATE INDEX "FileEncryptionJob_userId_status_availableAt_idx" ON "FileEncryptionJob"("userId", "status", "availableAt");
CREATE INDEX "FileEncryptionJob_leaseUntil_idx" ON "FileEncryptionJob"("leaseUntil");

-- The library guard of the earlier migration, with two additions.
--
-- 1. The mark of a pending password goes away with the first decision of the
--    owner about the access to the file: a password stanza, or a statement
--    that sets the visibility. A statement that makes the file public
--    without a password stanza is such a decision too. The constraint above
--    then holds for every writer.
-- 2. The mark is part of the list row that the local search cache keeps, so
--    a change of it moves `syncSeq` on.
CREATE OR REPLACE FUNCTION "flare_file_library_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."passwordPendingFrom" IS NOT NULL
    AND OLD."passwordPendingFrom" IS NOT NULL
    AND (NEW."visibility" = 'PUBLIC' OR NEW."passwordStanza" IS NOT NULL)
  THEN
    NEW."passwordPendingFrom" := NULL;
  END IF;
  IF NEW."folderStanza" IS NOT NULL AND (
    NEW."visibility" = 'PRIVATE'
    OR NEW."vaultFolderId" IS NULL
    OR (
      NEW."folderStanza" IS NOT DISTINCT FROM OLD."folderStanza"
      AND (
        NEW."vaultFolderId" IS DISTINCT FROM OLD."vaultFolderId"
        OR NEW."passwordStanza" IS DISTINCT FROM OLD."passwordStanza"
      )
    )
  ) THEN
    NEW."folderStanza" := NULL;
    NEW."folderStanzaPublicKey" := NULL;
  END IF;
  IF NEW."encrypted" AND NEW."syncSeq" = OLD."syncSeq" AND (
    NEW."sealedMetadata" IS DISTINCT FROM OLD."sealedMetadata"
    OR NEW."accountStanza" IS DISTINCT FROM OLD."accountStanza"
    OR NEW."stanzaAccountPublicKey" IS DISTINCT FROM OLD."stanzaAccountPublicKey"
    OR NEW."passwordStanza" IS DISTINCT FROM OLD."passwordStanza"
    OR NEW."visibility" IS DISTINCT FROM OLD."visibility"
    OR NEW."vaultFolderId" IS DISTINCT FROM OLD."vaultFolderId"
    OR NEW."unreadable" IS DISTINCT FROM OLD."unreadable"
    OR NEW."urlPath" IS DISTINCT FROM OLD."urlPath"
    OR NEW."uploadOptions" IS DISTINCT FROM OLD."uploadOptions"
    OR NEW."encrypted" IS DISTINCT FROM OLD."encrypted"
    OR NEW."passwordPendingFrom" IS DISTINCT FROM OLD."passwordPendingFrom"
  ) THEN
    NEW."syncSeq" := nextval(pg_get_serial_sequence('"File"', 'syncSeq'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
