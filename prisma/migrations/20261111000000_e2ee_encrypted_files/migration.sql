-- End-to-end encrypted files (docs/e2ee-spec.md, sections 7, 8.1, 8.2 and 9).
-- Additive: every existing file is a plain file and stays one.
--
-- An encrypted file stores ciphertext only. The server keeps a copy of the
-- 26-byte file header, the sealed name and type, the account stanza with the
-- account public key it is for, and an optional password stanza. The sealed
-- record and the stanzas are stored as record_version || record (section 4.4,
-- rule 12), so they are one byte longer than the sizes of the specification.
ALTER TABLE "File"
  ADD COLUMN "encrypted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "header" BYTEA,
  ADD COLUMN "sealedMetadata" BYTEA,
  ADD COLUMN "accountStanza" BYTEA,
  ADD COLUMN "stanzaAccountPublicKey" BYTEA,
  ADD COLUMN "passwordStanza" BYTEA;

-- A plain file has none of the records. An encrypted file has all the
-- required ones, and no name, no type, no text from an image and no
-- server-side password: its name is empty and its type is the generic one.
ALTER TABLE "File"
  ADD CONSTRAINT "File_e2ee_records_check" CHECK (
    (
      "encrypted" = false
      AND "header" IS NULL
      AND "sealedMetadata" IS NULL
      AND "accountStanza" IS NULL
      AND "stanzaAccountPublicKey" IS NULL
      AND "passwordStanza" IS NULL
    )
    OR (
      "encrypted" = true
      AND octet_length("header") = 26
      AND octet_length("sealedMetadata") >= 57
      AND octet_length("accountStanza") = 97
      AND octet_length("stanzaAccountPublicKey") = 32
      AND ("passwordStanza" IS NULL OR octet_length("passwordStanza") = 217)
      AND "name" = ''
      AND "mimeType" = 'application/octet-stream'
      AND "password" IS NULL
      AND "ocrText" IS NULL
    )
  );
