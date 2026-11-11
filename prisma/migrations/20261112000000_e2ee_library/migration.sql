-- Library features for end-to-end encrypted files (docs/e2ee-spec.md,
-- sections 6.9, 8.3.4, 8.4, 9.4 to 9.8 and 12.1). Additive: plain folders,
-- plain tags and plain files stay as they are until the owner's browser
-- converts the folders and tags.

-- Folder keys. A folder that has keys stores no name.
ALTER TABLE "VaultFolder"
  ADD COLUMN "folderPublicKey" BYTEA,
  ADD COLUMN "sealedFolderMetadata" BYTEA,
  ADD COLUMN "sealedFolderPrivateKey" BYTEA,
  ADD COLUMN "parentFolderStanza" BYTEA,
  ADD COLUMN "parentStanzaPublicKey" BYTEA,
  ADD COLUMN "rekeyPending" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "VaultFolder"
  ADD CONSTRAINT "VaultFolder_e2ee_records_check" CHECK (
    (
      "folderPublicKey" IS NULL
      AND "sealedFolderMetadata" IS NULL
      AND "sealedFolderPrivateKey" IS NULL
      AND "parentFolderStanza" IS NULL
      AND "parentStanzaPublicKey" IS NULL
    )
    OR (
      octet_length("folderPublicKey") = 32
      AND octet_length("sealedFolderMetadata") >= 57
      AND octet_length("sealedFolderPrivateKey") = 89
      AND "name" = ''
      AND "normalizedName" = '/sealed/' || "id"
      AND (
        ("parentFolderStanza" IS NULL AND "parentStanzaPublicKey" IS NULL)
        OR (
          octet_length("parentFolderStanza") = 97
          AND octet_length("parentStanzaPublicKey") = 32
          AND "parentId" IS NOT NULL
        )
      )
    )
  );

-- Sealed tag names and rules. A tag that has the record stores neither.
ALTER TABLE "VaultTag" ADD COLUMN "sealedTagMetadata" BYTEA;

ALTER TABLE "VaultTag"
  ADD CONSTRAINT "VaultTag_e2ee_records_check" CHECK (
    "sealedTagMetadata" IS NULL
    OR (
      octet_length("sealedTagMetadata") >= 57
      AND "name" = ''
      AND "normalizedName" = '/sealed/' || "id"
      AND "ruleSource" IS NULL
      AND "ruleText" IS NULL
    )
  );

-- Files: the folder stanza, the work that waits for the owner's browser, the
-- mark of a reset, and a sequence for the local search cache.
ALTER TABLE "File"
  ADD COLUMN "folderStanza" BYTEA,
  ADD COLUMN "folderStanzaPublicKey" BYTEA,
  ADD COLUMN "rulesPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ocrPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "thumbnailPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pendingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unreadable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "syncSeq" SERIAL NOT NULL;

CREATE INDEX "File_userId_syncSeq_idx" ON "File"("userId", "syncSeq");
CREATE INDEX "File_pending_work_idx" ON "File"("userId", "id")
  WHERE "rulesPending" OR "ocrPending" OR "thumbnailPending";
-- The stanza migration after a key rotation asks for the stanzas of one old
-- key (section 8.3.4).
CREATE INDEX "File_stanza_key_idx" ON "File"("userId", "stanzaAccountPublicKey")
  WHERE "encrypted";

-- A folder stanza exists only for an encrypted, public file in a folder
-- (section 8.4.3). Only an encrypted file can be unreadable or wait for text
-- or a thumbnail from a browser.
ALTER TABLE "File"
  ADD CONSTRAINT "File_e2ee_library_check" CHECK (
    (
      ("folderStanza" IS NULL AND "folderStanzaPublicKey" IS NULL)
      OR (
        "encrypted" = true
        AND octet_length("folderStanza") = 97
        AND octet_length("folderStanzaPublicKey") = 32
        AND "visibility" = 'PUBLIC'
        AND "vaultFolderId" IS NOT NULL
      )
    )
    AND ("encrypted" = true OR ("unreadable" = false AND "ocrPending" = false AND "thumbnailPending" = false))
  );

-- The server must delete the folder stanza when a file becomes private
-- (section 8.4.3). A stanza is also for one folder key and for one kind of
-- secret, so it does not survive a move to a different folder or a change of
-- the password stanza unless the same statement stores a new one. A trigger
-- keeps this true for every writer: the expiry worker, a moderator, a bulk
-- change and a folder that is deleted.
--
-- The same trigger moves `syncSeq` on when a value changes that the local
-- search cache of the owner keeps (section 9.8.1): the sealed records and
-- the visible values of the list row. Counters of views and downloads do
-- not move it.
CREATE FUNCTION "flare_file_library_guard"() RETURNS trigger AS $$
BEGIN
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
  ) THEN
    NEW."syncSeq" := nextval(pg_get_serial_sequence('"File"', 'syncSeq'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "File_library_guard"
  BEFORE UPDATE ON "File"
  FOR EACH ROW EXECUTE FUNCTION "flare_file_library_guard"();

-- The sealed text of an image and the sealed thumbnail, apart from the row
-- that every list reads.
CREATE TABLE "FileSealedData" (
  "fileId" TEXT NOT NULL,
  "sealedOcrText" BYTEA,
  "sealedThumbnail" BYTEA,
  CONSTRAINT "FileSealedData_pkey" PRIMARY KEY ("fileId"),
  CONSTRAINT "FileSealedData_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FileSealedData_lengths_check" CHECK (
    ("sealedOcrText" IS NULL OR octet_length("sealedOcrText") >= 57)
    AND ("sealedThumbnail" IS NULL OR octet_length("sealedThumbnail") >= 57)
  )
);

-- The text of an image and the tags of a file are part of what the local
-- search cache keeps, so a change of either moves the file's `syncSeq` on.
-- A file that is being deleted is no longer there to update: nothing happens.
CREATE FUNCTION "flare_file_touch_sync_seq"() RETURNS trigger AS $$
DECLARE
  target TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target := OLD."fileId";
  ELSE
    target := NEW."fileId";
  END IF;
  UPDATE "File"
    SET "syncSeq" = nextval(pg_get_serial_sequence('"File"', 'syncSeq'))
    WHERE "id" = target AND "encrypted";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FileSealedData_sync_seq"
  AFTER INSERT OR DELETE OR UPDATE OF "sealedOcrText" ON "FileSealedData"
  FOR EACH ROW EXECUTE FUNCTION "flare_file_touch_sync_seq"();

CREATE TRIGGER "VaultFileTag_sync_seq"
  AFTER INSERT OR UPDATE OR DELETE ON "VaultFileTag"
  FOR EACH ROW EXECUTE FUNCTION "flare_file_touch_sync_seq"();
