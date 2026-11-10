-- Upload tokens and old screenshot tool configurations
-- (docs/e2ee-spec.md, sections 13 and 14.4).
--
-- The account upload token was stored as plain text. Each stored token is
-- replaced with its SHA-256, in the same form as a named API token:
-- lower case hexadecimal of the hash of the token text. A configuration
-- that holds the old token continues to authenticate. No endpoint can
-- return the token after this migration, because only the hash exists.
ALTER TABLE "User" ADD COLUMN "uploadTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "uploadTokenUsedAt" TIMESTAMP(3);

UPDATE "User"
SET "uploadTokenHash" = encode(sha256(convert_to("uploadToken", 'UTF8')), 'hex');

DROP INDEX "User_uploadToken_key";
ALTER TABLE "User" DROP COLUMN "uploadToken";
CREATE UNIQUE INDEX "User_uploadTokenHash_key" ON "User"("uploadTokenHash");

-- A named token from before this migration belongs to a tool that cannot
-- encrypt. Its uploads stay plain files, whatever its upload profile says.
ALTER TABLE "ApiToken" ADD COLUMN "predatesEncryption" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ApiToken" SET "predatesEncryption" = true;
