-- End-to-end encryption account record (docs/e2ee-spec.md, section 5.3).
-- Additive: an existing account has no keys and keeps password sign-in until
-- it completes key setup (section 14.1). The server reads the public keys and
-- the salt. wrappedRoot and sealedKeyring are ciphertext that only the client
-- opens; both are stored as record_version || record (section 4.4, rule 12).
ALTER TABLE "User"
  ADD COLUMN "accountPublicKey" BYTEA,
  ADD COLUMN "passphraseSalt" BYTEA,
  ADD COLUMN "authPublicKey" BYTEA,
  ADD COLUMN "wrappedRoot" BYTEA,
  ADD COLUMN "sealedKeyring" BYTEA,
  ADD COLUMN "e2eeProtocolVersion" INTEGER;

-- The account record is complete or absent, and an account that has keys has
-- no password hash: the passphrase is its only local sign-in secret.
ALTER TABLE "User"
  ADD CONSTRAINT "User_e2ee_account_record_check" CHECK (
    (
      "accountPublicKey" IS NULL
      AND "passphraseSalt" IS NULL
      AND "authPublicKey" IS NULL
      AND "wrappedRoot" IS NULL
      AND "sealedKeyring" IS NULL
      AND "e2eeProtocolVersion" IS NULL
    )
    OR (
      "accountPublicKey" IS NOT NULL
      AND "passphraseSalt" IS NOT NULL
      AND "authPublicKey" IS NOT NULL
      AND "wrappedRoot" IS NOT NULL
      AND "e2eeProtocolVersion" IS NOT NULL
      AND "password" IS NULL
    )
  );
