-- Keep retired Folder tables untouched on upgraded installations.
CREATE TABLE "VaultFolder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "parentId" TEXT,
    "shareToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VaultFolder_pkey" PRIMARY KEY ("id")
);

-- The retired feature may still have a File.folderId column and foreign key.
-- A distinct column preserves that data and works on both fresh and upgraded DBs.
ALTER TABLE "File" ADD COLUMN "vaultFolderId" TEXT;

CREATE UNIQUE INDEX "VaultFolder_shareToken_key" ON "VaultFolder"("shareToken");
CREATE UNIQUE INDEX "VaultFolder_userId_parentId_normalizedName_key" ON "VaultFolder"("userId", "parentId", "normalizedName");
-- PostgreSQL treats null parent IDs as distinct in ordinary unique indexes.
CREATE UNIQUE INDEX "VaultFolder_root_name_key" ON "VaultFolder"("userId", "normalizedName") WHERE "parentId" IS NULL;
CREATE INDEX "VaultFolder_userId_parentId_idx" ON "VaultFolder"("userId", "parentId");
CREATE INDEX "File_userId_vaultFolderId_idx" ON "File"("userId", "vaultFolderId");

ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VaultFolder"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "File" ADD CONSTRAINT "File_vaultFolderId_fkey" FOREIGN KEY ("vaultFolderId") REFERENCES "VaultFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
