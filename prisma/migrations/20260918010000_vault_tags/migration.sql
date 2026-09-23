-- Use fresh names: the reverted folders feature left its legacy tables on
-- some installations. They remain untouched by this independent feature.
CREATE TABLE "VaultTag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "ruleSource" TEXT,
    "ruleText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VaultTag_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VaultTag_rule_check" CHECK (
      ("ruleSource" IS NULL AND "ruleText" IS NULL) OR
      ("ruleSource" IS NOT NULL AND "ruleSource" IN ('filename', 'ocr') AND "ruleText" IS NOT NULL
        AND length("ruleText") BETWEEN 1 AND 200)
    )
);

CREATE TABLE "VaultFileTag" (
    "fileId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "VaultFileTag_pkey" PRIMARY KEY ("fileId", "tagId")
);

CREATE UNIQUE INDEX "VaultTag_userId_normalizedName_key" ON "VaultTag"("userId", "normalizedName");
CREATE INDEX "VaultFileTag_tagId_excluded_idx" ON "VaultFileTag"("tagId", "excluded");
ALTER TABLE "VaultTag" ADD CONSTRAINT "VaultTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultFileTag" ADD CONSTRAINT "VaultFileTag_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultFileTag" ADD CONSTRAINT "VaultFileTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "VaultTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
